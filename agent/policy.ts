import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { PolicyConfig, PolicyRule, PolicyVerdict } from "./types.js";

const PolicyRuleSchema = z.object({
  id: z.string().min(1),
  description: z.string(),
  pattern: z.string().min(1),
  action: z.enum(["allow", "block", "requires-secret"]),
  secret_hash: z.string().optional(),
});

const PolicyConfigSchema = z.object({
  default_action: z.enum(["allow", "block"]),
  rules: z.array(PolicyRuleSchema),
});

function loadPolicy(): PolicyConfig {
  const policyPath = join(process.cwd(), "policies", "policy.json");
  const raw = readFileSync(policyPath, "utf8");
  return PolicyConfigSchema.parse(JSON.parse(raw));
}

let _policy: PolicyConfig | null = null;

function getPolicy(): PolicyConfig {
  if (!_policy) {
    _policy = loadPolicy();
  }
  return _policy;
}

export function resetPolicyForTest(): void {
  _policy = null;
}

export function evaluate(command: string): PolicyVerdict {
  const policy = getPolicy();

  for (const rule of policy.rules) {
    // Do NOT use case-insensitive flag - prevents certain bypass techniques
    const regex = new RegExp(rule.pattern);
    if (regex.test(command)) {
      return verdictFromRule(rule);
    }
  }

  // Default action — no rule matched
  if (policy.default_action === "allow") {
    return { decision: "allowed", rule_id: null };
  } else {
    return {
      decision: "blocked",
      rule_id: "default",
      reason: "No rule matched; default policy is block",
    };
  }
}

function verdictFromRule(rule: PolicyRule): PolicyVerdict {
  switch (rule.action) {
    case "allow":
      return { decision: "allowed", rule_id: rule.id };

    case "block":
      return {
        decision: "blocked",
        rule_id: rule.id,
        reason: rule.description,
      };

    case "requires-secret":
      return {
        decision: "requires-secret",
        rule_id: rule.id,
        prompt: `Passphrase required for: ${rule.description}`,
      };
  }
}

export function verifySecret(ruleId: string, passphrase: string): boolean {
  const policy = getPolicy();
  const rule = policy.rules.find((r) => r.id === ruleId);

  if (!rule || !rule.secret_hash) {
    return false;
  }

  const hash = createHash("sha256")
    .update(passphrase.trim())
    .digest("hex");

  try {
    // Use timingSafeEqual to prevent timing attacks
    return timingSafeEqual(Buffer.from(hash), Buffer.from(rule.secret_hash));
  } catch {
    // If buffers are different lengths, comparison will throw
    return false;
  }
}
