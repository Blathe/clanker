export interface PullRequest {
  number: number;
  url: string;
  base: string;
  head: string;
  title: string;
  body: string;
  state: "open" | "closed";
}

export interface OpenOrUpdatePullRequestInput {
  base: string;
  head: string;
  title: string;
  body: string;
}

export interface UpsertFilesInput {
  branch: string;
  files: Record<string, string>;
  commitMessage: string;
}

export interface UpsertFilesResult {
  commitSha: string;
  changedPaths: string[];
}

export interface GitHubAdapter {
  getDefaultBranch(): Promise<string>;
  ensureBranch(branch: string, fromBranch?: string): Promise<void>;
  upsertFiles(input: UpsertFilesInput): Promise<UpsertFilesResult>;
  openOrUpdatePullRequest(input: OpenOrUpdatePullRequestInput): Promise<PullRequest>;
}

export interface InMemoryGitHubAdapterOptions {
  owner: string;
  repo: string;
  defaultBranch?: string;
  initialFiles: Record<string, string>;
}

export class InMemoryGitHubAdapter implements GitHubAdapter {
  private readonly owner: string;
  private readonly repo: string;
  private readonly defaultBranch: string;
  private readonly branches = new Map<string, Map<string, string>>();
  private readonly pullRequests: PullRequest[] = [];
  private nextCommit = 1;
  private nextPrNumber = 1;

  constructor(options: InMemoryGitHubAdapterOptions) {
    this.owner = options.owner;
    this.repo = options.repo;
    this.defaultBranch = options.defaultBranch ?? "main";
    this.branches.set(this.defaultBranch, new Map(Object.entries(options.initialFiles)));
  }

  async getDefaultBranch(): Promise<string> {
    return this.defaultBranch;
  }

  async ensureBranch(branch: string, fromBranch?: string): Promise<void> {
    if (this.branches.has(branch)) {
      return;
    }

    const source = fromBranch ?? this.defaultBranch;
    const sourceFiles = this.branches.get(source);
    if (!sourceFiles) {
      throw new Error(`Base branch does not exist: ${source}`);
    }

    this.branches.set(branch, new Map(sourceFiles));
  }

  async upsertFiles(input: UpsertFilesInput): Promise<UpsertFilesResult> {
    const branchFiles = this.branches.get(input.branch);
    if (!branchFiles) {
      throw new Error(`Branch does not exist: ${input.branch}`);
    }

    const changedPaths: string[] = [];
    for (const [path, content] of Object.entries(input.files)) {
      const previous = branchFiles.get(path);
      if (previous !== content) {
        branchFiles.set(path, content);
        changedPaths.push(path);
      }
    }

    const commitSha = `commit_${String(this.nextCommit++).padStart(6, "0")}`;
    return { commitSha, changedPaths: changedPaths.sort() };
  }

  async openOrUpdatePullRequest(input: OpenOrUpdatePullRequestInput): Promise<PullRequest> {
    const existing = this.pullRequests.find(
      (pr) => pr.base === input.base && pr.head === input.head && pr.state === "open"
    );
    if (existing) {
      existing.title = input.title;
      existing.body = input.body;
      return { ...existing };
    }

    const number = this.nextPrNumber++;
    const pr: PullRequest = {
      number,
      url: `https://github.com/${this.owner}/${this.repo}/pull/${number}`,
      base: input.base,
      head: input.head,
      title: input.title,
      body: input.body,
      state: "open",
    };
    this.pullRequests.push(pr);
    return { ...pr };
  }

  async readFile(branch: string, path: string): Promise<string | undefined> {
    return this.branches.get(branch)?.get(path);
  }
}

