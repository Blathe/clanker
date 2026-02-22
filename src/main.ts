import readline from "node:readline";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";
import { callLLM } from "./llm.js";
import { loadRuntimePromptContext } from "./context.js";
import { runDiscordTransport } from "./transports/discord.js";
import { runReplTransport } from "./transports/repl.js";
import type { Channel, SendFn } from "./runtime.js";
import { handleTurnAction, type QueueDelegateResult } from "./turnHandlers.js";
import { JobQueue } from "./queue.js";
import { envFlagEnabled, parseTransportsDetailed } from "./config.js";
import { evaluate } from "./policy.js";
import { validateWorkingDir } from "./executor.js";
import type { DelegateResult } from "./delegation/types.js";
import { buildDelegationPrompt } from "./delegation/promptBuilder.js";
import { ProposalStore } from "./delegation/proposals.js";
import { classifyDelegationTool, extractCommandForPolicy } from "./delegation/toolPermissions.js";
import {
  runDelegationInIsolatedWorktree,
  verifyProposalApplyPreconditions,
  applyProposalPatch,
  cleanupProposalArtifacts,
} from "./delegation/worktree.js";
import { handleDelegationControlCommand } from "./delegation/approval.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import { SessionManager } from "./session.js";
import {
  initLogger,
  logUserInput,
  logLLMResponse,
  logSessionSummary,
  logSessionEnd,
  logProposalCreated,
  logProposalAccepted,
  logProposalRejected,
  logProposalExpired,
  logProposalApplyFailed,
} from "./logger.js";

if (process.argv.includes("--version") || process.argv.includes("-v")) {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    console.log(pkg.version);
  } catch {
    console.error("Error: could not read version from package.json");
    process.exit(1);
  }
  process.exit(0);
}

if (!process.env.OPENAI_API_KEY) {
  console.error("Error: OPENAI_API_KEY environment variable is not set.");
  process.exit(1);
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

function promptSecret(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(question);

    const stdin = process.stdin;
    if ((stdin as NodeJS.ReadStream).isTTY) {
      (stdin as NodeJS.ReadStream).setRawMode(true);
    }

    let secret = "";

    const onData = (buf: Buffer) => {
      const char = buf.toString("utf8");

      if (char === "\r" || char === "\n") {
        if ((stdin as NodeJS.ReadStream).isTTY) {
          (stdin as NodeJS.ReadStream).setRawMode(false);
        }
        stdin.removeListener("data", onData);
        process.stdout.write("\n");
        resolve(secret);
      } else if (char === "\u0003") {
        process.stdout.write("\n");
        process.exit(0);
      } else if (char === "\u007f" || char === "\b") {
        secret = secret.slice(0, -1);
      } else {
        secret += char;
      }
    };

    if ((stdin as NodeJS.ReadStream).isTTY) {
      stdin.on("data", onData);
    } else {
      rl.question("", resolve);
    }
  });
}

