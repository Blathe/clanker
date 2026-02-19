/**
 * Unit tests for command length validation
 * Tests that commands are bounded to prevent regex DoS and performance issues
 */

const MAX_COMMAND_LENGTH = 10000; // characters

/**
 * Validates command length to prevent performance issues during policy evaluation
 */
function validateCommandLength(command: string): { valid: boolean; error: string | null } {
  if (!command) {
    return { valid: false, error: "Command cannot be empty" };
  }

  if (command.length > MAX_COMMAND_LENGTH) {
    return {
      valid: false,
      error: `Command too long (${command.length} characters, max ${MAX_COMMAND_LENGTH}). Commands must be concise.`,
    };
  }

  return { valid: true, error: null };
}

describe("Command Length Validation", () => {
  describe("validateCommandLength", () => {
    test("should accept normal command", () => {
      const { valid, error } = validateCommandLength("ls -la");
      expect(valid).toBe(true);
      expect(error).toBeNull();
    });

    test("should accept command at max length", () => {
      const command = "echo " + "x".repeat(MAX_COMMAND_LENGTH - 5);
      const { valid, error } = validateCommandLength(command);

      expect(valid).toBe(true);
      expect(error).toBeNull();
    });

    test("should reject command over max length", () => {
      const command = "echo " + "x".repeat(MAX_COMMAND_LENGTH);
      const { valid, error } = validateCommandLength(command);

      expect(valid).toBe(false);
      expect(error).not.toBeNull();
      expect(error).toContain("too long");
    });

    test("should reject empty command", () => {
      const { valid, error } = validateCommandLength("");
      expect(valid).toBe(false);
      expect(error).toContain("empty");
    });

    test("should include character count in error", () => {
      const command = "x".repeat(MAX_COMMAND_LENGTH + 100);
      const { valid, error } = validateCommandLength(command);

      expect(valid).toBe(false);
      expect(error).toContain((MAX_COMMAND_LENGTH + 100).toString());
    });

    test("should include max limit in error message", () => {
      const command = "x".repeat(MAX_COMMAND_LENGTH + 1);
      const { valid, error } = validateCommandLength(command);

      expect(error).toContain(`max ${MAX_COMMAND_LENGTH}`);
    });

    test("should accept complex but reasonable command", () => {
      const command =
        "find . -name '*.js' -type f | xargs grep -l 'TODO' | head -20";
      const { valid } = validateCommandLength(command);

      expect(valid).toBe(true);
    });

    test("should reject command that is just repeated characters", () => {
      const command = "a".repeat(MAX_COMMAND_LENGTH + 1);
      const { valid } = validateCommandLength(command);

      expect(valid).toBe(false);
    });

    test("should accept command with newlines if under limit", () => {
      const command = "echo 'line1'\necho 'line2'\necho 'line3'";
      const { valid } = validateCommandLength(command);

      expect(valid).toBe(true);
    });

    test("should reject very large command (100KB)", () => {
      const command = "x".repeat(100 * 1024);
      const { valid } = validateCommandLength(command);

      expect(valid).toBe(false);
    });

    test("should be just under 10KB for practical regex safety", () => {
      // Regex DoS typically triggers on patterns > 10KB
      expect(MAX_COMMAND_LENGTH).toBe(10000);
    });

    test("should reject command exactly 1 char over limit", () => {
      const command = "x".repeat(MAX_COMMAND_LENGTH + 1);
      const { valid } = validateCommandLength(command);

      expect(valid).toBe(false);
    });

    test("should handle command with special shell characters", () => {
      const command = "cat file.txt | grep 'pattern' | sed 's/old/new/g'";
      const { valid } = validateCommandLength(command);

      expect(valid).toBe(true);
    });
  });
});
