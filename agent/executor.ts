import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, lstatSync } from "node:fs";
import { normalize, resolve, relative } from "node:path";
import type { ExecuteCommandInput, ExecutionResult } from "./types.js";
import { getRuntimeConfig } from "./runtimeConfig.js";

export interface EditResult {
  success: boolean;
  error?: string;
}

/**
 * Validates command length to prevent performance issues during policy evaluation
 * and regex DoS attacks
 */
export function validateCommandLength(command: string): { valid: boolean; error: string | null } {
  const maxCommandLength = getRuntimeConfig().maxCommandLength;
  if (!command) {
    return { valid: false, error: "Command cannot be empty" };
  }

  if (command.length > maxCommandLength) {
    return {
      valid: false,
      error: `Command too long (${command.length} characters, max ${maxCommandLength}). Commands must be concise.`,
    };
  }

  return { valid: true, error: null };
}

/**
 * Validates that a file path is safe and within allowed boundaries.
 * Prevents path traversal attacks (e.g., ../../../../etc/passwd).
 */
function validateFilePath(file: string): { valid: boolean; error?: string } {
  if (!file || typeof file !== "string") {
    return { valid: false, error: "File path must be a non-empty string" };
  }

  // Normalize the path to resolve . and .. segments
  const normalized = normalize(file);
  const absolute = resolve(process.cwd(), normalized);
  const relative_path = relative(process.cwd(), absolute);

  // Reject if path tries to escape current directory
  if (relative_path.startsWith("..")) {
    return { valid: false, error: "Path traversal detected: cannot access files outside current directory" };
  }

  // Check for symlinks (prevent symlink-based attacks)
  try {
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) {
      return { valid: false, error: "Cannot edit files that are symbolic links" };
    }
  } catch {
    // File doesn't exist yet (for new files), which is OK
  }

  return { valid: true };
}

/**
 * Validates that a working directory is safe for command execution.
 * Prevents path traversal attacks via working_dir parameter.
 */
export function validateWorkingDir(dir: string): { valid: boolean; resolved?: string; error?: string } {
  if (!dir || typeof dir !== "string") {
    return { valid: false, error: "Working directory must be a non-empty string" };
  }

  // Normalize and resolve to absolute path
  const normalized = normalize(dir);
  const absolute = resolve(process.cwd(), normalized);
  const relative_path = relative(process.cwd(), absolute);

  // Reject if path tries to escape current directory
  if (relative_path.startsWith("..")) {
    return { valid: false, error: "Path traversal detected: working directory must be within current directory tree" };
  }

  return { valid: true, resolved: absolute };
}

export function applyEdit(file: string, oldText: string, newText: string): EditResult {
  // Validate file path to prevent traversal attacks
  const validation = validateFilePath(file);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  let contents: string;
  try {
    const absolute = resolve(process.cwd(), normalize(file));
    contents = readFileSync(absolute, "utf8");
  } catch {
    return { success: false, error: `Could not read file: ${file}` };
  }

  const occurrences = contents.split(oldText).length - 1;
  if (occurrences === 0) return { success: false, error: "Text not found in file — no changes made." };
  if (occurrences > 1) return { success: false, error: `Text appears ${occurrences} times; it must be unique to safely apply the edit.` };

  const updated = contents.replace(oldText, newText);
  try {
    const absolute = resolve(process.cwd(), normalize(file));
    writeFileSync(absolute, updated, "utf8");
  } catch {
    return { success: false, error: `Could not write file: ${file}` };
  }

  return { success: true };
}

const GIT_BASH = "C:/Program Files/Git/bin/bash.exe";

/**
 * Cap command output to prevent memory exhaustion
 * Truncates and logs warning if output exceeds limit
 */
function capOutput(output: string, label: string): string {
  const maxOutputPerCommand = getRuntimeConfig().maxOutputBytes;
  if (output.length > maxOutputPerCommand) {
    console.warn(`Output ${label} exceeded ${maxOutputPerCommand} bytes, truncating`);
    return output.slice(0, maxOutputPerCommand) + "\n[OUTPUT TRUNCATED]";
  }
  return output;
}

function buildShellArgs(command: string): { shell: string; args: string[] } {
  const shellOverride = process.env.SHELL_BIN?.trim();
  if (shellOverride) {
    return { shell: shellOverride, args: ["-c", command] };
  }

  if (process.platform === "win32") {
    return { shell: GIT_BASH, args: ["-c", command] };
  }
  return { shell: "bash", args: ["-c", command] };
}

export function runCommand(input: ExecuteCommandInput): ExecutionResult {
  const maxOutputPerCommand = getRuntimeConfig().maxOutputBytes;
  const { shell, args } = buildShellArgs(input.command);

  // Validate working_dir to prevent path traversal attacks
  let cwd = process.cwd();
  if (input.working_dir) {
    const validation = validateWorkingDir(input.working_dir);
    if (!validation.valid) {
      return {
        success: false,
        stdout: "",
        stderr: validation.error || "Invalid working directory",
        exit_code: 1,
      };
    }
    cwd = validation.resolved!;
  }

  const result = spawnSync(shell, args, {
    cwd,
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: maxOutputPerCommand,
  });

  const exit_code = result.status ?? 1;
  let stdout = result.stdout ?? "";
  let stderr = result.stderr ?? "";

  // Cap output to prevent memory exhaustion
  stdout = capOutput(stdout, "stdout");
  stderr = capOutput(stderr, "stderr");

  // spawnSync sets error property on timeout or spawn failure
  if (result.error) {
    return {
      success: false,
      stdout: "",
      stderr: capOutput(result.error.message, "error"),
      exit_code: 1,
    };
  }

  return {
    success: exit_code === 0,
    stdout,
    stderr,
    exit_code,
  };
}

export function formatResult(result: ExecutionResult, message?: string): string {
  const summary =
    message?.trim() ||
    (result.success ? "Command completed." : "Command failed.");

  const output = [result.stdout, result.stderr]
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join("\n");

  if (!output) {
    return result.success
      ? summary
      : `${summary}\n\nNo output was produced.`;
  }

  return `${summary}\n\n${output}`;
}