async function delegateToClaude(delegatePrompt: string, cwd?: string): Promise<DelegateResult> {
  if (!ENABLE_CLAUDE_DELEGATE) {
    throw new Error("Claude delegation is disabled. Set ENABLE_CLAUDE_DELEGATE=1 to enable it.");
  }

  const apiKeyValidation = validateAnthropicKey(process.env.ANTHROPIC_API_KEY);
  if (!apiKeyValidation.valid) {
    throw new Error(apiKeyValidation.error!);
  }

  const delegateModel = process.env.CLANKER_CLAUDE_ACTIVE_MODEL || RUNTIME_CONFIG.defaultClaudeModel;
  const delegatedTaskPrompt = buildDelegationPrompt(delegatePrompt);

  try {
    let fullResponse = "";
    let resultMessage: { type: string; exitCode?: number; summary?: string } = { type: "unknown" };

    const q = query({
      prompt: delegatedTaskPrompt,
      options: {
        model: delegateModel,
        ...(cwd ? { cwd } : {}),
        tools: { type: "preset", preset: "claude_code" },
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        canUseTool: async (toolName, toolInput) => {
          const toolKind = classifyDelegationTool(toolName);
          if (toolKind === "bash") {
            // For bash tools, evaluate the actual command string against policy
            const commandToEvaluate = extractCommandForPolicy(toolName, toolInput);

            const verdict = evaluate(commandToEvaluate);
            console.log(`[Delegation] Tool use requested: ${toolName}`, {
              decision: verdict.decision,
              evaluated: commandToEvaluate.slice(0, 80),
            });

            if (verdict.decision === "allowed") {
              return { behavior: "allow" };
            } else {
              const reason = "reason" in verdict ? verdict.reason : "denied by policy";
              console.log(`[Delegation] Tool blocked: ${toolName} - ${reason}`);
              return {
                behavior: "deny",
                message: `Command blocked by policy: ${reason}`,
              };
            }
          } else if (toolKind === "file") {
            return { behavior: "allow" };
          } else {
            return { behavior: "deny", message: `Tool not permitted in delegation context: ${toolName}` };
          }
        },
      },
    });

    for await (const message of q) {
      console.log(`[Delegation] Message type: ${message.type}`);

      if (message.type === "assistant") {
        const assistantMessage = message.message as { content: Array<{ type: string; text?: string }> };
        for (const block of assistantMessage.content) {
          if (block.type === "text" && block.text) {
            console.log(`[Delegation] Text response: ${block.text.slice(0, 100)}...`);
            fullResponse += block.text;
          } else if (block.type === "tool_use") {
            console.log(`[Delegation] Tool use block detected:`, { toolName: (block as any).name });
          }
        }
      } else if (message.type === "result") {
        const result = message as {
          subtype: string;
          duration_ms: number;
          num_turns: number;
          result?: string;
          errors?: string[];
        };

        console.log(`[Delegation] Result: subtype=${result.subtype}, turns=${result.num_turns}`);

        if (result.subtype === "success") {
          resultMessage = {
            type: "success",
            exitCode: 0,
            summary: (result.result || fullResponse).slice(0, 800).trim(),
          };
        } else {
          resultMessage = {
            type: "error",
            exitCode: 1,
            summary: (result.errors ? result.errors.join("\n") : "Unknown error").slice(0, 800).trim(),
          };
        }
      } else {
        console.log(`[Delegation] Other message type:`, message.type);
      }
    }

    return {
      exitCode: resultMessage.exitCode || 0,
      summary: resultMessage.summary || fullResponse.slice(0, 800).trim(),
    };
  } catch (err) {
    // Log full error for debugging, but throw generic error
    console.error("Delegation error:", err);
    throw new Error("Delegation failed. Please try again.");
  }
}

const DISCORD_UNSAFE_ENABLE_WRITES = envFlagEnabled("DISCORD_UNSAFE_ENABLE_WRITES");
const ENABLE_CLAUDE_DELEGATE = envFlagEnabled("ENABLE_CLAUDE_DELEGATE");
const TRANSPORTS = parseTransportsDetailed("CLANKER_TRANSPORTS");
const RUNTIME_CONFIG = getRuntimeConfig();
const REPL_INTERACTIVE_AVAILABLE = TRANSPORTS.repl && Boolean(process.stdin.isTTY && process.stdout.isTTY);
const runtimeLabel =
  process.platform === "win32"
    ? "the user's Windows PC via Git Bash"
    : process.platform === "darwin"
      ? "the user's macOS machine"
      : "a Linux environment";
const { systemPrompt: SYSTEM_PROMPT, lastSession: LAST_SESSION } = loadRuntimePromptContext(runtimeLabel);

/**
 * Validates Anthropic API key format
 * Anthropic keys must start with "sk-ant-"
 */
export function validateAnthropicKey(key: string | undefined): { valid: boolean; error: string | null } {
  if (!key) {
    return { valid: false, error: "ANTHROPIC_API_KEY is not set" };
  }

  if (!key.startsWith("sk-ant-")) {
    return {
      valid: false,
      error: "ANTHROPIC_API_KEY must start with 'sk-ant-'. Check your API key format.",
    };
  }

  return { valid: true, error: null };
}

/**
 * Trims session history to prevent unbounded memory growth in long-running sessions.
 * Keeps the system prompt (always at index 0) and the most recent MAX_HISTORY messages.
 */
function trimSessionHistory(history: ChatCompletionMessageParam[]): void {
  if (history.length <= RUNTIME_CONFIG.maxHistory + 1) {
    return; // +1 for system prompt at index 0
  }

  // Keep system prompt and the most recent MAX_HISTORY messages
  const systemPrompt = history[0];
  const recentMessages = history.slice(-(RUNTIME_CONFIG.maxHistory));
  history.splice(0, history.length, systemPrompt, ...recentMessages);
}

