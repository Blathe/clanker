import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadSoul(): string {
  const soulPath = join(__dirname, "..", "config", "SOUL.md");
  if (existsSync(soulPath)) {
    return readFileSync(soulPath, "utf8").trim() + "\n\n";
  }
  return "";
}

function loadMemory(): string {
  const memoryPath = join(__dirname, "..", "MEMORY.md");
  if (existsSync(memoryPath)) {
    return "## Persistent Memory\n\n" + readFileSync(memoryPath, "utf8").trim() + "\n\n";
  }
  return "";
}

function loadLastSession(): string {
  const sessionsDir = join(__dirname, "..", "sessions");
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

export function loadRuntimePromptContext(runtimeLabel: string): { systemPrompt: string; lastSession: string } {
  const soul = loadSoul();
  const memory = loadMemory();
  const lastSession = loadLastSession();

  const systemPrompt = `${soul}${memory}${lastSession}You are a local system agent running on ${runtimeLabel}.
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

  return { systemPrompt, lastSession };
}
