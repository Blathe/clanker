import readline from "node:readline";
import { spawn } from "node:child_process";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";
import { callLLM } from "./llm.js";
import { evaluate, verifySecret } from "./policy.js";
import { runCommand, formatResult, applyEdit } from "./executor.js";
import {
  initLogger,
  logUserInput,
  logLLMResponse,
  logVerdict,
  logSecretVerification,
  logCommandResult,
  logEdit,
  logDelegate,
  logSessionSummary,
  logSessionEnd,
} from "./logger.js";

// ── Startup checks ──────────────────────────────────────────────────────────

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

// ── readline helpers ─────────────────────────────────────────────────────────

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

// ── Claude delegation ────────────────────────────────────────────────────────

interface DelegateResult {
  exitCode: number;
  summary: string;
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

// ── Load personality/context ─────────────────────────────────────────────────

function loadSoul(): string {
  const soulPath = join(dirname(fileURLToPath(import.meta.url)), "..", "config", "SOUL.md");
  if (existsSync(soulPath)) {
    return readFileSync(soulPath, "utf8").trim() + "\n\n";
  }
  return "";
}

function loadMemory(): string {
  const memoryPath = join(dirname(fileURLToPath(import.meta.url)), "..", "MEMORY.md");
  if (existsSync(memoryPath)) {
    return "## Persistent Memory\n\n" + readFileSync(memoryPath, "utf8").trim() + "\n\n";
  }
  return "";
}

function loadLastSession(): string {
  const sessionsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "sessions");
  if (!existsSync(sessionsDir)) return "";

  let files: string[];
  try {
    files = readdirSync(sessionsDir)
      .filter((f) => f.endsWith(".jsonl"))
      .sort();
  } catch {
    return "";
  }

  if (files.length === 0) return "";

  const lastFile = join(sessionsDir, files[files.length - 1]);
  let lines: string[];
  try {
    lines = readFileSync(lastFile, "utf8").trim().split("\n").filter(Boolean);
  } catch {
    return "";
  }

  const entries: Record<string, unknown>[] = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line) as Record<string, unknown>);
    } catch {
      // skip malformed lines
    }
  }

  let summaryEntry: Record<string, unknown> | undefined;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].ev === "summary") {
      summaryEntry = entries[i];
      break;
    }
  }

  if (summaryEntry) {
    const topics = Array.isArray(summaryEntry.topics) ? (summaryEntry.topics as string[]) : [];
    if (topics.length > 0) {
      const fileName = files[files.length - 1];
      const stamp = fileName.slice(0, 19).replace(/-/g, ":").replace("T", " ");
      return "## Last Session Summary\n\n" + `Session (${stamp}):\n` + topics.map((t) => `- ${t}`).join("\n") + "\n\n";
    }
  }

  const events: string[] = [];
  for (const entry of entries) {
    switch (entry.ev) {
      case "start": {
        const stamp = files[files.length - 1].replace("_" + files[files.length - 1].split("_").pop(), "");
        events.push(`[Session started: ${stamp}]`);
        break;
      }
      case "user":
        events.push(`User: ${entry.msg}`);
        break;
      case "llm":
        if (entry.type === "message") {
          events.push(`Clanker: ${entry.msg}`);
        } else if (entry.type === "command") {
          events.push(`Clanker ran: ${entry.cmd}`);
        } else if (entry.type === "edit") {
          events.push(`Clanker edited: ${entry.file}`);
        } else if (entry.type === "delegate") {
          events.push(`Clanker delegated to Claude: ${entry.msg}`);
        }
        break;
      case "end":
        events.push("[Session ended]");
        break;
    }
  }

  if (events.length === 0) return "";

  return (
    "## Last Session Summary\n\n" +
    "Here is a brief log of what happened in the previous session. Use this for continuity.\n\n" +
    events.join("\n") +
    "\n\n"
  );
}

const SOUL = loadSoul();
const MEMORY = loadMemory();
const LAST_SESSION = loadLastSession();
initLogger();

const SYSTEM_PROMPT = `${SOUL}${MEMORY}${LAST_SESSION}You are a local system agent running on the user's Windows PC via Git Bash.
Express your personality above through the "explanation" fields — that's where your voice lives. The outer structure must always be valid JSON.
Respond with a JSON object in one of these four formats:

To run a read-only command (ls, cat, grep, find, ps, etc.):
{ "type": "command", "command": "<bash command>", "explanation": "<what this does and why>" }

To edit a single file with a known, targeted change:
{ "type": "edit", "file": "<path>", "old": "<exact text to replace>", "new": "<replacement text>", "explanation": "<what this change does>" }

To delegate a complex programming task to Claude:
{ "type": "delegate", "prompt": "<full self-contained task description>", "explanation": "<why delegating to Claude>" }

To reply with text only:
{ "type": "message", "explanation": "<your response>" }

Routing rules:
- Use "command" for simple system tasks: checking ports, listing files, searching, reading files.
- Use "edit" for small targeted changes to a single file when you have already read its contents.
- Use "delegate" for programming work: new features, refactoring, bug fixes, multi-file changes, anything requiring understanding of the codebase. Write the prompt as a complete, self-contained instruction Claude can act on immediately.
- Use "message" for questions, explanations, or anything that needs no action.
- Read command output WILL be sent back to you. Always cat a file before using "edit".
- Only propose one action per response.
Always respond with valid JSON.`;

