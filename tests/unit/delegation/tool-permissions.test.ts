import {
  classifyDelegationTool,
  extractCommandForPolicy,
} from "../../../agent/delegation/toolPermissions.js";

describe("delegation tool permission helpers", () => {
  test.each(["bash", "bash_execute_command", "Bash"])(
    "classifies %s as bash tool",
    (toolName) => {
      expect(classifyDelegationTool(toolName)).toBe("bash");
    }
  );

  test.each([
    "str_replace_based_edit_tool",
    "str_replace_based_edit",
    "create_file",
    "read_file",
    "write_file",
    "view_file",
    "list_directory",
    "Read",
    "Edit",
    "Write",
    "MultiEdit",
    "Glob",
    "Grep",
    "LS",
  ])("classifies %s as file tool", (toolName) => {
    expect(classifyDelegationTool(toolName)).toBe("file");
  });

  test("returns deny for unknown tools", () => {
    expect(classifyDelegationTool("WebFetch")).toBe("deny");
  });

  test("extracts command from bash tool input for policy evaluation", () => {
    expect(extractCommandForPolicy("Bash", { command: "git status" })).toBe("git status");
  });

  test("falls back to tool name when command is unavailable", () => {
    expect(extractCommandForPolicy("Bash", {})).toBe("Bash");
    expect(extractCommandForPolicy("Bash", null)).toBe("Bash");
  });
});
