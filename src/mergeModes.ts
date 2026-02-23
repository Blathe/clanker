import type { RiskLevel } from "./jobPolicy.js";

export type MergeMode = "Strict" | "Whitelist" | "YOLO";

export interface MergeDecisionInput {
  mode: MergeMode;
  touchedPaths: string[];
  checksPassed: boolean;
  riskLevel: RiskLevel;
  whitelist?: string[];
  autoMergeKillSwitch?: boolean;
}

export interface MergeDecision {
  autoMerge: boolean;
  reason: string;
}

function normalizePath(path: string): string {
  if (!path) return "/";
  return path.startsWith("/") ? path : `/${path}`;
}

function matchesPattern(path: string, pattern: string): boolean {
  const normalizedPath = normalizePath(path);
  const normalizedPattern = normalizePath(pattern);

  if (normalizedPattern.endsWith("/**")) {
    const prefix = normalizedPattern.slice(0, -2);
    return normalizedPath.startsWith(prefix);
  }

  return normalizedPath === normalizedPattern;
}

function areAllPathsAllowlisted(paths: string[], whitelist: string[]): boolean {
  return paths.every((path) => whitelist.some((pattern) => matchesPattern(path, pattern)));
}

export function evaluateMergeDecision(input: MergeDecisionInput): MergeDecision {
  if (input.autoMergeKillSwitch) {
    return {
      autoMerge: false,
      reason: "Auto-merge disabled by kill switch",
    };
  }

  if (!input.checksPassed) {
    return {
      autoMerge: false,
      reason: "Required checks have not passed",
    };
  }

  if (input.mode === "Strict") {
    return {
      autoMerge: false,
      reason: "Strict mode requires explicit owner approval for every PR",
    };
  }

  if (input.mode === "Whitelist") {
    const whitelist = input.whitelist ?? ["/intel/**", "/memory/**"];
    const autoMerge = areAllPathsAllowlisted(input.touchedPaths, whitelist);
    return {
      autoMerge,
      reason: autoMerge
        ? "Touched paths are fully allowlisted"
        : "One or more touched paths are outside whitelist",
    };
  }

  return {
    autoMerge: true,
    reason: "YOLO mode auto-merges any passing job PR",
  };
}
