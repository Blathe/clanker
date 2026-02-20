import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import type { PendingProposal } from "./proposals.js";

export interface GitRunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type GitRunner = (args: string[], cwd: string) => GitRunResult;

function defaultGitRunner(args: string[], cwd: string): GitRunResult {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function defaultCreateTempDir(): string {
  return mkdtempSync(join(tmpdir(), "clanker-delegate-"));
}

function defaultWriteTextFile(path: string, text: string): void {
  writeFileSync(path, text, "utf8");
}

function defaultRemovePath(path: string): void {
  rmSync(path, { recursive: true, force: true });
}

function runGitOrThrow(
  runGit: GitRunner,
  args: string[],
  cwd: string,
  errPrefix: string
): GitRunResult {
  const result = runGit(args, cwd);
  if (result.code !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || "unknown git error";
    throw new Error(`${errPrefix}: ${detail}`);
  }
  return result;
}

function previewFromDiff(diff: string, maxLines = 80, maxChars = 3000): string {
  const limitedLines = diff.split("\n").slice(0, maxLines).join("\n");
  return limitedLines.length > maxChars ? limitedLines.slice(0, maxChars) : limitedLines;
}

export interface WorktreeDelegationInput {
  sessionId: string;
  prompt: string;
  runDelegate: (prompt: string, cwd: string) => Promise<{ exitCode: number; summary: string }>;
  ttlMs?: number;
  now?: () => number;
  runGit?: GitRunner;
  createTempDir?: () => string;
  writeTextFile?: (path: string, text: string) => void;
  removePath?: (path: string) => void;
}

export interface WorktreeDelegationResult {
  exitCode: number;
  summary: string;
  proposal?: PendingProposal;
  noChanges?: boolean;
}

export interface ValidationResult {
  ok: boolean;
  error?: string;
}

export async function runDelegationInIsolatedWorktree(
  input: WorktreeDelegationInput
): Promise<WorktreeDelegationResult> {
  const runGit = input.runGit ?? defaultGitRunner;
  const now = input.now ?? (() => Date.now());
  const ttlMs = input.ttlMs ?? 15 * 60 * 1000;
  const createTempDir = input.createTempDir ?? defaultCreateTempDir;
  const writeTextFile = input.writeTextFile ?? defaultWriteTextFile;
  const removePath = input.removePath ?? defaultRemovePath;

  const repoRoot = runGitOrThrow(
    runGit,
    ["rev-parse", "--show-toplevel"],
    process.cwd(),
    "Failed to locate git repository"
  ).stdout.trim();

  const statusOutput = runGitOrThrow(
    runGit,
    ["status", "--porcelain"],
    repoRoot,
    "Failed to check repository status"
  ).stdout.trim();
  if (statusOutput) {
    throw new Error("Delegation review mode requires a clean repository; working tree is not clean.");
  }

  const baseHead = runGitOrThrow(
    runGit,
    ["rev-parse", "HEAD"],
    repoRoot,
    "Failed to resolve current HEAD"
  ).stdout.trim();

  const worktreePath = createTempDir();
  const patchDir = createTempDir();
  const patchPath = join(patchDir, "proposal.patch");
  let worktreeCreated = false;

  try {
    runGitOrThrow(
      runGit,
      ["worktree", "add", "--detach", worktreePath, baseHead],
      repoRoot,
      "Failed to create isolated worktree"
    );
    worktreeCreated = true;

    const delegated = await input.runDelegate(input.prompt, worktreePath);
    const diff = runGitOrThrow(
      runGit,
      ["diff", "--binary", "--no-color"],
      worktreePath,
      "Failed to build diff for delegated changes"
    ).stdout;

    if (!diff.trim()) {
      cleanupWorktree(repoRoot, worktreePath, runGit);
      removePath(patchDir);
      return {
        exitCode: delegated.exitCode,
        summary: delegated.summary,
        noChanges: true,
      };
    }

    const diffStat = runGitOrThrow(
      runGit,
      ["diff", "--stat", "--no-color"],
      worktreePath,
      "Failed to build diffstat for delegated changes"
    ).stdout.trim();
    const changedFiles = runGitOrThrow(
      runGit,
      ["diff", "--name-only", "--no-color"],
      worktreePath,
      "Failed to list changed files for delegated changes"
    )
      .stdout
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

    writeTextFile(patchPath, diff);
    const createdAt = now();
    return {
      exitCode: delegated.exitCode,
      summary: delegated.summary,
      proposal: {
        id: `p-${randomUUID()}`,
        sessionId: input.sessionId,
        createdAt,
        expiresAt: createdAt + ttlMs,
        repoRoot,
        baseHead,
        worktreePath,
        patchPath,
        changedFiles,
        diffStat,
        diffPreview: previewFromDiff(diff),
        delegateSummary: delegated.summary,
        delegateExitCode: delegated.exitCode,
      },
    };
  } catch (err) {
    if (worktreeCreated) {
      cleanupWorktree(repoRoot, worktreePath, runGit);
    }
    removePath(patchDir);
    throw err;
  }
}

export function verifyProposalApplyPreconditions(
  proposal: PendingProposal,
  runGit: GitRunner = defaultGitRunner
): ValidationResult {
  const status = runGit(["status", "--porcelain"], proposal.repoRoot);
  if (status.code !== 0) {
    return {
      ok: false,
      error: `Failed to check repository status before apply: ${status.stderr.trim() || status.stdout.trim()}`,
    };
  }
  if (status.stdout.trim()) {
    return {
      ok: false,
      error: "Cannot apply proposal: repository has uncommitted changes.",
    };
  }

  const head = runGit(["rev-parse", "HEAD"], proposal.repoRoot);
  if (head.code !== 0) {
    return {
      ok: false,
      error: `Failed to read repository HEAD before apply: ${head.stderr.trim() || head.stdout.trim()}`,
    };
  }
  if (head.stdout.trim() !== proposal.baseHead) {
    return {
      ok: false,
      error: "Cannot apply proposal: repository HEAD changed since proposal creation.",
    };
  }

  return { ok: true };
}

export function applyProposalPatch(
  proposal: PendingProposal,
  runGit: GitRunner = defaultGitRunner
): ValidationResult {
  const apply = runGit(["apply", "--whitespace=nowarn", proposal.patchPath], proposal.repoRoot);
  if (apply.code !== 0) {
    const detail = apply.stderr.trim() || apply.stdout.trim() || "git apply failed";
    return { ok: false, error: `Failed to apply proposal patch: ${detail}` };
  }
  return { ok: true };
}

export function cleanupProposalArtifacts(
  proposal: PendingProposal,
  runGit: GitRunner = defaultGitRunner,
  removePath: (path: string) => void = defaultRemovePath
): void {
  cleanupWorktree(proposal.repoRoot, proposal.worktreePath, runGit);
  removePath(proposal.patchPath);
  removePath(dirname(proposal.patchPath));
}

function cleanupWorktree(repoRoot: string, worktreePath: string, runGit: GitRunner): void {
  runGit(["worktree", "remove", "--force", worktreePath], repoRoot);
}