type Channel = "repl" | "discord";
type SendFn = (text: string) => Promise<void>;

function envFlagEnabled(name: string): boolean {
  const raw = process.env[name];
  if (!raw) return false;
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

const DISCORD_UNSAFE_ENABLE_WRITES = envFlagEnabled("DISCORD_UNSAFE_ENABLE_WRITES");

interface SessionState {
  history: ChatCompletionMessageParam[];
  busy: boolean;
}

const sessions = new Map<string, SessionState>();
const sessionTopics: string[] = [];

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

      if (response.type === "message") {
        await send(response.explanation);
        break;
      }

      if (response.type === "delegate") {
        if (channel === "discord" && !DISCORD_UNSAFE_ENABLE_WRITES) {
          state.history.push({
            role: "user",
            content: "Delegate actions are disabled from Discord. Provide a message response or a read-only command.",
          });
          continue;
        }

        if (channel === "discord" && DISCORD_UNSAFE_ENABLE_WRITES) {
          await send("[UNSAFE MODE] Executing delegate action from Discord.");
        }

        await send(response.explanation);
        await send("[DELEGATING TO CLAUDE]");

        try {
          const { exitCode, summary } = await delegateToClaude(response.prompt);
          logDelegate(exitCode, summary.length);
          await send(`[CLAUDE DONE] Exit code: ${exitCode}`);
          state.history.push({
            role: "user",
            content: `Claude completed the task (exit code: ${exitCode}).\nSummary: ${summary || "No summary provided."}`,
          });
        } catch (err) {
          state.history.push({ role: "user", content: `Claude failed to run: ${err}` });
        }
        continue;
      }

      if (response.type === "edit") {
        if (channel === "discord" && !DISCORD_UNSAFE_ENABLE_WRITES) {
          state.history.push({
            role: "user",
            content: "Edit actions are disabled from Discord. Provide a message response or a read-only command.",
          });
          continue;
        }

        await send(response.explanation);
        await send(`[EDIT REQUEST] ${response.file}`);

        const verified =
          channel === "discord" && DISCORD_UNSAFE_ENABLE_WRITES
            ? true
            : verifySecret("secret-for-write", await promptSecret("Enter passphrase: "));
        logSecretVerification("secret-for-write", verified);

        if (!verified) {
          await send("[ACCESS DENIED] Incorrect passphrase.");
          state.history.push({
            role: "user",
            content: "Access denied: incorrect passphrase. The edit was not applied.",
          });
          continue;
        }

        const result = applyEdit(response.file, response.old, response.new);
        logEdit(response.file, result);
        if (result.success) {
          await send(`[EDIT APPLIED] ${response.file}`);
        } else {
          await send(`[EDIT FAILED] ${result.error}`);
          state.history.push({
            role: "user",
            content: `Edit failed: ${result.error}`,
          });
          continue;
        }
        break;
      }

      const verdict = evaluate(response.command);

      switch (verdict.decision) {
        case "blocked": {
          logVerdict(response.command, verdict);
          state.history.push({
            role: "user",
            content: `Command blocked by policy (rule: ${verdict.rule_id}): ${verdict.reason}`,
          });
          continue;
        }

        case "requires-secret": {
          logVerdict(response.command, verdict);

          if (channel === "discord" && !DISCORD_UNSAFE_ENABLE_WRITES) {
            state.history.push({
              role: "user",
              content: `Command requires local approval and cannot run from Discord (rule: ${verdict.rule_id}). Use local REPL for this action.`,
            });
            continue;
          }

          if (!(channel === "discord" && DISCORD_UNSAFE_ENABLE_WRITES)) {
            await send(`[REQUIRES PASSPHRASE] ${verdict.prompt}`);
          } else {
            await send(`[UNSAFE MODE] Running passphrase-gated command from Discord (rule: ${verdict.rule_id}).`);
          }

          const verified =
            channel === "discord" && DISCORD_UNSAFE_ENABLE_WRITES
              ? true
              : verifySecret(verdict.rule_id, await promptSecret("Enter passphrase: "));
          logSecretVerification(verdict.rule_id, verified);

          if (!verified) {
            await send("[ACCESS DENIED] Incorrect passphrase.");
            state.history.push({
              role: "user",
              content: "Access denied: incorrect passphrase. The write command was not executed.",
            });
            continue;
          }

          const result = runCommand({
            command: response.command,
            reason: response.explanation,
            working_dir: response.working_dir,
          });
          logCommandResult(response.command, result);
          await send(formatResult(result));
          break;
        }

        case "allowed": {
          logVerdict(response.command, verdict);
          const result = runCommand({
            command: response.command,
            reason: response.explanation,
            working_dir: response.working_dir,
          });
          logCommandResult(response.command, result);
          const formatted = formatResult(result);
          await send(formatted);
          state.history.push({
            role: "user",
            content: `Command output for: ${response.command}\n${formatted}`,
          });
          continue;
        }
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

function parseIdList(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

async function loadDiscordModule(): Promise<any | null> {
  try {
    const moduleName = "discord.js";
    return await import(moduleName);
  } catch {
    return null;
  }
}

function splitDiscordMessage(text: string, maxLen = 1900): string[] {
  if (text.length <= maxLen) return [text];

  const parts: string[] = [];
  let start = 0;
  while (start < text.length) {
    parts.push(text.slice(start, start + maxLen));
    start += maxLen;
  }
  return parts;
}

async function runDiscordTransport(): Promise<boolean> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    console.log("Discord transport: disabled (DISCORD_BOT_TOKEN not set).");
    return false;
  }

  const discord = await loadDiscordModule();
  if (!discord) {
    console.log("Discord transport: disabled (discord.js is not installed).");
    return false;
  }

  const allowedUsers = parseIdList(process.env.DISCORD_ALLOWED_USER_IDS);
  const allowedChannels = parseIdList(process.env.DISCORD_ALLOWED_CHANNEL_IDS);

  const client = new discord.Client({
    intents: [
      discord.GatewayIntentBits.Guilds,
      discord.GatewayIntentBits.GuildMessages,
      discord.GatewayIntentBits.DirectMessages,
      discord.GatewayIntentBits.MessageContent,
    ],
    partials: [discord.Partials.Channel],
  });

  client.on(discord.Events.ClientReady, (readyClient: { user: { tag: string } }) => {
    console.log(`Discord transport: connected as ${readyClient.user.tag}`);
  });

  client.on(discord.Events.MessageCreate, async (message: any) => {
    if (message.author?.bot) return;

    if (allowedUsers.size > 0 && !allowedUsers.has(message.author.id)) return;
    if (allowedChannels.size > 0 && !allowedChannels.has(message.channelId)) return;

    const botId = client.user?.id;
    const isDM = !message.guildId;
    const isMentioned = botId ? message.mentions?.users?.has(botId) : false;
    if (!isDM && !isMentioned) return;

    let content = String(message.content ?? "").trim();
    if (botId) {
      const mentionRegex = new RegExp(`<@!?${botId}>`, "g");
      content = content.replace(mentionRegex, "").trim();
    }
    if (!content) return;

    const sessionId = `discord:${message.channelId}:${message.author.id}`;

    const send: SendFn = async (text: string) => {
      const parts = splitDiscordMessage(text);
      for (const part of parts) {
        await message.reply(part);
      }
    };

    try {
      await processTurn(sessionId, "discord", content, send);
    } catch (err) {
      await message.reply(`Error: ${err}`);
    }
  });

  await client.login(token);
  return true;
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

const REPL_SESSION_ID = "repl:local";
const SLASH_COMMANDS: Record<string, { description: string; action: () => Promise<void> | void }> = {
  "/help": {
    description: "Print this list of available slash commands.",
    action: () => {
      console.log("\nAvailable slash commands:");
      for (const [name, { description }] of Object.entries(SLASH_COMMANDS)) {
        console.log(`  ${name.padEnd(10)} ${description}`);
      }
      console.log();
    },
  },
  "/clear": {
    description: "Clear current REPL conversation history.",
    action: () => {
      clearSession(REPL_SESSION_ID);
      console.log("Conversation history for REPL cleared.\n");
    },
  },
  "/exit": {
    description: "Gracefully exit the agent process.",
    action: () => {
      endSession();
      console.log("Goodbye.");
      rl.close();
      process.exit(0);
    },
  },
};

async function runReplTransport(): Promise<void> {
  while (true) {
    const userInput = await prompt("> ").catch(() => "exit");

    if (userInput.trim().toLowerCase() === "exit") {
      endSession();
      console.log("Goodbye.");
      rl.close();
      process.exit(0);
    }

    const slashCommand = SLASH_COMMANDS[userInput.trim()];
    if (slashCommand) {
      await slashCommand.action();
      continue;
    }

    if (!userInput.trim()) continue;

    const send: SendFn = async (text: string) => {
      console.log(`\nClanker: ${text}\n`);
    };

    await processTurn(REPL_SESSION_ID, "repl", userInput, send);
  }
}

process.on("SIGINT", () => {
  console.log("\nGoodbye.");
  endSession();
  process.exit(0);
});

async function main(): Promise<void> {
  printStartupBanner();
  await runDiscordTransport();
  await runReplTransport();
}

main().catch((err) => {
  endSession();
  console.error("Fatal error:", err);
  process.exit(1);
});
