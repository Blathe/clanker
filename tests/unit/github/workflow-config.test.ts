import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

function workflowPath(name: string): string {
  return join(process.cwd(), ".github", "workflows", name);
}

describe("workflow config", () => {
  const workflowFiles = ["intake.yml", "dispatcher.yml", "deploy.yml"];

  test.each(workflowFiles)("workflow %s exists", (file) => {
    expect(existsSync(workflowPath(file))).toBe(true);
  });

  test("dispatcher workflow sets concurrency group", () => {
    const content = readFileSync(workflowPath("dispatcher.yml"), "utf8");
    expect(content).toMatch(/concurrency:/);
    expect(content).toMatch(/group:\s*clanker-dispatcher/);
  });

  test("intake workflow references orchestration entry point", () => {
    const content = readFileSync(workflowPath("intake.yml"), "utf8");
    expect(content).toMatch(/clanker intake/i);
    expect(content).toMatch(/npm test/i);
  });

  test("deploy workflow is merge-triggered and protected", () => {
    const content = readFileSync(workflowPath("deploy.yml"), "utf8");
    expect(content).toMatch(/on:/);
    expect(content).toMatch(/push:/);
    expect(content).toMatch(/branches:\s*\n\s*-\s*main/);
  });
});
