import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";
import { JobQueue } from "../../../agent/queue.js";

describe("JobQueue delegate review messaging", () => {
  test("sends proposal metadata and accept/reject hints when available", async () => {
    const queue = new JobQueue();
    const send = jest.fn().mockResolvedValue(undefined);
    const history: ChatCompletionMessageParam[] = [{ role: "system", content: "sys" }];

    const queued = queue.enqueue(
      {
        id: "job-1",
        sessionId: "s-1",
        prompt: "refactor",
        send,
        history,
      },
      async () => ({
        exitCode: 0,
        summary: "Implemented refactor",
        proposal: {
          id: "p-1",
          projectName: "repo-a",
          expiresAt: 1_700_000_900_000,
          changedFiles: ["src/a.ts", "src/b.ts"],
          diffStat: " src/a.ts | 2 +-\n src/b.ts | 3 ++-",
          diffPreview: "diff --git../agent/a.ts../agent/a.ts",
          fileDiffs: [
            {
              filePath: "src/a.ts",
              language: "TypeScript",
              diff: "diff --git../agent/a.ts../agent/a.ts\n+const a = 1;\n",
            },
            {
              filePath: "src/b.ts",
              language: "TypeScript",
              diff: "diff --git../agent/b.ts../agent/b.ts\n+const b = 2;\n",
            },
          ],
        },
      })
    );

    expect(queued).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const sent = send.mock.calls.map((call) => String(call[0])).join("\n");
    expect(sent).toContain("p-1");
    expect(sent).toContain("accept p-1");
    expect(sent).toContain("reject p-1");
    expect(sent).toContain("src/a.ts");
    expect(sent).toContain("Here are the proposed changes to the repo-a project.");
    expect(sent).toContain("Language: TypeScript");
    expect(sent).toContain("```diff");
    expect(send.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(history.length).toBe(2);
  });

  test("keeps existing failure messaging behavior", async () => {
    const queue = new JobQueue();
    const send = jest.fn().mockResolvedValue(undefined);
    const history: ChatCompletionMessageParam[] = [{ role: "system", content: "sys" }];

    queue.enqueue(
      {
        id: "job-2",
        sessionId: "s-1",
        prompt: "refactor",
        send,
        history,
      },
      async () => {
        throw new Error("Delegation failed");
      }
    );

    await new Promise((resolve) => setTimeout(resolve, 50));
    const sent = send.mock.calls.map((call) => String(call[0])).join("\n");
    expect(sent).toContain("The delegated task failed");
    expect(sent).toContain("Delegation failed");
  });
});
