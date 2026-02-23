import {
  getStepSecretPolicy,
  validateStepSecretAccess,
  type WorkflowStepKind,
} from "../../../agent/github/workflowPolicy.js";

describe("workflow secret exposure policy", () => {
  test.each<{
    step: WorkflowStepKind;
    expected: { allowSecrets: boolean; allowRepoWrite: boolean };
  }>([
    { step: "untrusted_analysis", expected: { allowSecrets: false, allowRepoWrite: false } },
    { step: "broker_network", expected: { allowSecrets: true, allowRepoWrite: false } },
    { step: "pr_write", expected: { allowSecrets: true, allowRepoWrite: true } },
    { step: "deploy", expected: { allowSecrets: true, allowRepoWrite: true } },
  ])("returns expected policy for $step", ({ step, expected }) => {
    const policy = getStepSecretPolicy(step);
    expect(policy.allowSecrets).toBe(expected.allowSecrets);
    expect(policy.allowRepoWrite).toBe(expected.allowRepoWrite);
  });

  test("rejects secret usage in untrusted analysis", () => {
    const result = validateStepSecretAccess({
      step: "untrusted_analysis",
      requestedSecrets: ["OPENAI_API_KEY"],
      requestedRepoWrite: false,
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected failure result");
    }
    expect(result.error).toMatch(/untrusted/i);
  });

  test("rejects repo write in broker network step", () => {
    const result = validateStepSecretAccess({
      step: "broker_network",
      requestedSecrets: [],
      requestedRepoWrite: true,
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected failure result");
    }
    expect(result.error).toMatch(/write/i);
  });

  test("allows deploy step access", () => {
    const result = validateStepSecretAccess({
      step: "deploy",
      requestedSecrets: ["DEPLOY_TOKEN"],
      requestedRepoWrite: true,
    });

    expect(result.ok).toBe(true);
  });
});
