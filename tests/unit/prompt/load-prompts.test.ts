import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  composeSystemPromptFromTemplates,
  loadPromptTemplatesFrom,
  renderPromptTemplate,
} from "../../../agent/prompt/loadPrompts.js";

function writePromptTree(baseDir: string, content?: Partial<Record<string, string>>): void {
  const promptsDir = join(baseDir, "config", "prompts");
  mkdirSync(join(promptsDir, "system"), { recursive: true });
  mkdirSync(join(promptsDir, "delegation"), { recursive: true });

  writeFileSync(
    join(promptsDir, "system", "core.md"),
    content?.["system/core.md"] ?? "You are running on {{runtimeLabel}}.",
    "utf8"
  );
  writeFileSync(
    join(promptsDir, "system", "action-contract.md"),
    content?.["system/action-contract.md"] ?? "Action contract here.",
    "utf8"
  );
  writeFileSync(
    join(promptsDir, "system", "routing.md"),
    content?.["system/routing.md"] ?? "Routing rules here.",
    "utf8"
  );
  writeFileSync(
    join(promptsDir, "delegation", "template.md"),
    content?.["delegation/template.md"] ?? "Task:\n{{task}}",
    "utf8"
  );
}

describe("loadPrompts", () => {
  test("loads required prompt templates from a configured base directory", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "clanker-prompts-"));
    try {
      writePromptTree(baseDir);
      const templates = loadPromptTemplatesFrom(baseDir);
      expect(templates.systemCore).toContain("{{runtimeLabel}}");
      expect(templates.actionContract).toContain("Action contract");
      expect(templates.routing).toContain("Routing rules");
      expect(templates.delegationTemplate).toContain("{{task}}");
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  test("fails fast when a required prompt file is missing", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "clanker-prompts-"));
    try {
      writePromptTree(baseDir);
      rmSync(join(baseDir, "config", "prompts", "system", "routing.md"), {
        force: true,
      });
      expect(() => loadPromptTemplatesFrom(baseDir)).toThrow("routing.md");
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  test("fails fast when a required prompt file is empty", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "clanker-prompts-"));
    try {
      writePromptTree(baseDir, {
        "delegation/template.md": "   \n  ",
      });
      expect(() => loadPromptTemplatesFrom(baseDir)).toThrow("template.md");
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  test("renders template variables with placeholder syntax", () => {
    const rendered = renderPromptTemplate("Running on {{runtimeLabel}} for {{task}}", {
      runtimeLabel: "Linux",
      task: "refactor",
    });
    expect(rendered).toBe("Running on Linux for refactor");
  });

  test("composes full system prompt with templates and context blocks", () => {
    const prompt = composeSystemPromptFromTemplates({
      runtimeLabel: "Windows",
      soul: "SOUL\n\n",
      memory: "MEMORY\n\n",
      lastSession: "LAST\n\n",
      templates: {
        systemCore: "Core on {{runtimeLabel}}",
        actionContract: "Action section",
        routing: "Routing section",
        delegationTemplate: "Task {{task}}",
      },
    });

    expect(prompt).toContain("SOUL");
    expect(prompt).toContain("MEMORY");
    expect(prompt).toContain("LAST");
    expect(prompt).toContain("Core on Windows");
    expect(prompt).toContain("Action section");
    expect(prompt).toContain("Routing section");
  });
});
