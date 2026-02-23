export interface DispatchConfig {
  provider: "claude" | "codex";
  githubToken: string;
  repo: string;          // "owner/repo"
  workflowId: string;    // e.g. "clanker-delegate-claude.yml"
  defaultBranch: string; // default: "main"
}

export interface DispatchResult {
  jobId: string;
  branchName: string;
  repo: string;
}
