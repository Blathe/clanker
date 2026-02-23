/**
 * Integration tests for policy evaluate() and verifySecret()
 */

import { evaluate, verifySecret, resetPolicyForTest } from "../../../agent/policy.js";

beforeEach(() => {
  resetPolicyForTest();
});

describe("evaluate()", () => {
  test("allows read commands", () => {
    const result = evaluate("ls -la");
    expect(result.decision).toBe("allowed");
  });

  test("blocks network commands", () => {
    const result = evaluate("wget https://example.com");
    expect(result.decision).toBe("blocked");
    expect(result.rule_id).toBe("block-network");
  });

  test("requires-secret for write operations", () => {
    const result = evaluate("mkdir newdir");
    expect(result.decision).toBe("requires-secret");
    expect(result.rule_id).toBe("secret-for-write");
  });

  test("blocks commands by default when no rule matches", () => {
    const result = evaluate("whoami");
    expect(result.decision).toBe("blocked");
    expect(result.rule_id).toBe("default");
  });

  test("allows curl without upload flags", () => {
    const result = evaluate("curl https://example.com");
    expect(result.decision).toBe("allowed");
    expect(result.rule_id).toBe("allow-curl");
  });

  test("blocks audit dir access", () => {
    const result = evaluate("cat audit/foo.jsonl");
    expect(result.decision).toBe("blocked");
    expect(result.rule_id).toBe("block-audit-dir");
  });

  test("blocks git push", () => {
    const result = evaluate("git push origin main");
    expect(result.decision).toBe("blocked");
  });

  test("allows safe git commands", () => {
    const result = evaluate("git status");
    expect(result.decision).toBe("allowed");
    expect(result.rule_id).toBe("allow-git-commands");
  });
});

describe("verifySecret()", () => {
  test("returns true for correct passphrase", () => {
    const result = verifySecret("secret-for-write", "mypassphrase");
    expect(result).toBe(true);
  });

  test("returns false for wrong passphrase", () => {
    const result = verifySecret("secret-for-write", "wrongpassphrase");
    expect(result).toBe(false);
  });

  test("returns false for unknown ruleId", () => {
    const result = verifySecret("nonexistent-rule", "mypassphrase");
    expect(result).toBe(false);
  });

  test("returns false for rule without secret_hash", () => {
    const result = verifySecret("allow-reads", "mypassphrase");
    expect(result).toBe(false);
  });

  test("returns false for empty passphrase", () => {
    const result = verifySecret("secret-for-write", "");
    expect(result).toBe(false);
  });
});
