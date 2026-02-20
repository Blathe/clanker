import { appendFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import type { LLMResponse, PolicyVerdict, ExecutionResult } from "./types.js";
import type { EditResult } from "./executor.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSIONS_DIR = join(__dirname, "..", "sessions");

const MAX_OUT = 500;
const MAX_CMD = 200;
const MAX_MSG = 300;

let sessionFile: string | null = null;
let pendingVersion: string | null = null;

function trunc(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "\u2026" : s;
}

/**
 * Filter sensitive data from output before logging
 * Removes API keys, tokens, passwords, and other credentials
 */
function filterSensitiveData(text: string): string {
  // Common patterns for sensitive data
  const patterns = [
    // API keys and tokens
    /sk-[A-Za-z0-9_-]{20,}/g, // OpenAI keys
    /sk-ant-[A-Za-z0-9_-]{20,}/g, // Anthropic keys
    /ghp_[A-Za-z0-9_]{36,}/g, // GitHub PAT
    /discord[._-]?token[=:]\s*[^\s]+/gi,
    // Environment variables with secrets
    /([A-Z_]+_(?:KEY|TOKEN|PASSWORD|SECRET))[=:]\s*[^\s]+/g,
    // Common password patterns
    /password[=:]\s*[^\s]+/gi,
    /passwd[=:]\s*[^\s]+/gi,
    // AWS/cloud credentials
    /AKIA[0-9A-Z]{16}/g,
    // SSH and authentication
    /-----BEGIN.*PRIVATE KEY-----[\s\S]*?-----END.*PRIVATE KEY-----/g,
    // URLs with credentials
    /https?:\/\/[^:]+:[^@]+@/g,
  ];

  let filtered = text;
  for (const pattern of patterns) {
    filtered = filtered.replace(pattern, "[REDACTED]");
  }
  return filtered;
}

function ts(): number {
  return Math.floor(Date.now() / 1000);
}

function lazyInit(): void {
  if (sessionFile !== null || pendingVersion === null) return;
  try {
    mkdirSync(SESSIONS_DIR, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
    sessionFile = join(SESSIONS_DIR, `${stamp}_${process.pid}.jsonl`);
    appendFileSync(sessionFile, JSON.stringify({ t: ts(), ev: "start", ver: pendingVersion }) + "\n", "utf8");
  } catch {
    // Never crash the agent due to logging failure
  }
}

function write(entry: Record<string, unknown>): void {
  lazyInit();
  if (!sessionFile) return;
  try {
    appendFileSync(sessionFile, JSON.stringify(entry) + "\n", "utf8");
  } catch {
    // Never crash the agent due to logging failure
  }
}

export function initLogger(version = "0.1.0"): void {
  pendingVersion = version;
}

export function logUserInput(input: string): void {
  write({ t: ts(), ev: "user", msg: trunc(input, MAX_MSG) });
}

export function logLLMResponse(response: LLMResponse): void {
  const base = { t: ts(), ev: "llm", type: response.type };
  switch (response.type) {
    case "command":
      write({
        ...base,
        cmd: trunc(response.command, MAX_CMD),
        msg: trunc(response.explanation, MAX_MSG),
        ...(response.working_dir ? { cwd: response.working_dir } : {}),
      });
      break;
    case "edit":
      write({ ...base, file: response.file, msg: trunc(response.explanation, MAX_MSG) });
      break;
    case "delegate":
      write({ ...base, prompt: trunc(response.prompt, MAX_MSG), msg: trunc(response.explanation, MAX_MSG) });
      break;
    case "message":
      write({ ...base, msg: trunc(response.explanation, MAX_MSG) });
      break;
  }
}

export function logVerdict(command: string, verdict: PolicyVerdict): void {
  const base = { t: ts(), ev: "policy", cmd: trunc(command, MAX_CMD), dec: verdict.decision };
  switch (verdict.decision) {
    case "allowed":
      write({ ...base, ...(verdict.rule_id ? { rule: verdict.rule_id } : {}) });
      break;
    case "blocked":
      write({ ...base, rule: verdict.rule_id, reason: verdict.reason });
      break;
    case "requires-secret":
      write({ ...base, rule: verdict.rule_id });
      break;
  }
}

export function logSecretVerification(ruleId: string, granted: boolean): void {
  write({ t: ts(), ev: "auth", rule: ruleId, granted });
}

export function logCommandResult(command: string, result: ExecutionResult): void {
  write({
    t: ts(), ev: "cmd",
    cmd: trunc(command, MAX_CMD),
    exit: result.exit_code,
    out: trunc(filterSensitiveData(result.stdout), MAX_OUT),
    err: trunc(filterSensitiveData(result.stderr), MAX_OUT),
  });
}

export function logEdit(file: string, result: EditResult): void {
  const entry: Record<string, unknown> = { t: ts(), ev: "edit", file, success: result.success };
  if (!result.success && result.error) entry.error = trunc(result.error, MAX_MSG);
  write(entry);
}

export function logDelegate(exitCode: number, summaryLen: number): void {
  write({ t: ts(), ev: "delegate", exit: exitCode, sumLen: summaryLen });
}

export function logProposalCreated(
  proposalId: string,
  sessionId: string,
  changedFiles: number,
  expiresAt: number
): void {
  write({
    t: ts(),
    ev: "proposal",
    action: "created",
    id: proposalId,
    session: sessionId,
    files: changedFiles,
    exp: Math.floor(expiresAt / 1000),
  });
}

export function logProposalAccepted(proposalId: string): void {
  write({ t: ts(), ev: "proposal", action: "accepted", id: proposalId });
}

export function logProposalRejected(proposalId: string): void {
  write({ t: ts(), ev: "proposal", action: "rejected", id: proposalId });
}

export function logProposalExpired(proposalId: string): void {
  write({ t: ts(), ev: "proposal", action: "expired", id: proposalId });
}

export function logProposalApplyFailed(proposalId: string, reason: string): void {
  write({ t: ts(), ev: "proposal", action: "apply-failed", id: proposalId, reason: trunc(reason, MAX_MSG) });
}

export function logSessionSummary(topics: string[]): void {
  if (topics.length === 0) return;
  write({ t: ts(), ev: "summary", topics });
}

export function logSessionEnd(): void {
  write({ t: ts(), ev: "end" });
}
