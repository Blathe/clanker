export interface DispatchConfig {
  provider: "claude" | "codex";
  githubToken: string;
  repo: string;          // "owner/repo" (default repo when no repo specified in delegate)
  workflowId: string;    // e.g. "clanker-delegate-claude.yml"
  defaultBranch: string; // default: "main"
  approvedRepos: string[]; // pre-approved list of "owner/repo" targets
}

export interface DispatchResult {
  jobId: string;
  branchName: string;
  repo: string;
}
