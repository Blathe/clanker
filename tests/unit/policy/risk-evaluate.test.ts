import { evaluateJobPolicy, classifyJobRiskFromTouchedPaths } from "../../../src/jobPolicy.js";

describe("job policy risk classification", () => {
  test("classifies R0 when no files are touched", () => {
    const risk = classifyJobRiskFromTouchedPaths([]);
    expect(risk.riskLevel).toBe("R0");
  });

  test("classifies informational writes as R1", () => {
    const risk = classifyJobRiskFromTouchedPaths(["/jobs/2026/02/job.md", "/audit/2026/02/events.jsonl"]);
    expect(risk.riskLevel).toBe("R1");
  });

  test("classifies skills/cron changes as R2", () => {
    const risk = classifyJobRiskFromTouchedPaths(["/skills/website-audit.md", "/cron/jobs.json"]);
    expect(risk.riskLevel).toBe("R2");
  });

  test("classifies agent/policy/workflow changes as R3", () => {
    const risk = classifyJobRiskFromTouchedPaths(["/agent/executor.ts", "/.github/workflows/intake.yml"]);
    expect(risk.riskLevel).toBe("R3");
  });

  test("treats unknown write locations as R3 by default", () => {
    const risk = classifyJobRiskFromTouchedPaths(["/src/random.ts"]);
    expect(risk.riskLevel).toBe("R3");
  });
});

describe("job policy approval semantics", () => {
  test("allows R0/R1 changes without owner approval", () => {
    const decision = evaluateJobPolicy({
      touchedPaths: ["/intel/2026-02/report.md"],
      ownerApproved: false,
    });

    expect(decision.allowed).toBe(true);
    expect(decision.requiresApproval).toBe(false);
    expect(decision.approvalAuthority).toBe("none");
  });

  test("blocks risky changes until owner approves", () => {
    const decision = evaluateJobPolicy({
      touchedPaths: ["/policies/policy.json"],
      ownerApproved: false,
    });

    expect(decision.riskLevel).toBe("R3");
    expect(decision.allowed).toBe(false);
    expect(decision.requiresApproval).toBe(true);
    expect(decision.approvalAuthority).toBe("owner");
  });

  test("allows risky changes once owner approved", () => {
    const decision = evaluateJobPolicy({
      touchedPaths: ["/skills/new-skill.md"],
      ownerApproved: true,
    });

    expect(decision.riskLevel).toBe("R2");
    expect(decision.allowed).toBe(true);
    expect(decision.requiresApproval).toBe(true);
    expect(decision.approvalAuthority).toBe("owner");
  });
});
