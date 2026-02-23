export type RiskLevel = "R0" | "R1" | "R2" | "R3";
export type ApprovalAuthority = "none" | "owner";

export interface RiskClassification {
  riskLevel: RiskLevel;
  reasons: string[];
}

export interface JobPolicyInput {
  touchedPaths?: string[];
  ownerApproved?: boolean;
}

export interface JobPolicyDecision {
  riskLevel: RiskLevel;
  allowed: boolean;
  requiresApproval: boolean;
  approvalAuthority: ApprovalAuthority;
  reasons: string[];
}

const R1_PREFIXES = ["/jobs/", "/audit/", "/intel/", "/memory/"];
const R2_PREFIXES = ["/skills/", "/cron/"];
const R3_PREFIXES = ["/agent/", "/policies/", "/.github/"];

function normalizePath(path: string): string {
  if (!path) return "/";
  return path.startsWith("/") ? path : `/${path}`;
}

function classifyPathRisk(path: string): RiskLevel {
  const normalized = normalizePath(path);

  if (R3_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return "R3";
  if (R2_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return "R2";
  if (R1_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return "R1";
  return "R3";
}

function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  const order: Record<RiskLevel, number> = { R0: 0, R1: 1, R2: 2, R3: 3 };
  return order[a] >= order[b] ? a : b;
}

export function classifyJobRiskFromTouchedPaths(paths: string[]): RiskClassification {
  if (paths.length === 0) {
    return { riskLevel: "R0", reasons: ["No write paths touched; classified as read-only"] };
  }

  let highest: RiskLevel = "R0";
  let sawUnknown = false;
  for (const path of paths) {
    const normalized = normalizePath(path);
    const risk = classifyPathRisk(normalized);
    highest = maxRisk(highest, risk);

    if (
      risk === "R3" &&
      !R3_PREFIXES.some((prefix) => normalized.startsWith(prefix))
    ) {
      sawUnknown = true;
    }
  }

  const reasons: string[] = [];
  if (highest === "R1") {
    reasons.push("Touches informational paths (/jobs, /audit, /intel, /memory)");
  } else if (highest === "R2") {
    reasons.push("Touches behavior-adjacent paths (/skills or /cron)");
  } else if (highest === "R3") {
    reasons.push("Touches high-risk paths (/agent, /policies, /.github) or unknown write locations");
  }
  if (sawUnknown) {
    reasons.push("At least one touched path is outside explicit allowlisted risk categories");
  }

  return { riskLevel: highest, reasons };
}

export function evaluateJobPolicy(input: JobPolicyInput): JobPolicyDecision {
  const touchedPaths = input.touchedPaths ?? [];
  const risk = classifyJobRiskFromTouchedPaths(touchedPaths);
  const requiresApproval = risk.riskLevel === "R2" || risk.riskLevel === "R3";
  const approvalAuthority: ApprovalAuthority = requiresApproval ? "owner" : "none";
  const allowed = !requiresApproval || Boolean(input.ownerApproved);
  const reasons = [...risk.reasons];

  if (requiresApproval && !allowed) {
    reasons.push("Owner approval required before execution");
  }

  return {
    riskLevel: risk.riskLevel,
    allowed,
    requiresApproval,
    approvalAuthority,
    reasons,
  };
}
