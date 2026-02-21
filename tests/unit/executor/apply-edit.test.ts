/**
 * Unit tests for applyEdit()
 *
 * Note: applyEdit() restricts file paths to within process.cwd().
 * Tests use a temp dir inside the project directory for that reason.
 */

import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { applyEdit } from "../../../src/executor.js";

const TEST_TMP_DIR = join(process.cwd(), ".test-tmp-apply-edit");

beforeEach(() => {
  mkdirSync(TEST_TMP_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_TMP_DIR, { recursive: true, force: true });
});

describe("applyEdit()", () => {
  test("success: replaces unique text in file", () => {
    const file = join(TEST_TMP_DIR, "test.txt");
    writeFileSync(file, "hello world", "utf8");

    const result = applyEdit(file, "hello", "goodbye");
    expect(result.success).toBe(true);
  });

  test("error: text not found in file", () => {
    const file = join(TEST_TMP_DIR, "test.txt");
    writeFileSync(file, "hello world", "utf8");

    const result = applyEdit(file, "nonexistent", "replacement");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  test("error: text appears multiple times", () => {
    const file = join(TEST_TMP_DIR, "test.txt");
    writeFileSync(file, "foo foo foo", "utf8");

    const result = applyEdit(file, "foo", "bar");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/3 times/);
    expect(result.error).toMatch(/unique/i);
  });

  test("error: path traversal rejected", () => {
    const result = applyEdit("../../../etc/passwd", "old", "new");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/traversal|outside/i);
  });

  test("error: file does not exist", () => {
    const result = applyEdit(join(TEST_TMP_DIR, "nonexistent.txt"), "old", "new");
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/read/i);
  });
});
