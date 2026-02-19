import readline from "node:readline";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";
import { callLLM } from "./llm.js";
import { loadRuntimePromptContext } from "./context.js";
import { runDiscordTransport } from "./transports/discord.js";
import { runReplTransport } from "./transports/repl.js";
import type { Channel, SendFn } from "./runtime.js";
import { handleTurnAction, type DelegateResult } from "./turnHandlers.js";
import { envFlagEnabled, parseTransportsDetailed } from "./config.js";
import { evaluate } from "./policy.js";
import {
  initLogger,
  logUserInput,
  logLLMResponse,
  logSessionSummary,
  logSessionEnd,
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

async function delegateToClaude(delegatePrompt: string): Promise<DelegateResult> {
  if (!ENABLE_CLAUDE_DELEGATE) {
    throw new Error("Claude delegation is disabled. Set ENABLE_CLAUDE_DELEGATE=1 to enable it.");
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY environment variable is not set for delegation.");
  }

  const delegateModel = process.env.CLANKER_CLAUDE_ACTIVE_MODEL || "claude-sonnet-4-6";

  try {
    let fullResponse = "";
    let resultMessage: { type: string; exitCode?: number; summary?: string } = { type: "unknown" };

    const q = query({
      prompt: delegatePrompt,
      options: {
        model: delegateModel,
        tools: { type: "preset", preset: "claude_code" },
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        canUseTool: async (toolName, toolInput) => {
          // For bash_execute_command tool, evaluate the actual command string
          let commandToEvaluate = toolName;
          if (toolName === "bash_execute_command" && toolInput && typeof toolInput === "object") {
            const input = toolInput as { command?: string };
            if (input.command) {
              commandToEvaluate = input.command;
            }
          }

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
            summary: (result.result || fullResponse).slice(-800).trim(),
          };
        } else {
          resultMessage = {
            type: "error",
            exitCode: 1,
            summary: (result.errors ? result.errors.join("\n") : "Unknown error").slice(-800).trim(),
          };
        }
      } else {
        console.log(`[Delegation] Other message type:`, message.type);
      }
    }

    return {
      exitCode: resultMessage.exitCode || 0,
      summary: resultMessage.summary || fullResponse.slice(-800).trim(),
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
const REPL_INTERACTIVE_AVAILABLE = TRANSPORTS.repl && Boolean(process.stdin.isTTY && process.stdout.isTTY);
const runtimeLabel =
  process.platform === "win32"
    ? "the user's Windows PC via Git Bash"
    : process.platform === "darwin"
      ? "the user's macOS machine"
      : "a Linux environment";
const { systemPrompt: SYSTEM_PROMPT, lastSession: LAST_SESSION } = loadRuntimePromptContext(runtimeLabel);

interface SessionState {
  history: ChatCompletionMessageParam[];
  busy: boolean;
}

const sessions = new Map<string, SessionState>();
const sessionTopics: string[] = [];

initLogger();

function getSession(sessionId: string): SessionState {
  const existing = sessions.get(sessionId);
  if (existing) return existing;

  const created: SessionState = {
    history: [{ role: "system", content: SYSTEM_PROMPT }],
    busy: false,
  };
  sessions.set(sessionId, created);
  return created;
}

function clearSession(sessionId: string): void {
  const state = getSession(sessionId);
  state.history.splice(1);
}

function addTopic(channel: Channel, userInput: string): void {
  const topicLine = userInput.trim().slice(0, 100);
  if (topicLine) {
    sessionTopics.push(`[${channel}] ${topicLine}`);
  }
}

async function processTurn(sessionId: string, channel: Channel, userInput: string, send: SendFn): Promise<void> {
  const state = getSession(sessionId);

  if (state.busy) {
    await send("I am still processing your previous message for this session. Please wait a moment.");
    return;
  }

  state.busy = true;
  try {
    state.history.push({ role: "user", content: userInput });
    logUserInput(`[${channel}:${sessionId}] ${userInput}`);

    let safetyCounter = 0;
    let broke = false;
    while (safetyCounter < 8) {
      safetyCounter += 1;

      let response;
      try {
        response = await callLLM(state.history);
      } catch (err) {
        // Log full error for debugging, but send sanitized message to user
        console.error(`[${channel}:${sessionId}] LLM error:`, err);
        await send("An error occurred while processing your request. Please try again.");
        state.history.pop();
        return;
      }

      state.history.push({ role: "assistant", content: JSON.stringify(response) });
      logLLMResponse(response);

      const outcome = await handleTurnAction({
        channel,
        send,
        response,
        history: state.history,
        discordUnsafeEnableWrites: DISCORD_UNSAFE_ENABLE_WRITES,
        delegateEnabled: ENABLE_CLAUDE_DELEGATE,
        promptSecret,
        delegateToClaude,
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
  console.log("Default passphrase for write operations: mypassphrase");
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
