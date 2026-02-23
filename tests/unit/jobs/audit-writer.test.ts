import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AuditWriter } from "../../../src/jobs/auditWriter.js";

describe("audit writer", () => {
  test("appends JSONL audit events under audit/YYYY/MM", () => {
    const root = mkdtempSync(join(tmpdir(), "clanker-audit-"));
    const writer = new AuditWriter({ rootDir: root });

    const first = writer.appendEvent({
      jobId: "job_1",
      atIso: "2026-02-23T19:00:00Z",
      eventType: "parsed",
      payload: { detail: "parsed ok" },
    });
    const second = writer.appendEvent({
      jobId: "job_1",
      atIso: "2026-02-23T19:01:00Z",
      eventType: "executing",
      payload: { detail: "started" },
    });

    expect(first.filePath).toBe(second.filePath);
    const lines = readFileSync(first.filePath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    const parsedFirst = JSON.parse(lines[0]);
    expect(parsedFirst.ev).toBe("parsed");
  });

  test("returns deterministic path per job and month", () => {
    const root = mkdtempSync(join(tmpdir(), "clanker-audit-"));
    const writer = new AuditWriter({ rootDir: root });

    const result = writer.appendEvent({
      jobId: "job_2",
      atIso: "2026-03-05T10:00:00Z",
      eventType: "policy_checked",
      payload: {},
    });

    expect(result.filePath.endsWith("/audit/2026/03/job_2.jsonl")).toBe(true);
  });

  test("creates audit directory before appending", () => {
    const mkdirs: string[] = [];
    const appends: Array<{ path: string; text: string }> = [];
    const writer = new AuditWriter({
      rootDir: "/tmp/clanker-root",
      mkdirDir: (path: string) => {
        mkdirs.push(path);
      },
      appendTextFile: (path: string, text: string) => {
        appends.push({ path, text });
      },
    });

    const result = writer.appendEvent({
      jobId: "job_3",
      atIso: "2026-02-23T19:00:00Z",
      eventType: "done",
      payload: { ok: true },
    });

    expect(mkdirs.some((path) => path.endsWith("/audit/2026/02"))).toBe(true);
    expect(appends).toHaveLength(1);
    expect(appends[0].path).toBe(result.filePath);
  });
});
