import { loadPromptTemplates, renderPromptTemplate } from "../prompt/loadPrompts.js";

export function buildDelegationPrompt(task: string): string {
  const trimmedTask = task.trim();
  if (!trimmedTask) {
    throw new Error("Delegation prompt cannot be empty.");
  }

  const templates = loadPromptTemplates();
  return renderPromptTemplate(templates.delegationTemplate, {
    task: trimmedTask,
  });
}
