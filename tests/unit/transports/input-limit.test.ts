/**
 * Unit tests for input length limits using production validateInputLength
 */

import { validateInputLength } from "../../../agent/validators.js";

const MAX_USER_INPUT = 8000; // matches production default

describe("Input Length Validation", () => {
  describe("validateInputLength", () => {
    test("should accept input under the limit", () => {
      const input = "Hello, this is a normal user message.";
      const { valid, error } = validateInputLength(input, MAX_USER_INPUT);

      expect(valid).toBe(true);
      expect(error).toBeNull();
    });

    test("should accept input at max length", () => {
      const input = "x".repeat(MAX_USER_INPUT);
      const { valid, error } = validateInputLength(input, MAX_USER_INPUT);

      expect(valid).toBe(true);
      expect(error).toBeNull();
    });

    test("should reject input over the limit", () => {
      const input = "x".repeat(MAX_USER_INPUT + 1);
      const { valid, error } = validateInputLength(input, MAX_USER_INPUT);

      expect(valid).toBe(false);
      expect(error).not.toBeNull();
      expect(error).toContain("too long");
    });

    test("should reject empty input", () => {
      const { valid, error } = validateInputLength("", MAX_USER_INPUT);
      expect(valid).toBe(false);
      expect(error).toContain("empty");
    });

    test("should provide character count in error message", () => {
      const input = "x".repeat(MAX_USER_INPUT + 100);
      const { valid, error } = validateInputLength(input, MAX_USER_INPUT);

      expect(valid).toBe(false);
      expect(error).toContain((MAX_USER_INPUT + 100).toString());
    });

    test("should accept whitespace-only input when under limit", () => {
      const input = "   \n\n  ";
      const { valid } = validateInputLength(input, MAX_USER_INPUT);
      expect(valid).toBe(true);
    });

    test("should reject very large input (100KB)", () => {
      const input = "x".repeat(100 * 1024);
      const { valid, error } = validateInputLength(input, MAX_USER_INPUT);

      expect(valid).toBe(false);
      expect(error).not.toBeNull();
    });

    test("should include max in error message", () => {
      const input = "x".repeat(MAX_USER_INPUT + 1);
      const { valid, error } = validateInputLength(input, MAX_USER_INPUT);

      expect(valid).toBe(false);
      expect(error).toContain(`max ${MAX_USER_INPUT}`);
    });

    test("should accept realistic long message (5KB of text)", () => {
      const input = "This is a detailed explanation. ".repeat(150);
      expect(input.length).toBeLessThan(MAX_USER_INPUT);

      const { valid, error } = validateInputLength(input, MAX_USER_INPUT);
      expect(valid).toBe(true);
      expect(error).toBeNull();
    });

    test("should reject concatenated commands attempting bypass", () => {
      const commands = "rm -rf /; ".repeat(1000);
      expect(commands.length).toBeGreaterThan(MAX_USER_INPUT);

      const { valid, error } = validateInputLength(commands, MAX_USER_INPUT);
      expect(valid).toBe(false);
      expect(error).not.toBeNull();
    });

    test("should reject when exactly 1 char over limit", () => {
      const input = "x".repeat(MAX_USER_INPUT + 1);
      const { valid } = validateInputLength(input, MAX_USER_INPUT);
      expect(valid).toBe(false);
    });
  });
});
