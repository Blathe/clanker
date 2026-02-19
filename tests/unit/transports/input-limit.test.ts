/**
 * Unit tests for input length limits
 * Tests that user input is bounded to prevent DoS and memory issues
 */

const MAX_USER_INPUT = 8000; // characters

/**
 * Validates user input length
 * Returns { valid, error } where error is set if input is too long
 */
function validateInputLength(input: string): { valid: boolean; error: string | null } {
  if (!input) {
    return { valid: false, error: "Input cannot be empty" };
  }

  if (input.length > MAX_USER_INPUT) {
    return {
      valid: false,
      error: `Input too long (${input.length} characters, max ${MAX_USER_INPUT}). Please keep your message shorter.`,
    };
  }

  return { valid: true, error: null };
}

describe("Input Length Validation", () => {
  describe("validateInputLength", () => {
    test("should accept input under the limit", () => {
      const input = "Hello, this is a normal user message.";
      const { valid, error } = validateInputLength(input);

      expect(valid).toBe(true);
      expect(error).toBeNull();
    });

    test("should accept input at max length", () => {
      const input = "x".repeat(MAX_USER_INPUT);
      const { valid, error } = validateInputLength(input);

      expect(valid).toBe(true);
      expect(error).toBeNull();
    });

    test("should reject input over the limit", () => {
      const input = "x".repeat(MAX_USER_INPUT + 1);
      const { valid, error } = validateInputLength(input);

      expect(valid).toBe(false);
      expect(error).not.toBeNull();
      expect(error).toContain("too long");
    });

    test("should reject empty input", () => {
      const { valid, error } = validateInputLength("");
      expect(valid).toBe(false);
      expect(error).toContain("empty");
    });

    test("should provide character count in error message", () => {
      const input = "x".repeat(MAX_USER_INPUT + 100);
      const { valid, error } = validateInputLength(input);

      expect(valid).toBe(false);
      expect(error).toContain((MAX_USER_INPUT + 100).toString()); // Should show actual count
    });

    test("should accept whitespace-only input when under limit", () => {
      const input = "   \n\n  ";
      const { valid } = validateInputLength(input);
      expect(valid).toBe(true);
    });

    test("should reject very large input (100KB)", () => {
      const input = "x".repeat(100 * 1024); // 100KB
      const { valid, error } = validateInputLength(input);

      expect(valid).toBe(false);
      expect(error).not.toBeNull();
    });

    test("should include MAX_USER_INPUT in error message", () => {
      const input = "x".repeat(MAX_USER_INPUT + 1);
      const { valid, error } = validateInputLength(input);

      expect(error).toContain(`max ${MAX_USER_INPUT}`);
    });

    test("should accept realistic long message (5KB of text)", () => {
      const input = "This is a detailed explanation. ".repeat(150); // ~5KB
      expect(input.length).toBeLessThan(MAX_USER_INPUT);

      const { valid, error } = validateInputLength(input);
      expect(valid).toBe(true);
      expect(error).toBeNull();
    });

    test("should reject concatenated commands attempting bypass", () => {
      // Simulate someone trying to send many commands concatenated
      const commands = "rm -rf /; ".repeat(1000); // Exceeds limit
      expect(commands.length).toBeGreaterThan(MAX_USER_INPUT);

      const { valid, error } = validateInputLength(commands);
      expect(valid).toBe(false);
      expect(error).not.toBeNull();
    });

    test("should handle unicode characters correctly", () => {
      const input = "🚀🔥💯".repeat(100); // Emoji repeat
      const { valid, error } = validateInputLength(input);

      // Should be under limit (less than 1KB even with emoji)
      if (input.length <= MAX_USER_INPUT) {
        expect(valid).toBe(true);
        expect(error).toBeNull();
      }
    });

    test("should reject when exactly 1 char over limit", () => {
      const input = "x".repeat(MAX_USER_INPUT + 1);
      const { valid } = validateInputLength(input);
      expect(valid).toBe(false);
    });
  });
});
