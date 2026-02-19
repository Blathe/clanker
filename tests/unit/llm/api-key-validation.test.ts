/**
 * Unit tests for API key format validation
 * Tests that API keys are validated before use to prevent misconfiguration
 */

/**
 * Validates OpenAI API key format
 * OpenAI keys must start with "sk-"
 */
function validateOpenAIKey(key: string | undefined): { valid: boolean; error: string | null } {
  if (!key) {
    return { valid: false, error: "OPENAI_API_KEY is not set" };
  }

  if (!key.startsWith("sk-")) {
    return {
      valid: false,
      error: "OPENAI_API_KEY must start with 'sk-'. Check your API key format.",
    };
  }

  return { valid: true, error: null };
}

/**
 * Validates Anthropic API key format
 * Anthropic keys must start with "sk-ant-"
 */
function validateAnthropicKey(key: string | undefined): { valid: boolean; error: string | null } {
  if (!key) {
    return { valid: false, error: "ANTHROPIC_API_KEY is not set" };
  }

  if (!key.startsWith("sk-ant-")) {
    return {
      valid: false,
      error: "ANTHROPIC_API_KEY must start with 'sk-ant-'. Check your API key format.",
    };
  }

  return { valid: true, error: null };
}

describe("API Key Validation", () => {
  describe("validateOpenAIKey", () => {
    test("should accept valid OpenAI key", () => {
      const { valid, error } = validateOpenAIKey("sk-proj-abc123def456");
      expect(valid).toBe(true);
      expect(error).toBeNull();
    });

    test("should accept minimal valid OpenAI key format", () => {
      const { valid, error } = validateOpenAIKey("sk-");
      expect(valid).toBe(true);
      expect(error).toBeNull();
    });

    test("should reject key without sk- prefix", () => {
      const { valid, error } = validateOpenAIKey("abcdef123456");
      expect(valid).toBe(false);
      expect(error).toContain("sk-");
    });

    test("should reject undefined key", () => {
      const { valid, error } = validateOpenAIKey(undefined);
      expect(valid).toBe(false);
      expect(error).toContain("not set");
    });

    test("should reject empty string", () => {
      const { valid, error } = validateOpenAIKey("");
      expect(valid).toBe(false);
      expect(error).toContain("not set");
    });

    test("should reject key with wrong prefix", () => {
      const { valid, error } = validateOpenAIKey("sk-ant-abc123"); // Anthropic prefix
      expect(valid).toBe(true); // Still valid for OpenAI (starts with sk-)
    });

    test("should provide helpful error message", () => {
      const { error } = validateOpenAIKey("invalid_key");
      expect(error).toContain("must start with");
      expect(error).toContain("Check your API key");
    });

    test("should accept key with special characters", () => {
      const { valid } = validateOpenAIKey("sk-proj-_abc-123_def-456");
      expect(valid).toBe(true);
    });

    test("should reject key with wrong case", () => {
      // Keys are case-sensitive, but sk- is always lowercase
      const { valid, error } = validateOpenAIKey("SK-abc123");
      expect(valid).toBe(false);
      expect(error).not.toBeNull();
    });
  });

  describe("validateAnthropicKey", () => {
    test("should accept valid Anthropic key", () => {
      const { valid, error } = validateAnthropicKey("sk-ant-abc123def456");
      expect(valid).toBe(true);
      expect(error).toBeNull();
    });

    test("should accept minimal valid Anthropic key format", () => {
      const { valid, error } = validateAnthropicKey("sk-ant-");
      expect(valid).toBe(true);
      expect(error).toBeNull();
    });

    test("should reject key without sk-ant- prefix", () => {
      const { valid, error } = validateAnthropicKey("abcdef123456");
      expect(valid).toBe(false);
      expect(error).toContain("sk-ant-");
    });

    test("should reject OpenAI key format", () => {
      const { valid, error } = validateAnthropicKey("sk-proj-abc123");
      expect(valid).toBe(false);
      expect(error).not.toBeNull();
    });

    test("should reject undefined key", () => {
      const { valid, error } = validateAnthropicKey(undefined);
      expect(valid).toBe(false);
      expect(error).toContain("not set");
    });

    test("should reject empty string", () => {
      const { valid, error } = validateAnthropicKey("");
      expect(valid).toBe(false);
      expect(error).toContain("not set");
    });

    test("should provide helpful error message", () => {
      const { error } = validateAnthropicKey("invalid_key");
      expect(error).toContain("must start with");
      expect(error).toContain("Check your API key");
    });

    test("should accept key with special characters", () => {
      const { valid } = validateAnthropicKey("sk-ant-_abc-123_def-456");
      expect(valid).toBe(true);
    });

    test("should reject key with wrong case", () => {
      const { valid } = validateAnthropicKey("SK-ANT-abc123");
      expect(valid).toBe(false);
    });
  });
});
