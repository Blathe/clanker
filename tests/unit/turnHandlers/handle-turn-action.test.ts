/**
 * Unit tests for handleTurnAction()
 */

import { jest } from "@jest/globals";

jest.mock("../../../agent/policy.js", () => ({
  evaluate: jest.fn(),
  verifySecret: jest.fn(),
}));

jest.mock("../../../agent/executor.js", () => ({
  runCommand: jest.fn(),
  applyEdit: jest.fn(),
  validateCommandLength: jest.fn().mockReturnValue({ valid: true, error: null }),
  formatResult: jest.fn().mockReturnValue("Command output"),
  validateWorkingDir: jest.fn().mockReturnValue({ valid: true }),
}));

jest.mock("../../../agent/logger.js", () => ({
  logVerdict: jest.fn(),
  logSecretVerification: jest.fn(),
  logCommandResult: jest.fn(),
  logEdit: jest.fn(),
}));

jest.mock("../../../agent/dispatch/dispatcher.js", () => ({
  dispatchWorkflow: jest.fn<(config: any, prompt: string, repoOverride?: string) => Promise<{ jobId: string; branchName: string; repo: string }>>().mockResolvedValue({
    jobId: "test-job-id",
    branchName: "clanker/test-job-id",
    repo: "owner/repo",
  }),
}));

jest.mock("../../../agent/dispatch/poller.js", () => ({
  startPrPoller: jest.fn(),
}));

import { handleTurnAction } from "../../../agent/turnHandlers.js";
import { evaluate, verifySecret } from "../../../agent/policy.js";
import { runCommand } from "../../../agent/executor.js";
import { dispatchWorkflow } from "../../../agent/dispatch/dispatcher.js";
import { startPrPoller } from "../../../agent/dispatch/poller.js";
import type { LLMResponse } from "../../../agent/types.js";
import type { DispatchConfig } from "../../../agent/dispatch/types.js";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";

const mockEvaluate = jest.mocked(evaluate);
const mockVerifySecret = jest.mocked(verifySecret);
const mockRunCommand = jest.mocked(runCommand);
const mockDispatchWorkflow = jest.mocked(dispatchWorkflow);
const mockStartPrPoller = jest.mocked(startPrPoller);

const testDispatchConfig: DispatchConfig = {
  provider: "claude",
  githubToken: "ghp_test",
  repo: "owner/repo",
  workflowId: "clanker-delegate-claude.yml",
  defaultBranch: "main",
  approvedRepos: ["owner/repo", "owner/foo", "owner/bar"],
};

function makeCtx(response: LLMResponse, overrides: Record<string, unknown> = {}) {
  const history: ChatCompletionMessageParam[] = [];
  return {
    channel: "repl" as const,
    send: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    response,
    history,
    discordUnsafeEnableWrites: false,
    dispatchConfig: null as DispatchConfig | null,
    pollIntervalMs: 30000,
    pollTimeoutMs: 1800000,
    promptSecret: jest.fn<() => Promise<string>>().mockResolvedValue("mypassphrase"),
    ...overrides,
  };
}

describe("handleTurnAction()", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("message type → sends message and returns break", async () => {
    const ctx = makeCtx({ type: "message", explanation: "Hello!" });
    const outcome = await handleTurnAction(ctx);
    expect(outcome).toBe("break");
    expect(ctx.send).toHaveBeenCalledWith("Hello!");
  });

  test("blocked command → pushes to history and returns continue", async () => {
    mockEvaluate.mockReturnValue({ decision: "blocked", rule_id: "block-network", reason: "Network blocked" });
    const ctx = makeCtx({ type: "command", command: "wget http://x.com", explanation: "download" });
    const outcome = await handleTurnAction(ctx);
    expect(outcome).toBe("continue");
    expect(ctx.history.length).toBeGreaterThan(0);
  });

  test("requires-secret denied → pushes to history and returns continue", async () => {
    mockEvaluate.mockReturnValue({ decision: "requires-secret", rule_id: "secret-for-write", prompt: "Enter passphrase" });
    mockVerifySecret.mockReturnValue(false);
    const ctx = makeCtx({ type: "command", command: "mkdir foo", explanation: "create dir" });
    const outcome = await handleTurnAction(ctx);
    expect(outcome).toBe("continue");
    expect(ctx.send).toHaveBeenCalledWith(expect.stringMatching(/denied/i));
  });

  test("allowed command → pushes result to history and returns continue", async () => {
    mockEvaluate.mockReturnValue({ decision: "allowed", rule_id: "allow-reads" });
    mockRunCommand.mockReturnValue({ success: true, stdout: "file.txt", stderr: "", exit_code: 0 });
    const ctx = makeCtx({ type: "command", command: "ls", explanation: "list files" });
    const outcome = await handleTurnAction(ctx);
    expect(outcome).toBe("continue");
    expect(ctx.history.some((m) => m.role === "user")).toBe(true);
  });

  test("delegate with no dispatchConfig → sends not-configured message and returns continue", async () => {
    const ctx = makeCtx(
      { type: "delegate", prompt: "do something", repo: "owner/repo", explanation: "delegate task" },
      { dispatchConfig: null }
    );
    const outcome = await handleTurnAction(ctx);
    expect(outcome).toBe("continue");
    expect(ctx.send).toHaveBeenCalledWith(expect.stringMatching(/not configured/i));
  });

  test("delegate with dispatchConfig and approved repo → dispatches workflow and returns break", async () => {
    const ctx = makeCtx(
      { type: "delegate", prompt: "do something", repo: "owner/repo", explanation: "delegate task" },
      { dispatchConfig: testDispatchConfig }
    );
    const outcome = await handleTurnAction(ctx);
    expect(outcome).toBe("break");
    expect(mockDispatchWorkflow).toHaveBeenCalledWith(testDispatchConfig, "do something", "owner/repo");
    expect(mockStartPrPoller).toHaveBeenCalled();
    expect(ctx.send).toHaveBeenCalledWith(expect.stringMatching(/dispatched to github actions/i));
  });

  test("delegate with repo in approved list → dispatches to that repo", async () => {
    const ctx = makeCtx(
      { type: "delegate", prompt: "do something", repo: "owner/foo", explanation: "delegate task" },
      { dispatchConfig: testDispatchConfig }
    );
    const outcome = await handleTurnAction(ctx);
    expect(outcome).toBe("break");
    expect(mockDispatchWorkflow).toHaveBeenCalledWith(testDispatchConfig, "do something", "owner/foo");
  });

  test("delegate with repo NOT in approved list → sends error and returns continue", async () => {
    const ctx = makeCtx(
      { type: "delegate", prompt: "do something", repo: "owner/unapproved", explanation: "delegate task" },
      { dispatchConfig: testDispatchConfig }
    );
    const outcome = await handleTurnAction(ctx);
    expect(outcome).toBe("continue");
    expect(mockDispatchWorkflow).not.toHaveBeenCalled();
    expect(ctx.send).toHaveBeenCalledWith(expect.stringMatching(/not in the approved list/i));
  });

  test("delegate with no repo (empty string) → sends clarification message and returns continue", async () => {
    const ctx = makeCtx(
      { type: "delegate", prompt: "do something", repo: "", explanation: "delegate task" },
      { dispatchConfig: testDispatchConfig }
    );
    const outcome = await handleTurnAction(ctx);
    expect(outcome).toBe("continue");
    expect(mockDispatchWorkflow).not.toHaveBeenCalled();
    expect(ctx.send).toHaveBeenCalledWith(expect.stringMatching(/clarify which repo/i));
  });
});
