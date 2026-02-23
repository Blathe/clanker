import { InMemoryGitHubAdapter } from "../../../src/github/adapter.js";
import { JobPrOrchestrator } from "../../../src/github/prOrchestrator.js";

describe("job PR orchestrator", () => {
  test("opens one PR per job and groups multiple file edits", async () => {
    const adapter = new InMemoryGitHubAdapter({
      owner: "owner",
      repo: "repo",
      defaultBranch: "main",
      initialFiles: {},
    });
    const orchestrator = new JobPrOrchestrator({ adapter });

    const result = await orchestrator.openOrUpdateJobPr({
      jobId: "job_1",
      title: "Job 1 changes",
      body: "summary",
      files: {
        "jobs/2026/02/job_1.md": "# Job 1",
        "audit/2026/02/job_1.jsonl": "{\"ev\":\"done\"}\n",
      },
      commitMessage: "job_1 updates",
    });

    expect(result.pr.number).toBeGreaterThan(0);
    expect(result.changedPaths.sort()).toEqual([
      "audit/2026/02/job_1.jsonl",
      "jobs/2026/02/job_1.md",
    ]);
  });

  test("reuses existing PR for subsequent updates of same job", async () => {
    const adapter = new InMemoryGitHubAdapter({
      owner: "owner",
      repo: "repo",
      defaultBranch: "main",
      initialFiles: {},
    });
    const orchestrator = new JobPrOrchestrator({ adapter });

    const first = await orchestrator.openOrUpdateJobPr({
      jobId: "job_2",
      title: "Job 2",
      body: "first",
      files: { "jobs/2026/02/job_2.md": "# first" },
      commitMessage: "first",
    });
    const second = await orchestrator.openOrUpdateJobPr({
      jobId: "job_2",
      title: "Job 2 updated",
      body: "second",
      files: { "jobs/2026/02/job_2.md": "# second" },
      commitMessage: "second",
    });

    expect(first.pr.number).toBe(second.pr.number);
    expect(second.created).toBe(false);
  });

  test("different jobs create different PRs", async () => {
    const adapter = new InMemoryGitHubAdapter({
      owner: "owner",
      repo: "repo",
      defaultBranch: "main",
      initialFiles: {},
    });
    const orchestrator = new JobPrOrchestrator({ adapter });

    const first = await orchestrator.openOrUpdateJobPr({
      jobId: "job_a",
      title: "Job A",
      body: "a",
      files: { "jobs/2026/02/job_a.md": "# a" },
      commitMessage: "a",
    });
    const second = await orchestrator.openOrUpdateJobPr({
      jobId: "job_b",
      title: "Job B",
      body: "b",
      files: { "jobs/2026/02/job_b.md": "# b" },
      commitMessage: "b",
    });

    expect(first.pr.number).not.toBe(second.pr.number);
  });
});
