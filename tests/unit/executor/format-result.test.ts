import { formatResult } from "../../../agent/executor.js";
import type { ExecutionResult } from "../../../agent/types.js";

describe("formatResult", () => {
  test("shows LLM explanation and stdout output without legacy labels", () => {
    const result: ExecutionResult = {
      success: true,
      stdout: "alpha\nbeta\n",
      stderr: "",
      exit_code: 0,
    };

    const formatted = formatResult(result, "Listing matching files.");

    expect(formatted).toContain("Listing matching files.");
    expect(formatted).toContain("alpha\nbeta");
    expect(formatted).not.toContain("Exit code:");
    expect(formatted).not.toContain("STDOUT:");
    expect(formatted).not.toContain("STDERR:");
  });

  test("falls back to generic success message when no explanation is provided", () => {
    const result: ExecutionResult = {
      success: true,
      stdout: "done",
      stderr: "",
      exit_code: 0,
    };

    const formatted = formatResult(result);

    expect(formatted).toBe("Command completed.\n\ndone");
  });

  test("includes stderr output when command fails", () => {
    const result: ExecutionResult = {
      success: false,
      stdout: "",
      stderr: "permission denied",
      exit_code: 1,
    };

    const formatted = formatResult(result, "Attempting protected action.");

    expect(formatted).toContain("Attempting protected action.");
    expect(formatted).toContain("permission denied");
  });

  test("shows no-output fallback on failed commands with no stdout/stderr", () => {
    const result: ExecutionResult = {
      success: false,
      stdout: "",
      stderr: "",
      exit_code: 1,
    };

    const formatted = formatResult(result, "Trying command.");

    expect(formatted).toBe("Trying command.\n\nNo output was produced.");
  });
});
