import type { DispatchConfig, DispatchResult } from "./types.js";

export async function dispatchWorkflow(
  config: DispatchConfig,
  prompt: string,
  repoOverride?: string
): Promise<DispatchResult> {
  const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const branchName = `clanker/${jobId}`;

  // Use repoOverride if provided, otherwise fall back to config.repo
  const effectiveRepo = repoOverride ?? config.repo;

  const url = `https://api.github.com/repos/${effectiveRepo}/actions/workflows/${config.workflowId}/dispatches`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${config.githubToken}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ref: config.defaultBranch,
      inputs: { prompt, branch_name: branchName },
    }),
  });

  if (response.status !== 204) {
    const body = await response.text().catch(() => "(no body)");
    throw new Error(
      `GitHub workflow dispatch failed: HTTP ${response.status} — ${body}`
    );
  }

  return { jobId, branchName, repo: effectiveRepo };
}
