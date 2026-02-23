import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileCronRepository } from "../../../agent/scheduler/cronRepository.js";

function sampleJob(jobId = "cron_daily_intel") {
  return {
    job_id: jobId,
    enabled: true,
    timezone: "America/Los_Angeles",
    schedule_cron: "0 17 * * *",
    cron_summary: "Every day at 5:00 PM America/Los_Angeles.",
    cron_notes: null,
    next_runs_utc: ["2026-02-24T01:00:00Z"],
    next_runs_local: ["2026-02-23 5:00 PM America/Los_Angeles"],
    job_spec: {
      intent: "SELF_REVIEW_INTEL",
      inputs: { since: "last_run" },
      constraints: { allowed_domains: ["github.com"], max_prs: 2 },
    },
    last_run: { at: "2026-02-22T01:00:00Z", status: "DONE" },
  };
}

describe("cron repository", () => {
  test("starts empty when file does not exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "clanker-cron-"));
    const filePath = join(dir, "jobs.json");
    const repo = new FileCronRepository({ filePath, nowIso: () => "2026-02-23T12:00:00Z" });

    expect(repo.listJobs()).toEqual([]);
  });

  test("upserts and persists jobs across instances", () => {
    const dir = mkdtempSync(join(tmpdir(), "clanker-cron-"));
    const filePath = join(dir, "jobs.json");
    const first = new FileCronRepository({ filePath, nowIso: () => "2026-02-23T12:00:00Z" });
    first.upsertJob(sampleJob());

    const second = new FileCronRepository({ filePath });
    expect(second.listJobs()).toHaveLength(1);
    expect(second.getJob("cron_daily_intel")?.timezone).toBe("America/Los_Angeles");
  });

  test("updates existing job (mutable schedule registry)", () => {
    const dir = mkdtempSync(join(tmpdir(), "clanker-cron-"));
    const filePath = join(dir, "jobs.json");
    const repo = new FileCronRepository({ filePath, nowIso: () => "2026-02-23T12:00:00Z" });
    repo.upsertJob(sampleJob());
    repo.upsertJob({ ...sampleJob(), schedule_cron: "0 9 * * 1-5" });

    const entry = repo.getJob("cron_daily_intel");
    expect(entry?.schedule_cron).toBe("0 9 * * 1-5");
    expect(repo.listJobs()).toHaveLength(1);
  });

  test("deletes job by id", () => {
    const dir = mkdtempSync(join(tmpdir(), "clanker-cron-"));
    const filePath = join(dir, "jobs.json");
    const repo = new FileCronRepository({ filePath, nowIso: () => "2026-02-23T12:00:00Z" });
    repo.upsertJob(sampleJob());
    repo.deleteJob("cron_daily_intel");

    expect(repo.listJobs()).toEqual([]);
  });

  test("writes through temp file rename on persist", () => {
    const filePath = "/tmp/cron/jobs.json";
    const writes: Array<{ path: string; text: string }> = [];
    const renames: Array<{ from: string; to: string }> = [];

    const repo = new FileCronRepository({
      filePath,
      readTextFile: () => {
        throw new Error("not found");
      },
      writeTextFile: (path: string, text: string) => {
        writes.push({ path, text });
      },
      renamePath: (from: string, to: string) => {
        renames.push({ from, to });
      },
      mkdirDir: () => undefined,
      nowIso: () => "2026-02-23T12:00:00Z",
    });

    repo.upsertJob(sampleJob());
    expect(writes).toHaveLength(1);
    expect(writes[0].path.endsWith(".tmp")).toBe(true);
    expect(renames).toEqual([{ from: writes[0].path, to: filePath }]);
  });

  test("throws on malformed persisted schema", () => {
    const dir = mkdtempSync(join(tmpdir(), "clanker-cron-"));
    const filePath = join(dir, "jobs.json");
    // version is required to be number; this should fail schema parse
    writeFileSync(filePath, JSON.stringify({ version: "x", jobs: [] }), "utf8");

    expect(() => new FileCronRepository({ filePath })).toThrow();
  });

  test("persists version and updated_at fields", () => {
    const dir = mkdtempSync(join(tmpdir(), "clanker-cron-"));
    const filePath = join(dir, "jobs.json");
    const repo = new FileCronRepository({ filePath, nowIso: () => "2026-02-23T12:00:00Z" });
    repo.upsertJob(sampleJob());

    const raw = JSON.parse(readFileSync(filePath, "utf8"));
    expect(raw.version).toBe(1);
    expect(raw.updated_at).toBe("2026-02-23T12:00:00Z");
  });
});
