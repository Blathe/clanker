import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Validates that a filename matches the expected session file format
 * Expected format: YYYY-MM-DDTHH-MM-SS_<pid>.jsonl
 */
function isValidSessionFilename(filename: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}_\d+\.jsonl$/.test(filename);
}

/**
 * Filters filenames to only valid session files
 */
function filterValidSessionFiles(filenames: string[]): string[] {
  return filenames.filter(isValidSessionFilename);
}

/**
 * Extracts the timestamp from a session filename
 * Expected format: YYYY-MM-DDTHH-MM-SS_<pid>.jsonl
 * Returns timestamp in format "YYYY-MM-DD HH:MM:SS" for display
 */
function extractSessionTimestamp(filename: string): string | null {
  // Validate filename format: should end with _<numbers>.jsonl
  const match = filename.match(/^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})_(\d+)\.jsonl$/);
  if (!match) {
    return null; // Invalid format
  }

  const timestamp = match[1]; // e.g., "2024-01-15T14-30-45"
  // Convert T to space and hyphens to colons in time portion
  // "2024-01-15T14-30-45" -> "2024-01-15 14:30:45"
  return timestamp.replace("T", " ").replace(/-(\d{2})-(\d{2})$/, ":$1:$2");
}

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
      .filter(isValidSessionFilename) // Only accept properly formatted session files
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
      const stamp = extractSessionTimestamp(fileName) || "unknown time";
      return "## Last Session Summary\n\n" + `Session (${stamp}):\n` + topics.map((t) => `- ${t}`).join("\n") + "\n\n";
    }
  }

  const events: string[] = [];
  for (const entry of entries) {
    switch (entry.ev) {
      case "start": {
        const fileName = files[files.length - 1];
        const stamp = extractSessionTimestamp(fileName) || "unknown time";
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
      case "proposal":
        events.push(`Proposal event: ${entry.action} (${entry.id})`);
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
- Delegated tasks run in review mode: Clanker will return a proposal diff and user must explicitly /accept or /reject.
- When user asks to apply or reject delegated changes, Clanker handles /accept, /reject, and /pending directly.
- Use "message" for questions, explanations, or anything that needs no action.
- Read command output WILL be sent back to you. Always cat a file before using "edit".
- Only propose one action per response.
Always respond with valid JSON.`;

  return { systemPrompt, lastSession };
}
