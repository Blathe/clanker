import type { GitHubAdapter, PullRequest } from "./adapter.js";

export interface OpenOrUpdateJobPrInput {
  jobId: string;
  title: string;
  body: string;
  files: Record<string, string>;
  commitMessage: string;
}

export interface OpenOrUpdateJobPrResult {
  pr: PullRequest;
  branch: string;
  commitSha: string;
  changedPaths: string[];
  created: boolean;
}

export interface JobPrOrchestratorOptions {
  adapter: GitHubAdapter;
}

function sanitizeJobId(jobId: string): string {
  return jobId.replace(/[^A-Za-z0-9._-]/g, "-");
}

export class JobPrOrchestrator {
  private readonly adapter: GitHubAdapter;
  private readonly jobToPrNumber = new Map<string, number>();

  constructor(options: JobPrOrchestratorOptions) {
    this.adapter = options.adapter;
  }

  async openOrUpdateJobPr(input: OpenOrUpdateJobPrInput): Promise<OpenOrUpdateJobPrResult> {
    const base = await this.adapter.getDefaultBranch();
    const branch = `job/${sanitizeJobId(input.jobId)}`;

    await this.adapter.ensureBranch(branch, base);
    const upsert = await this.adapter.upsertFiles({
      branch,
      files: input.files,
      commitMessage: input.commitMessage,
    });
    const pr = await this.adapter.openOrUpdatePullRequest({
      base,
      head: branch,
      title: input.title,
      body: input.body,
    });

    const created = !this.jobToPrNumber.has(input.jobId);
    this.jobToPrNumber.set(input.jobId, pr.number);

    return {
      pr,
      branch,
      commitSha: upsert.commitSha,
      changedPaths: upsert.changedPaths,
      created,
    };
  }
}

