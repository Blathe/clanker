import readline from "node:readline";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";
import { callLLM } from "./llm.js";
import { loadRuntimePromptContext } from "./context.js";
import { runDiscordTransport } from "./transports/discord.js";
import { runReplTransport } from "./transports/repl.js";
import type { Channel, SendFn } from "./runtime.js";
import { handleTurnAction } from "./turnHandlers.js";
import { envFlagEnabled, getEnv, parseTransportsDetailed } from "./config.js";
import { getRuntimeConfig } from "./runtimeConfig.js";
import { SessionManager } from "./session.js";
import { loadDispatchConfig } from "./dispatch/config.js";
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
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
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

const DISCORD_UNSAFE_ENABLE_WRITES = envFlagEnabled("DISCORD_UNSAFE_ENABLE_WRITES");
const TRANSPORTS = parseTransportsDetailed("CLANKER_TRANSPORTS");
const RUNTIME_CONFIG = getRuntimeConfig();
const REPL_INTERACTIVE_AVAILABLE = TRANSPORTS.repl && Boolean(process.stdin.isTTY && process.stdout.isTTY);
const runtimeLabel =
  process.platform === "win32"
    ? "the user's Windows PC via Git Bash"
    : process.platform === "darwin"
      ? "the user's macOS machine"
      : "a Linux environment";
const DISPATCH_CONFIG = loadDispatchConfig();
const { systemPrompt: SYSTEM_PROMPT, lastSession: LAST_SESSION } = loadRuntimePromptContext(runtimeLabel, DISPATCH_CONFIG?.approvedRepos);

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
    state.history.push({ role: "user", content: userInput });
    logUserInput(`[${channel}:${sessionId}] ${userInput}`);

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

      const outcome = await handleTurnAction({
        channel,
        send,
        response,
        history: state.history,
        discordUnsafeEnableWrites: DISCORD_UNSAFE_ENABLE_WRITES,
        dispatchConfig: DISPATCH_CONFIG,
        pollIntervalMs: RUNTIME_CONFIG.dispatchPollIntervalMs,
        pollTimeoutMs: RUNTIME_CONFIG.dispatchPollTimeoutMs,
        promptSecret,
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
  if (!DISPATCH_CONFIG) {
    console.log("GitHub Actions delegation is not configured (GITHUB_DELEGATE_PROVIDER, GITHUB_TOKEN, GITHUB_WORKFLOW_ID not set).");
  } else {
    console.log(`GitHub Actions delegation enabled: provider=${DISPATCH_CONFIG.provider}, repo=${DISPATCH_CONFIG.repo}`);
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
