import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileJobRepository } from "../../../agent/jobs/repository.js";

describe("job repository", () => {
  test("writes markdown summary under jobs/YYYY/MM", () => {
    const root = mkdtempSync(join(tmpdir(), "clanker-jobs-"));
    const repo = new FileJobRepository({ rootDir: root });

    const result = repo.writeSummary({
      jobId: "job_2026_02_23_001",
      createdAtIso: "2026-02-23T19:00:00Z",
      status: "DONE",
      summary: "Completed scan and opened PR.",
      evidenceLinks: ["https://github.com/owner/repo/actions/runs/1"],
    });

    expect(result.filePath.endsWith("/jobs/2026/02/job_2026_02_23_001.md")).toBe(true);
    expect(existsSync(result.filePath)).toBe(true);
    const contents = readFileSync(result.filePath, "utf8");
    expect(contents).toContain("# Job job_2026_02_23_001");
    expect(contents).toContain("Status: DONE");
  });

  test("overwrites existing summary file for same job", () => {
    const root = mkdtempSync(join(tmpdir(), "clanker-jobs-"));
    const repo = new FileJobRepository({ rootDir: root });

    const first = repo.writeSummary({
      jobId: "job_same",
      createdAtIso: "2026-02-23T19:00:00Z",
      status: "EXECUTING",
      summary: "running",
      evidenceLinks: [],
    });
    repo.writeSummary({
      jobId: "job_same",
      createdAtIso: "2026-02-23T19:00:00Z",
      status: "DONE",
      summary: "done",
      evidenceLinks: [],
    });

    const contents = readFileSync(first.filePath, "utf8");
    expect(contents).toContain("Status: DONE");
    expect(contents).not.toContain("Status: EXECUTING");
  });

  test("persists via temp file rename", () => {
    const writes: Array<{ path: string; text: string }> = [];
    const renames: Array<{ from: string; to: string }> = [];
    const mkdirs: string[] = [];

    const repo = new FileJobRepository({
      rootDir: "/tmp/clanker-root",
      writeTextFile: (path: string, text: string) => {
        writes.push({ path, text });
      },
      renamePath: (from: string, to: string) => {
        renames.push({ from, to });
      },
      mkdirDir: (path: string) => {
        mkdirs.push(path);
      },
    });

    const result = repo.writeSummary({
      jobId: "job_temp",
      createdAtIso: "2026-02-23T19:00:00Z",
      status: "DONE",
      summary: "done",
      evidenceLinks: [],
    });

    expect(writes).toHaveLength(1);
    expect(writes[0].path.endsWith(".tmp")).toBe(true);
    expect(renames).toEqual([{ from: writes[0].path, to: result.filePath }]);
    expect(mkdirs.some((path) => path.endsWith("/jobs/2026/02"))).toBe(true);
  });
});
