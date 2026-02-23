/**
 * Unit tests for OpenAI API key format validation
 */

import { validateOpenAIKey } from "../../../agent/llm.js";

describe("validateOpenAIKey", () => {
  test("accepts a valid OpenAI key", () => {
    const { valid, error } = validateOpenAIKey("sk-proj-abc123def456");
    expect(valid).toBe(true);
    expect(error).toBeNull();
  });

  test("accepts minimal valid prefix", () => {
    const { valid, error } = validateOpenAIKey("sk-");
    expect(valid).toBe(true);
    expect(error).toBeNull();
  });

  test("rejects key without sk- prefix", () => {
    const { valid, error } = validateOpenAIKey("abcdef123456");
    expect(valid).toBe(false);
    expect(error).toContain("sk-");
  });

  test("rejects undefined key", () => {
    const { valid, error } = validateOpenAIKey(undefined);
    expect(valid).toBe(false);
    expect(error).toContain("not set");
  });

  test("rejects empty string", () => {
    const { valid, error } = validateOpenAIKey("");
    expect(valid).toBe(false);
    expect(error).toContain("not set");
  });

  test("rejects key with wrong case prefix", () => {
    const { valid, error } = validateOpenAIKey("SK-abc123");
    expect(valid).toBe(false);
    expect(error).not.toBeNull();
  });

  test("provides a helpful error message for invalid keys", () => {
    const { error } = validateOpenAIKey("invalid_key");
    expect(error).toContain("must start with");
    expect(error).toContain("Check your API key");
  });

  test("accepts key with special characters after prefix", () => {
    const { valid } = validateOpenAIKey("sk-proj-_abc-123_def-456");
    expect(valid).toBe(true);
  });
});
