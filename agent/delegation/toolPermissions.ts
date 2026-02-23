export type DelegationToolKind = "bash" | "file" | "deny";

const BASH_TOOL_KEYS = new Set(["bash", "bashexecutecommand"]);

const FILE_TOOL_KEYS = new Set([
  // Legacy names used by older Claude integrations.
  "strreplacebasededittool",
  "strreplacebasededit",
  "createfile",
  "readfile",
  "writefile",
  "viewfile",
  "listdirectory",

  // Current Claude Code tool names.
  "read",
  "edit",
  "write",
  "multiedit",
  "glob",
  "grep",
  "ls",
  "fileedit",
  "fileread",
  "filewrite",
]);

function normalizeToolName(toolName: string): string {
  return toolName.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

export function classifyDelegationTool(toolName: string): DelegationToolKind {
  const normalized = normalizeToolName(toolName);
  if (BASH_TOOL_KEYS.has(normalized)) {
    return "bash";
  }
  if (FILE_TOOL_KEYS.has(normalized)) {
    return "file";
  }
  return "deny";
}

export function extractCommandForPolicy(toolName: string, toolInput: unknown): string {
  if (
    toolInput &&
    typeof toolInput === "object" &&
    "command" in toolInput &&
    typeof (toolInput as { command: unknown }).command === "string"
  ) {
    return (toolInput as { command: string }).command;
  }
  return toolName;
}
