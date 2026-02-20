import {
  runDelegationInIsolatedWorktree,
  type GitRunner,
} from "../../../src/delegation/worktree.js";

function gitOk(stdout = "") {
  return { code: 0, stdout, stderr: "" };
}

function gitErr(stderr: string) {
  return { code: 1, stdout: "", stderr };
}

describe("runDelegationInIsolatedWorktree", () => {
  test("fails when repository is dirty", async () => {
    const runGit: GitRunner = jest.fn((args: string[]) => {
      const cmd = args.join(" ");
      if (cmd === "rev-parse --show-toplevel") return gitOk("/repo\n");
      if (cmd === "status --porcelain") return gitOk(" M src/main.ts\n");
      return gitOk("");
    });

    await expect(
      runDelegationInIsolatedWorktree({
        sessionId: "s-1",
        prompt: "do work",
        runGit,
        runDelegate: async () => ({ exitCode: 0, summary: "ok" }),
        createTempDir: () => "/tmp/unused",
        writeTextFile: () => undefined,
        now: () => 1_000,
      })
    ).rejects.toThrow("working tree is not clean");
  });

  test("returns noChanges when delegated run produced no diff", async () => {
    const runGit: GitRunner = jest.fn((args: string[]) => {
      const cmd = args.join(" ");
      if (cmd === "rev-parse --show-toplevel") return gitOk("/repo\n");
      if (cmd === "status --porcelain") return gitOk("");
      if (cmd === "rev-parse HEAD") return gitOk("abc123\n");
      if (cmd.startsWith("worktree add --detach")) return gitOk("");
      if (cmd === "diff --binary --no-color") return gitOk("");
      if (cmd.startsWith("worktree remove --force")) return gitOk("");
      return gitOk("");
    });

    const result = await runDelegationInIsolatedWorktree({
      sessionId: "s-1",
      prompt: "do work",
      runGit,
      runDelegate: async () => ({ exitCode: 0, summary: "done" }),
      createTempDir: (() => {
        let i = 0;
        return () => (i++ === 0 ? "/tmp/wt-1" : "/tmp/patch-1");
      })(),
      writeTextFile: () => undefined,
      now: () => 1_000,
    });

    expect(result.noChanges).toBe(true);
    expect(result.proposal).toBeUndefined();
  });

  test("builds proposal metadata with patch, files, and preview", async () => {
    let writtenPath = "";
    let writtenPatch = "";
    const runGit: GitRunner = jest.fn((args: string[]) => {
      const cmd = args.join(" ");
      if (cmd === "rev-parse --show-toplevel") return gitOk("/repo\n");
      if (cmd === "status --porcelain") return gitOk("");
      if (cmd === "rev-parse HEAD") return gitOk("abc123\n");
      if (cmd.startsWith("worktree add --detach")) return gitOk("");
      if (cmd === "diff --binary --no-color") {
        return gitOk("diff --git a/src/a.ts b/src/a.ts\n+hello\n");
      }
      if (cmd === "diff --stat --no-color") return gitOk(" src/a.ts | 1 +\n");
      if (cmd === "diff --name-only --no-color") return gitOk("src/a.ts\n");
      return gitOk("");
    });

    const result = await runDelegationInIsolatedWorktree({
      sessionId: "s-1",
      prompt: "do work",
      runGit,
      runDelegate: async () => ({ exitCode: 0, summary: "done" }),
      createTempDir: (() => {
        let i = 0;
        return () => (i++ === 0 ? "/tmp/wt-1" : "/tmp/patch-1");
      })(),
      writeTextFile: (path: string, text: string) => {
        writtenPath = path;
        writtenPatch = text;
      },
      now: () => 2_000,
    });

    expect(result.proposal).toBeDefined();
    expect(result.proposal?.repoRoot).toBe("/repo");
    expect(result.proposal?.baseHead).toBe("abc123");
    expect(result.proposal?.changedFiles).toEqual(["src/a.ts"]);
    expect(result.proposal?.diffStat).toContain("src/a.ts");
    expect(result.proposal?.diffPreview).toContain("diff --git");
    expect(writtenPath).toContain("proposal.patch");
    expect(writtenPatch).toContain("diff --git");
  });

  test("cleans up worktree when delegate run throws", async () => {
    const calls: string[] = [];
    const runGit: GitRunner = jest.fn((args: string[]) => {
      const cmd = args.join(" ");
      calls.push(cmd);
      if (cmd === "rev-parse --show-toplevel") return gitOk("/repo\n");
      if (cmd === "status --porcelain") return gitOk("");
      if (cmd === "rev-parse HEAD") return gitOk("abc123\n");
      if (cmd.startsWith("worktree add --detach")) return gitOk("");
      if (cmd.startsWith("worktree remove --force")) return gitOk("");
      return gitOk("");
    });

    await expect(
      runDelegationInIsolatedWorktree({
        sessionId: "s-1",
        prompt: "do work",
        runGit,
        runDelegate: async () => {
          throw new Error("delegate failed");
        },
        createTempDir: (() => {
          let i = 0;
          return () => (i++ === 0 ? "/tmp/wt-1" : "/tmp/patch-1");
        })(),
        writeTextFile: () => undefined,
        now: () => 1_000,
      })
    ).rejects.toThrow("delegate failed");

    expect(calls.some((c) => c.startsWith("worktree remove --force"))).toBe(true);
  });
});
