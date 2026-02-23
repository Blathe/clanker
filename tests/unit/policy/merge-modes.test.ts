import { evaluateMergeDecision } from "../../../agent/mergeModes.js";

describe("merge mode evaluation", () => {
  test("strict mode never auto-merges", () => {
    const decision = evaluateMergeDecision({
      mode: "Strict",
      touchedPaths: ["/intel/2026-02/report.md"],
      checksPassed: true,
      riskLevel: "R1",
    });

    expect(decision.autoMerge).toBe(false);
  });

  test("whitelist mode auto-merges allowlisted paths when checks pass", () => {
    const decision = evaluateMergeDecision({
      mode: "Whitelist",
      touchedPaths: ["/intel/2026-02/report.md", "/memory/PREFERENCES.md"],
      checksPassed: true,
      riskLevel: "R1",
      whitelist: ["/intel/**", "/memory/**"],
    });

    expect(decision.autoMerge).toBe(true);
  });

  test("whitelist mode blocks non-allowlisted paths", () => {
    const decision = evaluateMergeDecision({
      mode: "Whitelist",
      touchedPaths: ["/intel/2026-02/report.md", "/skills/audit.md"],
      checksPassed: true,
      riskLevel: "R2",
      whitelist: ["/intel/**", "/memory/**"],
    });

    expect(decision.autoMerge).toBe(false);
  });

  test("yolo mode auto-merges any passing job PR, including R3", () => {
    const decision = evaluateMergeDecision({
      mode: "YOLO",
      touchedPaths: ["/agent/main.ts"],
      checksPassed: true,
      riskLevel: "R3",
    });

    expect(decision.autoMerge).toBe(true);
  });

  test("all modes block auto-merge when checks fail", () => {
    const strictDecision = evaluateMergeDecision({
      mode: "Strict",
      touchedPaths: ["/intel/2026-02/report.md"],
      checksPassed: false,
      riskLevel: "R1",
    });
    const whitelistDecision = evaluateMergeDecision({
      mode: "Whitelist",
      touchedPaths: ["/intel/2026-02/report.md"],
      checksPassed: false,
      riskLevel: "R1",
      whitelist: ["/intel/**"],
    });
    const yoloDecision = evaluateMergeDecision({
      mode: "YOLO",
      touchedPaths: ["/agent/main.ts"],
      checksPassed: false,
      riskLevel: "R3",
    });

    expect(strictDecision.autoMerge).toBe(false);
    expect(whitelistDecision.autoMerge).toBe(false);
    expect(yoloDecision.autoMerge).toBe(false);
  });

  test("global kill switch disables auto-merge", () => {
    const decision = evaluateMergeDecision({
      mode: "YOLO",
      touchedPaths: ["/agent/main.ts"],
      checksPassed: true,
      riskLevel: "R3",
      autoMergeKillSwitch: true,
    });

    expect(decision.autoMerge).toBe(false);
  });
});
