import { buildDelegationPrompt } from "../../../src/delegation/promptBuilder.js";

describe("buildDelegationPrompt", () => {
  test("wraps the delegated task in the structured template", () => {
    const prompt = buildDelegationPrompt("Refactor src/main.ts and run tests.");
    expect(prompt).toContain("## Objective");
    expect(prompt).toContain("Refactor src/main.ts and run tests.");
    expect(prompt).toContain("### Changes Made");
    expect(prompt).toContain("### Tests");
    expect(prompt).toContain("### Risks");
    expect(prompt).toContain("### Follow-ups");
  });

  test("throws for empty delegate tasks", () => {
    expect(() => buildDelegationPrompt("   ")).toThrow("cannot be empty");
  });
});
