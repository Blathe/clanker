import type { DelegateResult } from "../../../src/delegation/types.js";
import { formatDelegateCompletionMessages } from "../../../src/delegation/messages.js";

describe("delegate proposal message formatting", () => {
  test("renders one diff block per file with language label", () => {
    const result: DelegateResult = {
      exitCode: 0,
      summary: "Done.",
      proposal: {
        id: "p-1",
        projectName: "repo-a",
        expiresAt: 1_700_000_900_000,
        changedFiles: ["src/a.ts", "README.md"],
        diffStat: " src/a.ts | 2 +-\n README.md | 2 ++",
        diffPreview: "diff --git a/src/a.ts b/src/a.ts",
        fileDiffs: [
          {
            filePath: "src/a.ts",
            language: "TypeScript",
            diff: "diff --git a/src/a.ts b/src/a.ts\n+const a = 1;\n",
          },
          {
            filePath: "README.md",
            language: "Markdown",
            diff: "diff --git a/README.md b/README.md\n+hello\n",
          },
        ],
      },
    };

    const messages = formatDelegateCompletionMessages(result);
    const output = messages.join("\n\n");

    expect(messages.length).toBeGreaterThanOrEqual(4);
    expect(output).toContain("Here are the proposed changes to the repo-a project.");
    expect(output).toContain("File: src/a.ts");
    expect(output).toContain("Language: TypeScript");
    expect(output).toContain("File: README.md");
    expect(output).toContain("Language: Markdown");
    expect(output).toContain("```diff");
  });

  test("truncates oversized per-file diffs", () => {
    const longDiff = `diff --git a/src/a.ts b/src/a.ts\n${"+line\n".repeat(1000)}`;
    const result: DelegateResult = {
      exitCode: 0,
      summary: "Done.",
      proposal: {
        id: "p-2",
        projectName: "repo-b",
        expiresAt: 1_700_000_900_000,
        changedFiles: ["src/a.ts"],
        diffStat: " src/a.ts | 1000 +",
        diffPreview: "diff --git a/src/a.ts b/src/a.ts",
        fileDiffs: [
          {
            filePath: "src/a.ts",
            language: "TypeScript",
            diff: longDiff,
          },
        ],
      },
    };

    const messages = formatDelegateCompletionMessages(result);
    const block = messages.find((m) => m.includes("File: src/a.ts")) || "";
    expect(block).toContain("... [diff truncated]");
  });
});
