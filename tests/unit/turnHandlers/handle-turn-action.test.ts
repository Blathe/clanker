/**
 * Unit tests for handleTurnAction()
 */

import { jest } from "@jest/globals";

jest.mock("../../../src/policy.js", () => ({
  evaluate: jest.fn(),
  verifySecret: jest.fn(),
}));

jest.mock("../../../src/executor.js", () => ({
  runCommand: jest.fn(),
  applyEdit: jest.fn(),
  validateCommandLength: jest.fn().mockReturnValue({ valid: true, error: null }),
  formatResult: jest.fn().mockReturnValue("Command output"),
  validateWorkingDir: jest.fn().mockReturnValue({ valid: true }),
}));

jest.mock("../../../src/logger.js", () => ({
  logVerdict: jest.fn(),
  logSecretVerification: jest.fn(),
  logCommandResult: jest.fn(),
  logEdit: jest.fn(),
  logDelegate: jest.fn(),
}));

import { handleTurnAction } from "../../../src/turnHandlers.js";
import { evaluate, verifySecret } from "../../../src/policy.js";
import { runCommand } from "../../../src/executor.js";
import type { LLMResponse } from "../../../src/types.js";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";

const mockEvaluate = jest.mocked(evaluate);
const mockVerifySecret = jest.mocked(verifySecret);
const mockRunCommand = jest.mocked(runCommand);

function makeCtx(response: LLMResponse, overrides: Record<string, unknown> = {}) {
  const history: ChatCompletionMessageParam[] = [];
  return {
    channel: "repl" as const,
    send: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    response,
    history,
    discordUnsafeEnableWrites: false,
    delegateEnabled: false,
    promptSecret: jest.fn<() => Promise<string>>().mockResolvedValue("mypassphrase"),
    delegateToClaude: jest.fn<() => Promise<any>>().mockResolvedValue({ exitCode: 0, summary: "done" }),
    queueDelegate: undefined,
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

  test("delegate disabled → sends message and returns continue", async () => {
    const ctx = makeCtx({ type: "delegate", prompt: "do something", explanation: "delegate task" }, { delegateEnabled: false });
    const outcome = await handleTurnAction(ctx);
    expect(outcome).toBe("continue");
    expect(ctx.send).toHaveBeenCalledWith(expect.stringMatching(/disabled/i));
  });

  test("delegate enabled without queueDelegate → calls delegateToClaude and returns break", async () => {
    const ctx = makeCtx(
      { type: "delegate", prompt: "do something", explanation: "delegate task" },
      { delegateEnabled: true, queueDelegate: undefined }
    );
    const outcome = await handleTurnAction(ctx);
    expect(outcome).toBe("break");
    expect(ctx.delegateToClaude).toHaveBeenCalled();
  });
});
