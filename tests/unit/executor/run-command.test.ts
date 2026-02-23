/**
 * Unit tests for runCommand()
 */

import { jest } from "@jest/globals";
import * as childProcess from "node:child_process";

jest.mock("node:child_process");

const mockSpawnSync = jest.mocked(childProcess.spawnSync);

import { runCommand } from "../../../agent/executor.js";

describe("runCommand()", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("success: returns stdout and exit code 0", () => {
    mockSpawnSync.mockReturnValue({
      status: 0,
      stdout: "hello",
      stderr: "",
      pid: 1234,
      output: [],
      signal: null,
      error: undefined,
    } as any);

    const result = runCommand({ command: "echo hello", reason: "test" });
    expect(result.success).toBe(true);
    expect(result.stdout).toBe("hello");
    expect(result.exit_code).toBe(0);
  });

  test("failure: non-zero exit code", () => {
    mockSpawnSync.mockReturnValue({
      status: 1,
      stdout: "",
      stderr: "error occurred",
      pid: 1234,
      output: [],
      signal: null,
      error: undefined,
    } as any);

    const result = runCommand({ command: "false", reason: "test" });
    expect(result.success).toBe(false);
    expect(result.exit_code).toBe(1);
    expect(result.stderr).toBe("error occurred");
  });

  test("failure: invalid working_dir path traversal", () => {
    const result = runCommand({ command: "ls", reason: "test", working_dir: "../../../etc" });
    expect(result.success).toBe(false);
    expect(result.stderr).toMatch(/traversal|outside/i);
    expect(mockSpawnSync).not.toHaveBeenCalled();
  });

  test("failure: spawn error (e.g. timeout)", () => {
    mockSpawnSync.mockReturnValue({
      status: null,
      stdout: "",
      stderr: "",
      pid: 0,
      output: [],
      signal: null,
      error: new Error("ETIMEDOUT"),
    } as any);

    const result = runCommand({ command: "sleep 100", reason: "test" });
    expect(result.success).toBe(false);
    expect(result.exit_code).toBe(1);
  });
});
