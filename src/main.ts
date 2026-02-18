import readline from "node:readline";
import { spawn } from "node:child_process";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";
import { callLLM } from "./llm.js";
import { evaluate, verifySecret } from "./policy.js";
import { runCommand, formatResult, applyEdit } from "./executor.js";
import { initLogger, logUserInput, logLLMResponse, logVerdict,
         logSecretVerification, logCommandResult, logEdit,
         logDelegate, logSessionSummary, logSessionEnd } from "./logger.js";

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

function delegateToClaude(prompt: string): Promise<DelegateResult> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    delete env.CLAUDECODE;

    const proc = spawn(
      "claude",
      ["-p", prompt, "--dangerously-skip-permissions"],
      { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"], env }
    );

    // Collect stdout for the summary while streaming it to the user in real time
    const chunks: string[] = [];

    proc.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      process.stdout.write(text);
      chunks.push(text);
    });

    proc.stderr.on("data", (chunk: Buffer) => process.stderr.write(chunk));
    proc.on("error", reject);
    proc.on("close", (code) => {
      // Use the last 800 chars of output as the summary — Claude typically
      // ends with a human-readable summary of what it did
      const full = chunks.join("");
      const summary = full.slice(-800).trim();
      resolve({ exitCode: code ?? 1, summary });
    });
  });
}

// ── Load personality from config/SOUL.md ─────────────────────────────────────

function loadSoul(): string {
  const soulPath = join(dirname(fileURLToPath(import.meta.url)), "..", "config", "SOUL.md");
  if (existsSync(soulPath)) {
    return readFileSync(soulPath, "utf8").trim() + "\n\n";
  }
  return "";
}

// ── Load persistent memory from MEMORY.md ────────────────────────────────────

function loadMemory(): string {
  const memoryPath = join(dirname(fileURLToPath(import.meta.url)), "..", "MEMORY.md");
  if (existsSync(memoryPath)) {
    return "## Persistent Memory\n\n" + readFileSync(memoryPath, "utf8").trim() + "\n\n";
  }
  return "";
}

// ── Load last session summary from sessions/*.jsonl ───────────────────────────

function loadLastSession(): string {
  const sessionsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "sessions");
  if (!existsSync(sessionsDir)) return "";

  let files: string[];
  try {
    files = readdirSync(sessionsDir)
      .filter((f) => f.endsWith(".jsonl"))
      .sort(); // ISO timestamps sort lexicographically
  } catch {
    return "";
  }

  if (files.length === 0) return "";

  // Take the most recent session file
  const lastFile = join(sessionsDir, files[files.length - 1]);
  let lines: string[];
  try {
    lines = readFileSync(lastFile, "utf8").trim().split("\n").filter(Boolean);
  } catch {
    return "";
  }

  // Parse all entries once
  const entries: Record<string, unknown>[] = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line) as Record<string, unknown>);
    } catch {
      // skip malformed lines
    }
  }

  // Prefer the stored summary event (written at end of session) — it's compact and curated
  // findLast isn't available in ES2022 lib, so scan manually from the end
  let summaryEntry: Record<string, unknown> | undefined;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].ev === "summary") { summaryEntry = entries[i]; break; }
  }
  if (summaryEntry) {
    const topics = Array.isArray(summaryEntry.topics) ? (summaryEntry.topics as string[]) : [];
    if (topics.length > 0) {
      const fileName = files[files.length - 1];
      const stamp = fileName.slice(0, 19).replace(/-/g, ":").replace("T", " "); // rough ISO → readable
      return (
        "## Last Session Summary\n\n" +
        `Session (${stamp}):\n` +
        topics.map((t) => `- ${t}`).join("\n") +
        "\n\n"
      );
    }
  }

  // Fallback: reconstruct a brief narrative from raw events
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

// ── Main REPL ────────────────────────────────────────────────────────────────

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

const history: ChatCompletionMessageParam[] = [
  { role: "system", content: SYSTEM_PROMPT },
];

const SLASH_COMMANDS: Record<string, { description: string; action: () => void }> = {
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
    description: "Clear conversation history (keeps system prompt).",
    action: () => {
      history.splice(1);
      console.log("Conversation history cleared.\n");
    },
  },
};

console.log("Clanker — security-focused agent. Type your message or 'exit' to quit.");
console.log("Default passphrase for write operations: mypassphrase");
console.log("Type /help for a list of slash commands.\n");

