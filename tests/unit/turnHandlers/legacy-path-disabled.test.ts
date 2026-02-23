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
import { applyEdit, runCommand } from "../../../src/executor.js";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";
import type { LLMResponse } from "../../../src/types.js";

const mockRunCommand = jest.mocked(runCommand);
const mockApplyEdit = jest.mocked(applyEdit);

function makeCtx(response: LLMResponse) {
  const history: ChatCompletionMessageParam[] = [];
  return {
    channel: "repl" as const,
    send: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    response,
    history,
    discordUnsafeEnableWrites: false,
    delegateEnabled: false,
    jobOrchestrationEnabled: true,
    promptSecret: jest.fn<() => Promise<string>>().mockResolvedValue("mypassphrase"),
    delegateToClaude: jest.fn<() => Promise<any>>().mockResolvedValue({ exitCode: 0, summary: "done" }),
    queueDelegate: undefined,
  };
}

describe("legacy command/edit path disabled in orchestration mode", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("command action does not execute shell command", async () => {
    const ctx = makeCtx({ type: "command", command: "ls", explanation: "list files" });
    const outcome = await handleTurnAction(ctx);

    expect(outcome).toBe("break");
    expect(mockRunCommand).not.toHaveBeenCalled();
    expect(ctx.send).toHaveBeenCalledWith(expect.stringMatching(/disabled/i));
  });

  test("edit action does not write file", async () => {
    const ctx = makeCtx({ type: "edit", file: "a.txt", old: "a", new: "b", explanation: "edit file" });
    const outcome = await handleTurnAction(ctx);

    expect(outcome).toBe("break");
    expect(mockApplyEdit).not.toHaveBeenCalled();
    expect(ctx.send).toHaveBeenCalledWith(expect.stringMatching(/disabled/i));
  });

  test("command action is blocked by default when orchestration flag is omitted", async () => {
    const ctx = makeCtx({ type: "command", command: "ls", explanation: "list files" });
    delete (ctx as { jobOrchestrationEnabled?: boolean }).jobOrchestrationEnabled;

    const outcome = await handleTurnAction(ctx);
    expect(outcome).toBe("break");
    expect(mockRunCommand).not.toHaveBeenCalled();
  });
});