const sessionManager = new SessionManager({ maxSessions: RUNTIME_CONFIG.maxSessions, systemPrompt: SYSTEM_PROMPT });
const jobQueue = new JobQueue();
const proposalStore = new ProposalStore();
const sessionTopics: string[] = [];

initLogger();

function clearSession(sessionId: string): void {
  const state = sessionManager.getSession(sessionId);
  state.history.splice(1);
}

function addTopic(channel: Channel, userInput: string): void {
  const topicLine = userInput.trim().slice(0, 100);
  if (topicLine) {
    sessionTopics.push(`[${channel}] ${topicLine}`);
  }
}

function expireStaleProposals(now = Date.now()): void {
  const expired = proposalStore.expireStale(now);
  for (const proposal of expired) {
    cleanupProposalArtifacts(proposal);
    logProposalExpired(proposal.id);
  }
}

async function delegateToClaudeWithReview(
  sessionId: string,
  delegatePrompt: string,
  workingDir?: string
): Promise<DelegateResult> {
  if (workingDir) {
    const wdValidation = validateWorkingDir(workingDir);
    if (!wdValidation.valid) throw new Error(wdValidation.error);
  }

  const result = await runDelegationInIsolatedWorktree({
    sessionId,
    prompt: delegatePrompt,
    repoRoot: workingDir,
    runDelegate: (prompt, cwd) => delegateToClaude(prompt, cwd),
  });

  if (result.proposal) {
    const created = proposalStore.createProposal(result.proposal);
    if (!created.ok) {
      cleanupProposalArtifacts(result.proposal);
      throw new Error(created.error || "Could not store delegated proposal.");
    }

    logProposalCreated(
      result.proposal.id,
      result.proposal.sessionId,
      result.proposal.changedFiles.length,
      result.proposal.expiresAt
    );

    return {
      exitCode: result.exitCode,
      summary: result.summary,
      proposal: {
        id: result.proposal.id,
        projectName: result.proposal.projectName,
        expiresAt: result.proposal.expiresAt,
        changedFiles: result.proposal.changedFiles,
        diffStat: result.proposal.diffStat,
        diffPreview: result.proposal.diffPreview,
        fileDiffs: result.proposal.fileDiffs,
      },
    };
  }

  return {
    exitCode: result.exitCode,
    summary: result.summary,
    noChanges: result.noChanges,
  };
}

async function processTurn(sessionId: string, channel: Channel, userInput: string, send: SendFn): Promise<void> {
  // Check if session limit is reached and this is a new session
  if (!sessionManager.hasSession(sessionId) && sessionManager.isAtLimit()) {
    await send("Server is at maximum capacity. Please try again in a moment.");
    return;
  }

  const state = sessionManager.getSession(sessionId);

  if (state.busy) {
    await send("I am still processing your previous message for this session. Please wait a moment.");
    return;
  }

  state.busy = true;
  try {
    expireStaleProposals();

    state.history.push({ role: "user", content: userInput });
    logUserInput(`[${channel}:${sessionId}] ${userInput}`);

    const control = await handleDelegationControlCommand({
      channel,
      sessionId,
      userInput,
      discordUnsafeEnableWrites: DISCORD_UNSAFE_ENABLE_WRITES,
      now: () => Date.now(),
      send,
      history: state.history,
      proposalStore,
      verifyApplyPreconditions: verifyProposalApplyPreconditions,
      applyPatch: applyProposalPatch,
      cleanupProposal: cleanupProposalArtifacts,
      onProposalExpired: (proposal) => logProposalExpired(proposal.id),
      onProposalAccepted: (proposal) => logProposalAccepted(proposal.id),
      onProposalRejected: (proposal) => logProposalRejected(proposal.id),
      onProposalApplyFailed: (proposal, reason) => logProposalApplyFailed(proposal.id, reason),
    });
    if (control.handled) {
      addTopic(channel, userInput);
      trimSessionHistory(state.history);
      return;
    }

    let safetyCounter = 0;
    let broke = false;
    while (safetyCounter < RUNTIME_CONFIG.maxActionsPerTurn) {
      safetyCounter += 1;

      let response;
      try {
        response = await callLLM(state.history);
      } catch (err) {
        // Log full error for debugging, but send sanitized message to user
        console.error(`[${channel}:${sessionId}] LLM error:`, err);
        await send("An error occurred while processing your request. Please try again.");
        state.history.pop();
        trimSessionHistory(state.history);
        return;
      }

      state.history.push({ role: "assistant", content: JSON.stringify(response) });
      logLLMResponse(response);

      const queueDelegate = (
        prompt: string,
        workingDir: string | undefined,
        sendFn: SendFn,
        history: ChatCompletionMessageParam[]
      ): QueueDelegateResult => {
        expireStaleProposals();

        const existing = proposalStore.getProposal(sessionId);
        if (existing) {
          return { status: "pending", proposalId: existing.id };
        }

        const queued = jobQueue.enqueue(
          { id: randomUUID(), sessionId, prompt, send: sendFn, history, trimHistory: () => trimSessionHistory(state.history) },
          (delegatePrompt: string) => delegateToClaudeWithReview(sessionId, delegatePrompt, workingDir)
        );
        return queued ? { status: "queued" } : { status: "full" };
      };

      const outcome = await handleTurnAction({
        channel,
        send,
        response,
        history: state.history,
        discordUnsafeEnableWrites: DISCORD_UNSAFE_ENABLE_WRITES,
        delegateEnabled: ENABLE_CLAUDE_DELEGATE,
        promptSecret,
        delegateToClaude: (prompt, workingDir) =>
          delegateToClaudeWithReview(sessionId, prompt, workingDir),
        queueDelegate,
      });
      if (outcome === "continue") {
        continue;
      }
      broke = true;
      break;
    }

    if (!broke) {
      await send("I reached the action limit for this turn without a final response. Please try again.");
    }

    addTopic(channel, userInput);

    // Trim history to prevent unbounded memory growth in long-running sessions
    trimSessionHistory(state.history);
  } finally {
    state.busy = false;
  }
}

