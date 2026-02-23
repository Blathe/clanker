import { join } from "node:path";

/** Directory names relative to repo root */
export const DIRS = {
  audit: "audit",
  memory: "memory",
  policies: "policies",
  config: "config",
  skills: "skills",
} as const;

/** File paths relative to repo root */
export const FILES = {
  soul: join("config", "SOUL.md"),
  memory: join("memory", "MEMORY.md"),
  policy: join("policies", "policy.json"),
} as const;

/** Prompt template paths relative to repo root */
export const PROMPT_PATHS = {
  systemCore: join("config", "prompts", "system", "core.md"),
  actionContract: join("config", "prompts", "system", "action-contract.md"),
  routing: join("config", "prompts", "system", "routing.md"),
  delegationTemplate: join("config", "prompts", "delegation", "template.md"),
} as const;
