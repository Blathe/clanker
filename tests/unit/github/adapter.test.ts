import { InMemoryGitHubAdapter } from "../../../src/github/adapter.js";

describe("in-memory github adapter", () => {
  test("creates branch from default branch and upserts files", async () => {
    const adapter = new InMemoryGitHubAdapter({
      owner: "owner",
      repo: "repo",
      defaultBranch: "main",
      initialFiles: {
        "README.md": "hello",
      },
    });

    await adapter.ensureBranch("job/job_1");
    const result = await adapter.upsertFiles({
      branch: "job/job_1",
      files: {
        "jobs/2026/02/job_1.md": "# Job",
      },
      commitMessage: "add job summary",
    });

    expect(result.changedPaths).toEqual(["jobs/2026/02/job_1.md"]);
    expect(await adapter.readFile("job/job_1", "jobs/2026/02/job_1.md")).toBe("# Job");
    expect(result.commitSha.startsWith("commit_")).toBe(true);
  });

  test("openOrUpdatePullRequest updates existing PR for same base/head", async () => {
    const adapter = new InMemoryGitHubAdapter({
      owner: "owner",
      repo: "repo",
      defaultBranch: "main",
      initialFiles: {},
    });

    const first = await adapter.openOrUpdatePullRequest({
      base: "main",
      head: "job/job_2",
      title: "Job 2",
      body: "first body",
    });
    const second = await adapter.openOrUpdatePullRequest({
      base: "main",
      head: "job/job_2",
      title: "Job 2 updated",
      body: "second body",
    });

    expect(first.number).toBe(second.number);
    expect(second.title).toBe("Job 2 updated");
  });

  test("creates distinct PR numbers for different branches", async () => {
    const adapter = new InMemoryGitHubAdapter({
      owner: "owner",
      repo: "repo",
      defaultBranch: "main",
      initialFiles: {},
    });

    const first = await adapter.openOrUpdatePullRequest({
      base: "main",
      head: "job/job_a",
      title: "A",
      body: "A",
    });
    const second = await adapter.openOrUpdatePullRequest({
      base: "main",
      head: "job/job_b",
      title: "B",
      body: "B",
    });

    expect(first.number).not.toBe(second.number);
  });
});
