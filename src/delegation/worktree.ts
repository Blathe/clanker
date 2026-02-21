import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname, basename, resolve, normalize, sep } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import type { PendingProposal } from "./proposals.js";
import type { ProposalFileDiff } from "./types.js";
import { getRuntimeConfig } from "../runtimeConfig.js";

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

function previewFromDiff(diff: string, maxLines?: number, maxChars?: number): string {
  const runtimeConfig = getRuntimeConfig();
  const effectiveMaxLines = maxLines ?? runtimeConfig.delegateDiffPreviewMaxLines;
  const effectiveMaxChars = maxChars ?? runtimeConfig.delegateDiffPreviewMaxChars;
  const limited = diff.split("\n").slice(0, effectiveMaxLines).join("\n");
  return limited.length > effectiveMaxChars ? limited.slice(0, effectiveMaxChars) : limited;
}

function inferLanguage(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".ts") || lower.endsWith(".tsx")) return "TypeScript";
  if (lower.endsWith(".js") || lower.endsWith(".jsx") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) return "JavaScript";
  if (lower.endsWith(".py")) return "Python";
  if (lower.endsWith(".go")) return "Go";
  if (lower.endsWith(".rs")) return "Rust";
  if (lower.endsWith(".java")) return "Java";
  if (lower.endsWith(".cs")) return "C#";
  if (lower.endsWith(".c")) return "C";
  if (lower.endsWith(".cpp") || lower.endsWith(".cc") || lower.endsWith(".cxx") || lower.endsWith(".hpp") || lower.endsWith(".h")) return "C++";
  if (lower.endsWith(".php")) return "PHP";
  if (lower.endsWith(".rb")) return "Ruby";
  if (lower.endsWith(".swift")) return "Swift";
  if (lower.endsWith(".kt") || lower.endsWith(".kts")) return "Kotlin";
  if (lower.endsWith(".scala")) return "Scala";
  if (lower.endsWith(".sh") || lower.endsWith(".bash")) return "Shell";
  if (lower.endsWith(".sql")) return "SQL";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "HTML";
  if (lower.endsWith(".css")) return "CSS";
  if (lower.endsWith(".scss")) return "SCSS";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "Markdown";
  if (lower.endsWith(".json")) return "JSON";
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return "YAML";
  if (lower.endsWith(".xml")) return "XML";
  if (lower.endsWith(".toml")) return "TOML";
  if (lower.endsWith(".dockerfile") || lower === "dockerfile") return "Dockerfile";
  return "Text";
}

export interface WorktreeDelegationInput {
  sessionId: string;
  prompt: string;
  repoRoot?: string;
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
  const runtimeConfig = getRuntimeConfig();
  const runGit = input.runGit ?? defaultGitRunner;
  const now = input.now ?? (() => Date.now());
  const ttlMs = input.ttlMs ?? runtimeConfig.delegateProposalTtlMs;
  const createTempDir = input.createTempDir ?? defaultCreateTempDir;
  const writeTextFile = input.writeTextFile ?? defaultWriteTextFile;
  const removePath = input.removePath ?? defaultRemovePath;
  const locateFrom = (input.repoRoot && input.repoRoot.trim()) || process.cwd();

  const repoRoot = runGitOrThrow(
    runGit,
    ["rev-parse", "--show-toplevel"],
    locateFrom,
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
    const fileDiffs: ProposalFileDiff[] = changedFiles.map((filePath) => {
      const diff = runGitOrThrow(
        runGit,
        ["diff", "--no-color", "--", filePath],
        worktreePath,
        `Failed to build per-file diff for ${filePath}`
      ).stdout;
      return {
        filePath,
        language: inferLanguage(filePath),
        diff,
      };
    });

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
        projectName: basename(repoRoot) || "project",
        repoRoot,
        baseHead,
        worktreePath,
        patchPath,
        changedFiles,
        diffStat,
        diffPreview: previewFromDiff(diff),
        fileDiffs,
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
  const expectedDir = resolve(tmpdir()) + sep;
  const resolvedPatch = resolve(normalize(proposal.patchPath));
  if (!resolvedPatch.startsWith(expectedDir)) {
    return { ok: false, error: "Proposal patch path is outside expected temp directory." };
  }

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
