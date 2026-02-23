import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";
import {
  handleDelegationControlCommand,
  type ApprovalDeps,
} from "../../../agent/delegation/approval.js";
import { ProposalStore } from "../../../agent/delegation/proposals.js";

describe("delegation approval flow", () => {
  const baseProposal = {
    id: "p-1",
    sessionId: "s-1",
    createdAt: 1000,
    expiresAt: 2000,
    projectName: "repo",
    repoRoot: "/repo",
    baseHead: "abc123",
    worktreePath: "/tmp/wt-1",
    patchPath: "/tmp/p-1.patch",
    changedFiles: ["src/a.ts"],
    diffStat: " src/a.ts | 2 +-",
    diffPreview: "diff --git../agent/a.ts../agent/a.ts",
    fileDiffs: [
      {
        filePath: "src/a.ts",
        language: "TypeScript",
        diff: "diff --git../agent/a.ts../agent/a.ts\n+const a = 1;\n",
      },
    ],
    delegateSummary: "done",
    delegateExitCode: 0,
  };

  function makeDeps(
    overrides: Partial<ApprovalDeps> = {}
  ): { deps: ApprovalDeps; sends: string[]; store: ProposalStore } {
    const sends: string[] = [];
    const store = new ProposalStore();
    const deps: ApprovalDeps = {
      channel: "repl",
      sessionId: "s-1",
      userInput: "",
      discordUnsafeEnableWrites: false,
      now: () => 1_500,
      send: async (text: string) => {
        sends.push(text);
      },
      history: [{ role: "system", content: "sys" } as ChatCompletionMessageParam],
      proposalStore: store,
      applyPatch: () => ({ ok: true }),
      cleanupProposal: () => undefined,
      verifyApplyPreconditions: () => ({ ok: true }),
      ...overrides,
    };
    return { deps, sends, store };
  }

  test("accept applies patch and removes proposal", async () => {
    const { deps, sends, store } = makeDeps({ userInput: "accept" });
    store.createProposal(baseProposal);

    const res = await handleDelegationControlCommand(deps);

    expect(res.handled).toBe(true);
    expect(sends.join("\n")).toContain("applied");
    expect(store.getProposal("s-1")).toBeNull();
  });

  test("reject discards proposal and cleans up", async () => {
    const cleanup = jest.fn();
    const { deps, sends, store } = makeDeps({
      userInput: "reject",
      cleanupProposal: cleanup,
    });
    store.createProposal(baseProposal);

    const res = await handleDelegationControlCommand(deps);

    expect(res.handled).toBe(true);
    expect(sends.join("\n")).toContain("rejected");
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(store.getProposal("s-1")).toBeNull();
  });

  test("accept is blocked when preconditions fail and keeps proposal", async () => {
    const { deps, sends, store } = makeDeps({
      userInput: "accept",
      verifyApplyPreconditions: () => ({ ok: false, error: "HEAD changed" }),
    });
    store.createProposal(baseProposal);

    const res = await handleDelegationControlCommand(deps);

    expect(res.handled).toBe(true);
    expect(sends.join("\n")).toContain("HEAD changed");
    expect(store.getProposal("s-1")?.id).toBe("p-1");
  });

  test("expired proposal is discarded before accept", async () => {
    const cleanup = jest.fn();
    const { deps, sends, store } = makeDeps({
      userInput: "accept",
      now: () => 2_001,
      cleanupProposal: cleanup,
    });
    store.createProposal(baseProposal);

    const res = await handleDelegationControlCommand(deps);

    expect(res.handled).toBe(true);
    expect(sends.join("\n")).toContain("expired");
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(store.getProposal("s-1")).toBeNull();
  });

  test("slash-style controls return migration guidance", async () => {
    const { deps, sends } = makeDeps({ userInput: "/accept p-1" });
    const res = await handleDelegationControlCommand(deps);
    expect(res.handled).toBe(true);
    expect(sends.join("\n")).toContain("no longer supported");
    expect(sends.join("\n")).toContain("accept");
    expect(sends.join("\n")).toContain("reject");
    expect(sends.join("\n")).toContain("pending");
  });
});
