import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  FileProposalRepository,
  InMemoryProposalRepository,
  type StoredProposalRecord,
} from "../../../agent/delegation/repository.js";

function sampleRecord(overrides: Partial<StoredProposalRecord> = {}): StoredProposalRecord {
  return {
    proposal: {
      id: "p-1",
      sessionId: "s-1",
      createdAt: 1000,
      expiresAt: 9_999_999_999_999,
      projectName: "repo",
      repoRoot: "/repo",
      baseHead: "abc123",
      worktreePath: "/tmp/wt",
      patchPath: "/tmp/patch.patch",
      changedFiles: ["src/a.ts"],
      diffStat: " src/a.ts | 1 +",
      diffPreview: "diff --git../agent/a.ts../agent/a.ts",
      fileDiffs: [
        {
          filePath: "src/a.ts",
          language: "TypeScript",
          diff: "diff --git../agent/a.ts../agent/a.ts\n+const a = 1;",
        },
      ],
      delegateSummary: "done",
      delegateExitCode: 0,
    },
    state: {
      status: "proposal_ready",
      changedAt: 1000,
      proposalId: "p-1",
    },
    ...overrides,
  };
}

describe("proposal repositories", () => {
  test("in-memory repository set/get/delete lifecycle", () => {
    const repo = new InMemoryProposalRepository();
    const record = sampleRecord();

    repo.set(record);
    expect(repo.has("s-1")).toBe(true);
    expect(repo.get("s-1")?.proposal.id).toBe("p-1");

    repo.delete("s-1");
    expect(repo.has("s-1")).toBe(false);
    expect(repo.get("s-1")).toBeNull();
  });

  test("file repository persists records across instances", () => {
    const dir = mkdtempSync(join(tmpdir(), "clanker-proposals-"));
    const filePath = join(dir, "proposals.json");
    const patchPath = join(dir, "proposal.patch");
    writeFileSync(patchPath, "diff --git", "utf8");

    const record = sampleRecord({
      proposal: {
        ...sampleRecord().proposal,
        patchPath,
      },
    });
    const first = new FileProposalRepository({ filePath });
    first.set(record);

    const second = new FileProposalRepository({ filePath });
    expect(second.has("s-1")).toBe(true);
    expect(second.get("s-1")?.state.status).toBe("proposal_ready");
    expect(second.list()).toHaveLength(1);
  });

  test("file repository tolerates malformed JSON and recovers on write", () => {
    const dir = mkdtempSync(join(tmpdir(), "clanker-proposals-"));
    const filePath = join(dir, "proposals.json");
    writeFileSync(filePath, "{not-json", "utf8");

    const repo = new FileProposalRepository({ filePath });
    expect(repo.list()).toEqual([]);

    repo.set(sampleRecord());
    expect(repo.has("s-1")).toBe(true);
  });

  test("file repository persists via temp file rename", () => {
    const dir = mkdtempSync(join(tmpdir(), "clanker-proposals-"));
    const filePath = join(dir, "proposals.json");
    const writes: Array<{ path: string; text: string }> = [];
    const renames: Array<{ from: string; to: string }> = [];
    const mkdirs: string[] = [];

    const repo = new FileProposalRepository({
      filePath,
      mkdirDir: (path) => {
        mkdirs.push(path);
      },
      readTextFile: () => {
        throw new Error("not found");
      },
      writeTextFile: (path, text) => {
        writes.push({ path, text });
      },
      renamePath: (from, to) => {
        renames.push({ from, to });
      },
    });

    repo.set(sampleRecord());

    expect(writes).toHaveLength(1);
    expect(writes[0].path.endsWith(".tmp")).toBe(true);
    expect(renames).toEqual([{ from: writes[0].path, to: filePath }]);
    expect(mkdirs).toContain(dir);
  });

  test("file repository skips expired records on load", () => {
    const dir = mkdtempSync(join(tmpdir(), "clanker-proposals-"));
    const filePath = join(dir, "proposals.json");
    const expired = sampleRecord({
      proposal: {
        ...sampleRecord().proposal,
        expiresAt: 100,
      },
    });
    writeFileSync(
      filePath,
      JSON.stringify({ version: 1, records: [expired] }),
      "utf8"
    );

    const repo = new FileProposalRepository({
      filePath,
      pathExists: () => true,
      now: () => 200,
    });

    expect(repo.list()).toEqual([]);
  });

  test("file repository skips records with missing patch artifacts on load", () => {
    const dir = mkdtempSync(join(tmpdir(), "clanker-proposals-"));
    const filePath = join(dir, "proposals.json");
    const record = sampleRecord({
      proposal: {
        ...sampleRecord().proposal,
        patchPath: "/tmp/missing.patch",
      },
    });
    writeFileSync(
      filePath,
      JSON.stringify({ version: 1, records: [record] }),
      "utf8"
    );

    const repo = new FileProposalRepository({
      filePath,
      now: () => 50,
      pathExists: () => false,
    });

    expect(repo.list()).toEqual([]);
  });

  test("file repository acquires and releases lock during persist", () => {
    const dir = mkdtempSync(join(tmpdir(), "clanker-proposals-"));
    const filePath = join(dir, "proposals.json");
    const calls: string[] = [];
    const releases: string[] = [];

    const repo = new FileProposalRepository({
      filePath,
      readTextFile: () => {
        throw new Error("not found");
      },
      writeTextFile: () => undefined,
      renamePath: () => undefined,
      mkdirDir: () => undefined,
      acquireLock: (path) => {
        calls.push(path);
        return () => {
          releases.push(path);
        };
      },
    });

    repo.set(sampleRecord());

    expect(calls).toEqual([`${filePath}.lock`]);
    expect(releases).toEqual([`${filePath}.lock`]);
  });

  test("file repository releases lock when persist fails", () => {
    const dir = mkdtempSync(join(tmpdir(), "clanker-proposals-"));
    const filePath = join(dir, "proposals.json");
    let released = false;

    const repo = new FileProposalRepository({
      filePath,
      readTextFile: () => {
        throw new Error("not found");
      },
      writeTextFile: () => undefined,
      renamePath: () => {
        throw new Error("rename failed");
      },
      mkdirDir: () => undefined,
      acquireLock: () => {
        return () => {
          released = true;
        };
      },
    });

    expect(() => repo.set(sampleRecord())).toThrow("rename failed");
    expect(released).toBe(true);
  });
});
