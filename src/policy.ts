import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { PolicyConfig, PolicyRule, PolicyVerdict } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadPolicy(): PolicyConfig {
  const policyPath = join(__dirname, "..", "policy.json");
  const raw = readFileSync(policyPath, "utf8");
  return JSON.parse(raw) as PolicyConfig;
}

let _policy: PolicyConfig | null = null;

function getPolicy(): PolicyConfig {
  if (!_policy) {
    _policy = loadPolicy();
  }
  return _policy;
}

export function evaluate(command: string): PolicyVerdict {
  const policy = getPolicy();

  for (const rule of policy.rules) {
    const regex = new RegExp(rule.pattern, "i");
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

  return hash === rule.secret_hash;
}
