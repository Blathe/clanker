import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { InMemoryGitHubAdapter } from "../../../agent/github/adapter.js";
import { JobPrOrchestrator } from "../../../agent/github/prOrchestrator.js";
import { AuditWriter } from "../../../agent/jobs/auditWriter.js";
import { FileJobRepository } from "../../../agent/jobs/repository.js";
import { JobService } from "../../../agent/jobs/service.js";
import { AsyncJobSubmitter } from "../../../agent/jobs/submitter.js";

describe("async job submit flow", () => {
  test("submits async job and sends accepted/running/completed updates", async () => {
    const root = mkdtempSync(join(tmpdir(), "clanker-submitter-"));
    const service = new JobService();
    const repo = new FileJobRepository({ rootDir: root });
    const audit = new AuditWriter({ rootDir: root });
    const adapter = new InMemoryGitHubAdapter({
      owner: "owner",
      repo: "repo",
      defaultBranch: "main",
      initialFiles: {},
    });
    const prOrchestrator = new JobPrOrchestrator({ adapter });
    const submitter = new AsyncJobSubmitter({
      service,
      jobRepository: repo,
      auditWriter: audit,
      prOrchestrator,
      createJobId: () => "job_test_1",
      now: () => new Date("2026-02-23T20:00:00Z"),
    });

    const sent: string[] = [];
    await submitter.submit({
      sessionId: "sess_1",
      channel: "discord",
      userInput: "scan this repo",
      send: async (text: string) => {
        sent.push(text);
      },
    });

    expect(sent[0]).toContain("Job accepted");
    expect(sent[0]).toContain("job_test_1");

    await submitter.drain();

    expect(sent.some((msg) => /running/i.test(msg))).toBe(true);
    expect(sent.some((msg) => /completed/i.test(msg))).toBe(true);
    expect(sent.some((msg) => msg.includes("/pull/"))).toBe(true);
    expect(service.getState("job_test_1")?.status).toBe("DONE");
  });

  test("denies high-risk write without owner approval", async () => {
    const root = mkdtempSync(join(tmpdir(), "clanker-submitter-"));
    const service = new JobService();
    const repo = new FileJobRepository({ rootDir: root });
    const audit = new AuditWriter({ rootDir: root });
    const submitter = new AsyncJobSubmitter({
      service,
      jobRepository: repo,
      auditWriter: audit,
      createJobId: () => "job_denied_1",
      now: () => new Date("2026-02-23T20:00:00Z"),
    });

    const sent: string[] = [];
    await submitter.submit({
      sessionId: "sess_1",
      channel: "discord",
      userInput: "change workflow file",
      proposedTouchedPaths: ["/.github/workflows/intake.yml"],
      ownerApproved: false,
      send: async (text: string) => {
        sent.push(text);
      },
    });

    await submitter.drain();
    expect(service.getState("job_denied_1")?.status).toBe("DENIED");
    expect(sent.some((msg) => /denied/i.test(msg))).toBe(true);
  });
});
