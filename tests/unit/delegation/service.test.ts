import { DelegationService } from "../../../src/delegation/service.js";
import type { PendingProposal } from "../../../src/delegation/proposals.js";

function sampleProposal(overrides: Partial<PendingProposal> = {}): PendingProposal {
  return {
    id: "p-1",
    sessionId: "s-1",
    createdAt: 1000,
    expiresAt: 2000,
    projectName: "repo",
    repoRoot: "/repo",
    baseHead: "abc123",
    worktreePath: "/tmp/wt",
    patchPath: "/tmp/patch.patch",
    changedFiles: ["src/a.ts"],
    diffStat: " src/a.ts | 1 +",
    diffPreview: "diff --git a/src/a.ts b/src/a.ts",
    fileDiffs: [
      {
        filePath: "src/a.ts",
        language: "TypeScript",
        diff: "diff --git a/src/a.ts b/src/a.ts\n+const a = 1;",
      },
    ],
    delegateSummary: "done",
    delegateExitCode: 0,
    ...overrides,
  };
}

describe("DelegationService", () => {
  test("rejects invalid working directory", async () => {
    const service = new DelegationService({
      proposalStore: { createProposal: jest.fn() } as any,
      validateWorkingDir: () => ({ valid: false, error: "bad working dir" }),
      runDelegationInIsolatedWorktree: jest.fn(),
      cleanupProposalArtifacts: jest.fn(),
      runDelegate: jest.fn(),
    });

    await expect(
      service.delegateWithReview({ sessionId: "s-1", delegatePrompt: "do work", workingDir: "/bad" })
    ).rejects.toThrow("bad working dir");
  });

  test("passes through noChanges result when no proposal exists", async () => {
    const service = new DelegationService({
      proposalStore: { createProposal: jest.fn() } as any,
      validateWorkingDir: () => ({ valid: true }),
      runDelegationInIsolatedWorktree: jest.fn().mockResolvedValue({
        exitCode: 0,
        summary: "no edits",
        noChanges: true,
      }),
      cleanupProposalArtifacts: jest.fn(),
      runDelegate: jest.fn().mockResolvedValue({ exitCode: 0, summary: "ok" }),
    });

    const result = await service.delegateWithReview({
      sessionId: "s-1",
      delegatePrompt: "do work",
    });

    expect(result).toEqual({ exitCode: 0, summary: "no edits", noChanges: true });
  });

  test("stores proposal and returns user-safe metadata", async () => {
    const proposal = sampleProposal();
    const createProposal = jest.fn().mockReturnValue({ ok: true, proposal });
    const onProposalCreated = jest.fn();
    const service = new DelegationService({
      proposalStore: { createProposal } as any,
      validateWorkingDir: () => ({ valid: true }),
      runDelegationInIsolatedWorktree: jest.fn().mockResolvedValue({
        exitCode: 0,
        summary: "done",
        proposal,
      }),
      cleanupProposalArtifacts: jest.fn(),
      runDelegate: jest.fn().mockResolvedValue({ exitCode: 0, summary: "ok" }),
      onProposalCreated,
    });

    const result = await service.delegateWithReview({
      sessionId: "s-1",
      delegatePrompt: "do work",
    });

    expect(createProposal).toHaveBeenCalledWith(proposal);
    expect(onProposalCreated).toHaveBeenCalledWith(proposal);
    expect(result.proposal).toEqual({
      id: proposal.id,
      projectName: proposal.projectName,
      expiresAt: proposal.expiresAt,
      changedFiles: proposal.changedFiles,
      diffStat: proposal.diffStat,
      diffPreview: proposal.diffPreview,
      fileDiffs: proposal.fileDiffs,
    });
  });

  test("cleans up artifacts and throws when proposal store rejects", async () => {
    const proposal = sampleProposal();
    const cleanupProposalArtifacts = jest.fn();
    const service = new DelegationService({
      proposalStore: { createProposal: jest.fn().mockReturnValue({ ok: false, error: "collision" }) } as any,
      validateWorkingDir: () => ({ valid: true }),
      runDelegationInIsolatedWorktree: jest.fn().mockResolvedValue({
        exitCode: 0,
        summary: "done",
        proposal,
      }),
      cleanupProposalArtifacts,
      runDelegate: jest.fn().mockResolvedValue({ exitCode: 0, summary: "ok" }),
    });

    await expect(
      service.delegateWithReview({ sessionId: "s-1", delegatePrompt: "do work" })
    ).rejects.toThrow("collision");

    expect(cleanupProposalArtifacts).toHaveBeenCalledWith(proposal);
  });
});
