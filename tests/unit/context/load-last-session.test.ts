/**
 * Unit tests for loadLastSession()
 * Uses a temp directory inside the project for real filesystem isolation.
 */

import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { loadLastSession } from "../../../src/context.js";

const TEST_SESSIONS_DIR = join(process.cwd(), ".test-tmp-sessions");

beforeEach(() => {
  mkdirSync(TEST_SESSIONS_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_SESSIONS_DIR, { recursive: true, force: true });
});

function writeSession(filename: string, lines: object[]): void {
  const content = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
  writeFileSync(join(TEST_SESSIONS_DIR, filename), content, "utf8");
}

describe("loadLastSession()", () => {
  test("returns empty string for empty sessions dir", () => {
    const result = loadLastSession(TEST_SESSIONS_DIR);
    expect(result).toBe("");
  });

  test("returns summary block when summary event exists", () => {
    writeSession("2024-01-15T10-00-00_1234.jsonl", [
      { t: 1000, ev: "start", ver: "1.0" },
      { t: 2000, ev: "user", msg: "hello" },
      { t: 3000, ev: "summary", topics: ["[repl] hello world", "[repl] do something"] },
      { t: 4000, ev: "end" },
    ]);

    const result = loadLastSession(TEST_SESSIONS_DIR);
    expect(result).toContain("## Last Session Summary");
    expect(result).toContain("hello world");
    expect(result).toContain("do something");
  });

  test("falls back to narrative when no summary event", () => {
    writeSession("2024-01-15T10-00-00_1234.jsonl", [
      { t: 1000, ev: "start", ver: "1.0" },
      { t: 2000, ev: "user", msg: "list files" },
      { t: 3000, ev: "llm", type: "command", cmd: "ls", msg: "listing files" },
      { t: 4000, ev: "end" },
    ]);

    const result = loadLastSession(TEST_SESSIONS_DIR);
    expect(result).toContain("## Last Session Summary");
    expect(result).toContain("User:");
  });

  test("skips malformed JSON lines gracefully", () => {
    const content = [
      JSON.stringify({ t: 1000, ev: "start", ver: "1.0" }),
      "NOT_VALID_JSON{{{{",
      JSON.stringify({ t: 3000, ev: "summary", topics: ["[repl] something"] }),
    ].join("\n") + "\n";
    writeFileSync(join(TEST_SESSIONS_DIR, "2024-01-15T10-00-00_1234.jsonl"), content, "utf8");

    const result = loadLastSession(TEST_SESSIONS_DIR);
    expect(result).toContain("something");
  });

  test("returns narrative content when summary has empty topics array", () => {
    writeSession("2024-01-15T10-00-00_1234.jsonl", [
      { t: 1000, ev: "start", ver: "1.0" },
      { t: 2000, ev: "summary", topics: [] },
      { t: 3000, ev: "end" },
    ]);

    // Empty topics → falls back to narrative mode (start + end events are handled)
    const result = loadLastSession(TEST_SESSIONS_DIR);
    expect(result).toContain("## Last Session Summary");
  });

  test("ignores invalid session filenames", () => {
    writeFileSync(join(TEST_SESSIONS_DIR, "not-a-session.jsonl"), '{"ev":"start"}\n', "utf8");
    writeSession("2024-01-15T10-00-00_1234.jsonl", [
      { t: 1000, ev: "summary", topics: ["[repl] real session"] },
    ]);

    const result = loadLastSession(TEST_SESSIONS_DIR);
    expect(result).toContain("real session");
  });

  test("uses the most recent (lexicographically last) session file", () => {
    writeSession("2024-01-14T10-00-00_1111.jsonl", [
      { t: 1000, ev: "summary", topics: ["[repl] old session"] },
    ]);
    writeSession("2024-01-15T10-00-00_2222.jsonl", [
      { t: 2000, ev: "summary", topics: ["[repl] new session"] },
    ]);

    const result = loadLastSession(TEST_SESSIONS_DIR);
    expect(result).toContain("new session");
    expect(result).not.toContain("old session");
  });
});
