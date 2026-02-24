import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PROMPT_PATHS } from "../paths.js";

export interface PromptTemplates {
  systemCore: string;
  actionContract: string;
  routing: string;
  delegationTemplate: string;
}

function readRequiredPrompt(baseDir: string, relativePath: string): string {
  const fullPath = join(baseDir, relativePath);
  if (!existsSync(fullPath)) {
    throw new Error(`Missing required prompt file: ${fullPath}`);
  }
  const text = readFileSync(fullPath, "utf8").trim();
  if (!text) {
    throw new Error(`Required prompt file is empty: ${fullPath}`);
  }
  return text;
}

export function loadPromptTemplatesFrom(baseDir: string): PromptTemplates {
  return {
    systemCore: readRequiredPrompt(baseDir, PROMPT_PATHS.systemCore),
    actionContract: readRequiredPrompt(baseDir, PROMPT_PATHS.actionContract),
    routing: readRequiredPrompt(baseDir, PROMPT_PATHS.routing),
    delegationTemplate: readRequiredPrompt(baseDir, PROMPT_PATHS.delegationTemplate),
  };
}

let cachedTemplates: PromptTemplates | null = null;

export function loadPromptTemplates(): PromptTemplates {
  if (!cachedTemplates) {
    const repoRoot = process.cwd();
    cachedTemplates = loadPromptTemplatesFrom(repoRoot);
  }
  return cachedTemplates;
}

export function resetTemplateCache(): void {
  cachedTemplates = null;
}

export function renderPromptTemplate(
  template: string,
  variables: Record<string, string>
): string {
  return template.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (_m, key: string) => {
    return variables[key] ?? "";
  });
}

export function composeSystemPromptFromTemplates(input: {
  runtimeLabel: string;
  soul: string;
  memory: string;
  lastSession: string;
  templates: PromptTemplates;
  approvedRepos?: string[];
}): string {
  const core = renderPromptTemplate(input.templates.systemCore, {
    runtimeLabel: input.runtimeLabel,
  });

  // Build approved repos section if provided
  let approvedReposSection = "";
  if (input.approvedRepos && input.approvedRepos.length > 0) {
    const repoList = input.approvedRepos.map((r) => `- ${r}`).join("\n");
    approvedReposSection = `## Available Repositories

You MUST always include a "repo" field when using the delegate action.
If the user has not specified which repo to target, respond with a message asking them to clarify.
Approved repositories:
${repoList}

`;
  }

  const sections = [core, input.templates.actionContract, input.templates.routing]
    .map((s) => s.trim())
    .filter(Boolean)
    .join("\n\n");
  return `${input.soul}${input.memory}${approvedReposSection}${input.lastSession}${sections}`;
}