// Print a brief recap of the previous session so the human can reorient quickly
if (LAST_SESSION) {
  const preview = LAST_SESSION
    .replace(/^## Last Session Summary\n\n/, "")
    .split("\n")
    .slice(0, 6) // show at most 6 lines
    .join("\n");
  console.log("── Last session ───────────────────────────────────────────");
  console.log(preview);
  console.log("───────────────────────────────────────────────────────────\n");
}

// Accumulates one entry per completed user turn for the end-of-session summary
const sessionTopics: string[] = [];

async function runRepl(): Promise<void> {
  while (true) {
    const userInput = await prompt("> ").catch(() => "exit");

    if (userInput.trim().toLowerCase() === "exit") {
      endSession();
      console.log("Goodbye.");
      rl.close();
      break;
    }

    const slashCommand = SLASH_COMMANDS[userInput.trim()];
    if (slashCommand) {
      slashCommand.action();
      continue;
    }

    if (!userInput.trim()) continue;

    history.push({ role: "user", content: userInput });
    logUserInput(userInput);

    // ── LLM turn loop ──────────────────────────────────────────────────────
    while (true) {
      let response;
      try {
        response = await callLLM(history);
      } catch (err) {
        console.error("LLM error:", err);
        history.pop();
        break;
      }

      history.push({ role: "assistant", content: JSON.stringify(response) });
      logLLMResponse(response);

      if (response.type === "message") {
        console.log(`\nClanker: ${response.explanation}\n`);
        break;
      }

      if (response.type === "delegate") {
        console.log(`\nClanker: ${response.explanation}`);
        console.log(`\n[DELEGATING TO CLAUDE]\n`);
        try {
          const { exitCode, summary } = await delegateToClaude(response.prompt);
          logDelegate(exitCode, summary.length);
          console.log(`\n[CLAUDE DONE] Exit code: ${exitCode}\n`);

          // Send Claude's summary back to GPT-4o — no file contents, just what was done
          history.push({
            role: "user",
            content: `Claude completed the task (exit code: ${exitCode}).\nSummary: ${summary || "No summary provided."}`,
          });
        } catch (err) {
          console.error(`[CLAUDE ERROR]`, err);
          history.push({ role: "user", content: `Claude failed to run: ${err}` });
        }
        // Loop back so GPT-4o can acknowledge the result
        continue;
      }

      if (response.type === "edit") {
        console.log(`\nClanker: ${response.explanation}`);
        console.log(`\n[EDIT REQUEST] ${response.file}`);
        console.log(`  - ${response.old.split("\n").join("\n  - ")}`);
        console.log(`  + ${response.new.split("\n").join("\n  + ")}`);

        console.log(`\n[REQUIRES PASSPHRASE] Write operations require passphrase`);
        const passphrase = await promptSecret("Enter passphrase: ");
        const verified = verifySecret("secret-for-write", passphrase);
        logSecretVerification("secret-for-write", verified);

        if (!verified) {
          console.log("[ACCESS DENIED] Incorrect passphrase.\n");
          history.push({
            role: "user",
            content: "Access denied: incorrect passphrase. The edit was not applied.",
          });
          continue;
        }

        const result = applyEdit(response.file, response.old, response.new);
        logEdit(response.file, result);
        if (result.success) {
          console.log(`[EDIT APPLIED] ${response.file}\n`);
          // Edit output stays local — do not add to history
        } else {
          console.log(`[EDIT FAILED] ${result.error}\n`);
          history.push({
            role: "user",
            content: `Edit failed: ${result.error}`,
          });
          continue;
        }
        break;
      }

      // type === "command"
      console.log(`\nClanker: ${response.explanation}`);
      console.log(`\n[TOOL REQUEST] ${response.command}`);

      const verdict = evaluate(response.command);

      switch (verdict.decision) {
        case "blocked": {
          logVerdict(response.command, verdict);
          console.log(`[BLOCKED] Rule '${verdict.rule_id}': ${verdict.reason}\n`);
          // Tell the LLM it was blocked so it can try something else
          history.push({
            role: "user",
            content: `Command blocked by policy (rule: ${verdict.rule_id}): ${verdict.reason}`,
          });
          // Loop back so LLM can respond
          continue;
        }

        case "requires-secret": {
          logVerdict(response.command, verdict);
          console.log(`[REQUIRES PASSPHRASE] ${verdict.prompt}`);
          const passphrase = await promptSecret("Enter passphrase: ");
          const verified = verifySecret(verdict.rule_id, passphrase);
          logSecretVerification(verdict.rule_id, verified);

          if (!verified) {
            console.log("[ACCESS DENIED] Incorrect passphrase.\n");
            history.push({
              role: "user",
              content: "Access denied: incorrect passphrase. The write command was not executed.",
            });
            continue;
          }

          console.log(`[EXEC] ${response.command}`);
          const result = runCommand({
            command: response.command,
            reason: response.explanation,
            working_dir: response.working_dir,
          });
          logCommandResult(response.command, result);
          console.log(formatResult(result));
          // Write output stays local — do not add to history
          break;
        }

        case "allowed": {
          logVerdict(response.command, verdict);
          console.log(`[EXEC] ${response.command}`);
          const result = runCommand({
            command: response.command,
            reason: response.explanation,
            working_dir: response.working_dir,
          });
          logCommandResult(response.command, result);
          console.log(formatResult(result));
          // Send read output back to LLM so it can plan edits
          history.push({
            role: "user",
            content: `Command output for: ${response.command}\n${formatResult(result)}`,
          });
          // Loop back so LLM can use the output
          continue;
        }
      }

      // Only reached after requires-secret success or denied — break to REPL
      break;
    }

    // Record this turn as a topic line for the end-of-session summary.
    // Keep it short: first 120 chars of the user's message is enough context.
    const topicLine = userInput.trim().slice(0, 120);
    if (topicLine) sessionTopics.push(topicLine);
  }
}

function endSession(): void {
  logSessionSummary(sessionTopics);
  logSessionEnd();
}

process.on("SIGINT", () => {
  console.log("\nGoodbye.");
  endSession();
  process.exit(0);
});

runRepl().catch((err) => {
  endSession();
  console.error("Fatal error:", err);
  process.exit(1);
});
