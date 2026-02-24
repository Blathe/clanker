import { execSync } from "node:child_process";
import type { DispatchConfig } from "./types.js";
import { getEnv, parseCsvList } from "../config.js";

function detectRepo(): string | null {
  try {
    const url = execSync("git remote get-url origin", { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
    // Parse owner/repo from SSH or HTTPS URLs
    // git@github.com:owner/repo.git → owner/repo
    // https://github.com/owner/repo.git → owner/repo
    const match = url.match(/[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export function loadDispatchConfig(): DispatchConfig | null {
  const provider = getEnv("GITHUB_DELEGATE_PROVIDER");
  if (!provider) return null;

  if (provider !== "claude" && provider !== "codex") return null;

  const githubToken = getEnv("GITHUB_TOKEN");
  if (!githubToken) return null;

  const workflowId = getEnv("GITHUB_WORKFLOW_ID");
  if (!workflowId) return null;

  const repo = getEnv("GITHUB_REPO") ?? detectRepo() ?? "";
  if (!repo) return null;

  const defaultBranch = getEnv("GITHUB_DEFAULT_BRANCH") ?? "main";

  // Parse approved repos: if GITHUB_REPOS is set, use it; otherwise, just the default repo
  const githubReposEnv = getEnv("GITHUB_REPOS");
  const approvedRepos = githubReposEnv ? parseCsvList(githubReposEnv) : [repo];

  return { provider, githubToken, repo, workflowId, defaultBranch, approvedRepos };
}