function endSession(): void {
  logSessionSummary(sessionTopics);
  logSessionEnd();
}

function printStartupBanner(): void {
  console.log("Clanker — security-focused agent.");
  const enabledTransports = [
    ...(TRANSPORTS.repl ? ["repl"] : []),
    ...(TRANSPORTS.discord ? ["discord"] : []),
  ];
  console.log(`Enabled transports: ${enabledTransports.join(", ")}`);
  if (!ENABLE_CLAUDE_DELEGATE) {
    console.log("Claude delegation is disabled (ENABLE_CLAUDE_DELEGATE is not set).");
  }
  if (DISCORD_UNSAFE_ENABLE_WRITES) {
    console.log("WARNING: DISCORD_UNSAFE_ENABLE_WRITES is enabled. Discord can trigger write actions.");
  }
  if (REPL_INTERACTIVE_AVAILABLE) {
    console.log("Type /help for local REPL slash commands.\n");
  } else {
    console.log("Running in headless mode (REPL disabled).\n");
  }

  if (LAST_SESSION) {
    const preview = LAST_SESSION
      .replace(/^## Last Session Summary\n\n/, "")
      .split("\n")
      .slice(0, 6)
      .join("\n");
    console.log("── Last session ───────────────────────────────────────────");
    console.log(preview);
    console.log("───────────────────────────────────────────────────────────\n");
  }
}

process.on("SIGINT", () => {
  console.log("\nGoodbye.");
  endSession();
  process.exit(0);
});

async function main(): Promise<void> {
  if (TRANSPORTS.invalid.length > 0) {
    throw new Error(`Invalid CLANKER_TRANSPORTS value(s): ${TRANSPORTS.invalid.join(", ")}`);
  }

  if (!TRANSPORTS.repl && !TRANSPORTS.discord) {
    throw new Error("No transports enabled. Set CLANKER_TRANSPORTS to repl,discord, or both.");
  }

  printStartupBanner();

  let discordStarted = false;
  if (TRANSPORTS.discord) {
    discordStarted = await runDiscordTransport(processTurn);
  }

  const replRequested = TRANSPORTS.repl;
  const replAvailable = REPL_INTERACTIVE_AVAILABLE;
  if (replRequested && !replAvailable) {
    console.log("REPL requested but no interactive TTY is available. Skipping REPL transport.");
  }

  if (replAvailable) {
    await runReplTransport({
      rl,
      prompt,
      processTurn,
      clearSession,
      endSession,
    });
    return;
  }

  if (!discordStarted) {
    throw new Error("No active transport is running. Check CLANKER_TRANSPORTS and TTY availability.");
  }

  await new Promise<void>(() => {
    // Keep process alive for daemon mode when REPL is disabled.
  });
}

main().catch((err) => {
  endSession();
  console.error("Fatal error:", err);
  process.exit(1);
});
