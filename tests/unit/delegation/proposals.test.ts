import {
  ProposalStore,
  type CreateProposalInput,
} from "../../../src/delegation/proposals.js";

function sampleInput(overrides: Partial<CreateProposalInput> = {}): CreateProposalInput {
  return {
    id: "p-1",
    sessionId: "s-1",
    createdAt: 1_700_000_000_000,
    expiresAt: 1_700_000_900_000,
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
    ...overrides,
  };
}

describe("ProposalStore", () => {
  test("create/get lifecycle", () => {
    const store = new ProposalStore();
    const created = store.createProposal(sampleInput());
    expect(created.ok).toBe(true);

    const got = store.getProposal("s-1");
    expect(got).not.toBeNull();
    expect(got?.id).toBe("p-1");
  });

  test("enforces one pending proposal per session", () => {
    const store = new ProposalStore();
    const first = store.createProposal(sampleInput({ id: "p-1" }));
    expect(first.ok).toBe(true);

    const second = store.createProposal(sampleInput({ id: "p-2" }));
    expect(second.ok).toBe(false);
    expect(second.error).toContain("already has a pending proposal");
  });

  test("acceptProposal removes and returns proposal", () => {
    const store = new ProposalStore();
    store.createProposal(sampleInput());

    const accepted = store.acceptProposal("s-1");
    expect(accepted.ok).toBe(true);
    expect(accepted.proposal?.id).toBe("p-1");
    expect(store.getProposal("s-1")).toBeNull();
  });

  test("rejectProposal removes and returns proposal", () => {
    const store = new ProposalStore();
    store.createProposal(sampleInput());

    const rejected = store.rejectProposal("s-1");
    expect(rejected.ok).toBe(true);
    expect(rejected.proposal?.id).toBe("p-1");
    expect(store.getProposal("s-1")).toBeNull();
  });

  test("id resolution rejects mismatched id", () => {
    const store = new ProposalStore();
    store.createProposal(sampleInput({ id: "p-1" }));

    const accepted = store.acceptProposal("s-1", "p-2");
    expect(accepted.ok).toBe(false);
    expect(accepted.error).toContain("does not match");
    expect(store.getProposal("s-1")).not.toBeNull();
  });

  test("listPending returns session proposal", () => {
    const store = new ProposalStore();
    store.createProposal(sampleInput({ sessionId: "s-1", id: "p-1" }));
    store.createProposal(sampleInput({ sessionId: "s-2", id: "p-2" }));

    const list = store.listPending("s-1");
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("p-1");
  });

  test("expireStale removes expired proposals", () => {
    const store = new ProposalStore();
    store.createProposal(
      sampleInput({
        id: "p-exp",
        sessionId: "s-exp",
        expiresAt: 100,
      })
    );
    store.createProposal(
      sampleInput({
        id: "p-live",
        sessionId: "s-live",
        expiresAt: 10_000,
      })
    );

    const expired = store.expireStale(101);
    expect(expired.map((p) => p.id)).toEqual(["p-exp"]);
    expect(store.getProposal("s-exp")).toBeNull();
    expect(store.getProposal("s-live")?.id).toBe("p-live");
  });
});
