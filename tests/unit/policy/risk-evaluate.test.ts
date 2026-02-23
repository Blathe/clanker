import { evaluatePolicyV2, classifyRiskFromTouchedPaths } from "../../../src/policyV2.js";

describe("policy v2 risk classification", () => {
  test("classifies R0 when no files are touched", () => {
    const risk = classifyRiskFromTouchedPaths([]);
    expect(risk.riskLevel).toBe("R0");
  });

  test("classifies informational writes as R1", () => {
    const risk = classifyRiskFromTouchedPaths(["/jobs/2026/02/job.md", "/audit/2026/02/events.jsonl"]);
    expect(risk.riskLevel).toBe("R1");
  });

  test("classifies skills/cron changes as R2", () => {
    const risk = classifyRiskFromTouchedPaths(["/skills/website-audit.md", "/cron/jobs.json"]);
    expect(risk.riskLevel).toBe("R2");
  });

  test("classifies agent/policy/workflow changes as R3", () => {
    const risk = classifyRiskFromTouchedPaths(["/agent/executor.ts", "/.github/workflows/intake.yml"]);
    expect(risk.riskLevel).toBe("R3");
  });

  test("treats unknown write locations as R3 by default", () => {
    const risk = classifyRiskFromTouchedPaths(["/src/random.ts"]);
    expect(risk.riskLevel).toBe("R3");
  });
});

describe("policy v2 approval semantics", () => {
  test("allows R0/R1 changes without owner approval", () => {
    const decision = evaluatePolicyV2({
      touchedPaths: ["/intel/2026-02/report.md"],
      ownerApproved: false,
    });

    expect(decision.allowed).toBe(true);
    expect(decision.requiresApproval).toBe(false);
    expect(decision.approvalAuthority).toBe("none");
  });

  test("blocks risky changes until owner approves", () => {
    const decision = evaluatePolicyV2({
      touchedPaths: ["/policies/policy.json"],
      ownerApproved: false,
    });

    expect(decision.riskLevel).toBe("R3");
    expect(decision.allowed).toBe(false);
    expect(decision.requiresApproval).toBe(true);
    expect(decision.approvalAuthority).toBe("owner");
  });

  test("allows risky changes once owner approved", () => {
    const decision = evaluatePolicyV2({
      touchedPaths: ["/skills/new-skill.md"],
      ownerApproved: true,
    });

    expect(decision.riskLevel).toBe("R2");
    expect(decision.allowed).toBe(true);
    expect(decision.requiresApproval).toBe(true);
    expect(decision.approvalAuthority).toBe("owner");
  });
});
