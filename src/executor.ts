import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import type { ExecuteCommandInput, ExecutionResult } from "./types.js";

export interface EditResult {
  success: boolean;
  error?: string;
}

export function applyEdit(file: string, oldText: string, newText: string): EditResult {
  let contents: string;
  try {
    contents = readFileSync(file, "utf8");
  } catch {
    return { success: false, error: `Could not read file: ${file}` };
  }

  if (!contents.includes(oldText)) {
    return { success: false, error: `Text not found in file — no changes made.\nSearched for:\n${oldText}` };
  }

  const updated = contents.replace(oldText, newText);
  try {
    writeFileSync(file, updated, "utf8");
  } catch {
    return { success: false, error: `Could not write file: ${file}` };
  }

  return { success: true };
}

const GIT_BASH = "C:/Program Files/Git/bin/bash.exe";

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
  const { shell, args } = buildShellArgs(input.command);
  const result = spawnSync(shell, args, {
    cwd: input.working_dir ?? process.cwd(),
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 512 * 1024,
  });

  const exit_code = result.status ?? 1;
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";

  // spawnSync sets error property on timeout or spawn failure
  if (result.error) {
    return {
      success: false,
      stdout: "",
      stderr: result.error.message,
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

export function formatResult(result: ExecutionResult): string {
  return `Exit code: ${result.exit_code}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`;
}
