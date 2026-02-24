// What the LLM returns
export type LLMResponse =
  | { type: "command"; command: string; working_dir?: string; explanation: string }
  | { type: "edit"; file: string; old: string; new: string; explanation: string }
  | { type: "delegate"; prompt: string; repo: string; working_dir?: string; explanation: string }
  | { type: "message"; explanation: string };

// Input passed to the executor
export interface ExecuteCommandInput {
  command: string;
  reason: string;
  working_dir?: string;
}

// Policy gate verdict — discriminated union, forces exhaustive handling
export type PolicyVerdict =
  | { decision: "allowed";         rule_id: string | null }
  | { decision: "blocked";         rule_id: string; reason: string }
  | { decision: "requires-secret"; rule_id: string; prompt: string };

// Rule entry in policy.json
export interface PolicyRule {
  id: string;
  description: string;
  pattern: string;           // Regex tested against command string
  action: "allow" | "block" | "requires-secret";
  secret_hash?: string;      // SHA-256 hex of passphrase (requires-secret only)
}

export interface PolicyConfig {
  default_action: "allow" | "block";
  rules: PolicyRule[];
}

export interface ExecutionResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exit_code: number;
}
