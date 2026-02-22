import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileProposalRepository } from "../../../src/delegation/repository.js";
import { ProposalStore } from "../../../src/delegation/proposals.js";

function sampleProposal() {
  return {
    id: "p-1",
    sessionId: "s-1",
    createdAt: 1_700_000_000_000,
    expiresAt: 9_999_999_999_999,
    projectName: "repo",
    repoRoot: "/repo",
    baseHead: "abc123",
    worktreePath: "/tmp/wt-1",
      patchPath: "/tmp/p-1.patch",
    changedFiles: ["src/a.ts"],
    diffStat: " src/a.ts | 2 +-",
    diffPreview: "diff --git a/src/a.ts b/src/a.ts",
    fileDiffs: [
      {
        filePath: "src/a.ts",
        language: "TypeScript",
        diff: "diff --git a/src/a.ts b/src/a.ts\n+const a = 1;\n",
      },
    ],
    delegateSummary: "Updated file",
    delegateExitCode: 0,
  };
}

describe("ProposalStore restart recovery", () => {
  test("loads persisted pending proposal and allows acceptance after restart", () => {
    const dir = mkdtempSync(join(tmpdir(), "clanker-proposals-"));
    const filePath = join(dir, "proposals.json");
    const patchPath = join(dir, "proposal.patch");
    writeFileSync(patchPath, "diff --git", "utf8");

    const firstStore = new ProposalStore(new FileProposalRepository({ filePath }));
    const created = firstStore.createProposal({
      ...sampleProposal(),
      patchPath,
    });
    expect(created.ok).toBe(true);

    const secondStore = new ProposalStore(new FileProposalRepository({ filePath }));
    expect(secondStore.getProposal("s-1")?.id).toBe("p-1");
    expect(secondStore.getState("s-1")?.status).toBe("proposal_ready");

    const accepted = secondStore.acceptProposal("s-1", "p-1", 1_700_000_100_000);
    expect(accepted.ok).toBe(true);
    expect(accepted.state?.status).toBe("accepted");

    const thirdStore = new ProposalStore(new FileProposalRepository({ filePath }));
    expect(thirdStore.getProposal("s-1")).toBeNull();
  });
});
