import readline from "node:readline";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";
import { callLLM } from "./llm.js";
import { loadRuntimePromptContext } from "./context.js";
import { runDiscordTransport } from "./transports/discord.js";
import { runReplTransport } from "./transports/repl.js";
import type { Channel, SendFn } from "./runtime.js";
import { handleTurnAction, type DelegateResult } from "./turnHandlers.js";
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

function delegateToClaude(delegatePrompt: string): Promise<DelegateResult> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.CLAUDECODE;

    const proc = spawn("claude", ["-p", delegatePrompt, "--dangerously-skip-permissions"], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env,
    });

    const chunks: string[] = [];

    proc.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      process.stdout.write(text);
      chunks.push(text);
    });

    proc.stderr.on("data", (chunk: Buffer) => process.stderr.write(chunk));
    proc.on("error", reject);
    proc.on("close", (code) => {
      const full = chunks.join("");
      const summary = full.slice(-800).trim();
      resolve({ exitCode: code ?? 1, summary });
    });
  });
}

function envFlagEnabled(name: string): boolean {
  const raw = process.env[name];
  if (!raw) return false;
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

const DISCORD_UNSAFE_ENABLE_WRITES = envFlagEnabled("DISCORD_UNSAFE_ENABLE_WRITES");
const { systemPrompt: SYSTEM_PROMPT, lastSession: LAST_SESSION } = loadRuntimePromptContext();

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
    while (safetyCounter < 8) {
      safetyCounter += 1;

      let response;
      try {
        response = await callLLM(state.history);
      } catch (err) {
        await send(`LLM error: ${err}`);
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
        promptSecret,
        delegateToClaude,
      });
      if (outcome === "continue") {
        continue;
      }
      break;
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
  console.log("REPL and Discord transports can run together.");
  console.log("Default passphrase for write operations: mypassphrase");
  if (DISCORD_UNSAFE_ENABLE_WRITES) {
    console.log("WARNING: DISCORD_UNSAFE_ENABLE_WRITES is enabled. Discord can trigger write/delegate actions.");
  }
  console.log("Type /help for local REPL slash commands.\n");

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
  printStartupBanner();
  await runDiscordTransport(processTurn);
  await runReplTransport({
    rl,
    prompt,
    processTurn,
    clearSession,
    endSession,
  });
}

main().catch((err) => {
  endSession();
  console.error("Fatal error:", err);
  process.exit(1);
});
