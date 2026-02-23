import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";
import { DelegationApprovalService, type ApprovalServiceDeps } from "../../../agent/delegation/approvalService.js";
import type { DelegationControlCommand } from "../../../agent/delegation/commandParser.js";
import { ProposalStore } from "../../../agent/delegation/proposals.js";

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

function makeDeps(overrides: Partial<ApprovalServiceDeps> = {}) {
  const sends: string[] = [];
  const store = new ProposalStore();
  const deps: ApprovalServiceDeps = {
    channel: "repl",
    sessionId: "s-1",
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

async function run(parsed: DelegationControlCommand, overrides: Partial<ApprovalServiceDeps> = {}) {
  const { deps, sends, store } = makeDeps(overrides);
  const service = new DelegationApprovalService(deps);
  const result = await service.handle(parsed);
  return { result, sends, store };
}

describe("DelegationApprovalService", () => {
  test("returns unhandled for none", async () => {
    const { result } = await run({ type: "none" });
    expect(result.handled).toBe(false);
  });

  test("handles invalid command", async () => {
    const { result, sends } = await run({ type: "invalid", error: "bad command" });
    expect(result.handled).toBe(true);
    expect(sends.join("\n")).toContain("[INVALID]");
  });

  test("shows pending proposal when requested", async () => {
    const { deps, sends, store } = makeDeps();
    store.createProposal(baseProposal);
    const service = new DelegationApprovalService(deps);

    const result = await service.handle({ type: "pending" });

    expect(result.handled).toBe(true);
    expect(sends.join("\n")).toContain("[PENDING PROPOSAL] p-1");
  });

  test("reject command discards proposal", async () => {
    const cleanup = jest.fn();
    const { deps, sends, store } = makeDeps({ cleanupProposal: cleanup });
    store.createProposal(baseProposal);
    const service = new DelegationApprovalService(deps);

    const result = await service.handle({ type: "reject" });

    expect(result.handled).toBe(true);
    expect(sends.join("\n")).toContain("[PROPOSAL REJECTED]");
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(store.getProposal("s-1")).toBeNull();
  });

  test("accept blocked by preconditions keeps proposal", async () => {
    const { deps, sends, store } = makeDeps({
      verifyApplyPreconditions: () => ({ ok: false, error: "HEAD changed" }),
    });
    store.createProposal(baseProposal);
    const service = new DelegationApprovalService(deps);

    const result = await service.handle({ type: "accept" });

    expect(result.handled).toBe(true);
    expect(sends.join("\n")).toContain("HEAD changed");
    expect(store.getProposal("s-1")?.id).toBe("p-1");
  });

  test("accept applies proposal and clears it", async () => {
    const cleanup = jest.fn();
    const { deps, sends, store } = makeDeps({ cleanupProposal: cleanup });
    store.createProposal(baseProposal);
    const service = new DelegationApprovalService(deps);

    const result = await service.handle({ type: "accept" });

    expect(result.handled).toBe(true);
    expect(sends.join("\n")).toContain("[PROPOSAL APPLIED]");
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(store.getProposal("s-1")).toBeNull();
  });
});
