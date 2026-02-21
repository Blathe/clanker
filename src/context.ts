import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  composeSystemPromptFromTemplates,
  loadPromptTemplates,
} from "./prompt/loadPrompts.js";

/**
 * Validates that a filename matches the expected session file format
 * Expected format: YYYY-MM-DDTHH-MM-SS_<pid>.jsonl
 */
function isValidSessionFilename(filename: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}_\d+\.jsonl$/.test(filename);
}

/**
 * Extracts the timestamp from a session filename
 * Expected format: YYYY-MM-DDTHH-MM-SS_<pid>.jsonl
 * Returns timestamp in format "YYYY-MM-DD HH:MM:SS" for display
 */
function extractSessionTimestamp(filename: string): string | null {
  const match = filename.match(/^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})_(\d+)\.jsonl$/);
  if (!match) {
    return null;
  }

  const timestamp = match[1];
  return timestamp.replace("T", " ").replace(/-(\d{2})-(\d{2})$/, ":$1:$2");
}

function loadSoul(): string {
  const soulPath = join(process.cwd(), "config", "SOUL.md");
  if (existsSync(soulPath)) {
    return readFileSync(soulPath, "utf8").trim() + "\n\n";
  }
  return "";
}

function loadMemory(): string {
  const memoryPath = join(process.cwd(), "MEMORY.md");
  if (existsSync(memoryPath)) {
    return "## Persistent Memory\n\n" + readFileSync(memoryPath, "utf8").trim() + "\n\n";
  }
  return "";
}

export function loadLastSession(sessionsDir?: string): string {
  if (!sessionsDir) sessionsDir = join(process.cwd(), "sessions");
  if (!existsSync(sessionsDir)) return "";

  let files: string[];
  try {
    files = readdirSync(sessionsDir)
      .filter((f) => f.endsWith(".jsonl"))
      .filter(isValidSessionFilename)
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
      // Skip malformed lines
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
      return (
        "## Last Session Summary\n\n" +
        `Session (${stamp}):\n` +
        topics.map((t) => `- ${t}`).join("\n") +
        "\n\n"
      );
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
  const templates = loadPromptTemplates();

  const systemPrompt = composeSystemPromptFromTemplates({
    runtimeLabel,
    soul,
    memory,
    lastSession,
    templates,
  });

  return { systemPrompt, lastSession };
}
