export type JobStatus =
  | "RECEIVED"
  | "PARSED"
  | "POLICY_CHECKED"
  | "PLANNED"
  | "EXECUTING"
  | "PR_OPENED"
  | "WAITING_APPROVAL"
  | "MERGED"
  | "DEPLOYED"
  | "DONE"
  | "DENIED"
  | "FAILED"
  | "CANCELLED"
  | "TIMED_OUT";

interface BaseJobState {
  jobId: string;
  status: JobStatus;
  changedAt: number;
}

export interface ReceivedJobState extends BaseJobState {
  status: "RECEIVED";
}

export interface ParsedJobState extends BaseJobState {
  status: "PARSED";
}

export interface PolicyCheckedJobState extends BaseJobState {
  status: "POLICY_CHECKED";
}

export interface PlannedJobState extends BaseJobState {
  status: "PLANNED";
}

export interface ExecutingJobState extends BaseJobState {
  status: "EXECUTING";
}

export interface PrOpenedJobState extends BaseJobState {
  status: "PR_OPENED";
  prNumber: number;
}

export interface WaitingApprovalJobState extends BaseJobState {
  status: "WAITING_APPROVAL";
  prNumber?: number;
}

export interface MergedJobState extends BaseJobState {
  status: "MERGED";
  prNumber?: number;
}

export interface DeployedJobState extends BaseJobState {
  status: "DEPLOYED";
  prNumber?: number;
}

export interface DoneJobState extends BaseJobState {
  status: "DONE";
  prNumber?: number;
}

export interface DeniedJobState extends BaseJobState {
  status: "DENIED";
  reason: string;
}

export interface FailedJobState extends BaseJobState {
  status: "FAILED";
  reason: string;
}

export interface CancelledJobState extends BaseJobState {
  status: "CANCELLED";
  reason: string;
}

export interface TimedOutJobState extends BaseJobState {
  status: "TIMED_OUT";
  reason: string;
}

export type JobState =
  | ReceivedJobState
  | ParsedJobState
  | PolicyCheckedJobState
  | PlannedJobState
  | ExecutingJobState
  | PrOpenedJobState
  | WaitingApprovalJobState
  | MergedJobState
  | DeployedJobState
  | DoneJobState
  | DeniedJobState
  | FailedJobState
  | CancelledJobState
  | TimedOutJobState;

export type JobEvent =
  | { type: "parsed"; at: number }
  | { type: "policy_checked"; at: number }
  | { type: "planned"; at: number }
  | { type: "executing"; at: number }
  | { type: "pr_opened"; at: number; prNumber: number }
  | { type: "waiting_approval"; at: number }
  | { type: "merged"; at: number }
  | { type: "deployed"; at: number }
  | { type: "done"; at: number }
  | { type: "denied"; at: number; reason: string }
  | { type: "failed"; at: number; reason: string }
  | { type: "cancelled"; at: number; reason: string }
  | { type: "timed_out"; at: number; reason: string };

export type JobTransitionResult =
  | { ok: true; state: JobState }
  | { ok: false; error: string; state: JobState };

export function createReceivedJobState(jobId: string, at: number): ReceivedJobState {
  return { jobId, status: "RECEIVED", changedAt: at };
}

export function isTerminalJobStatus(status: JobStatus): boolean {
  return status === "DONE" || status === "DENIED" || status === "FAILED" || status === "CANCELLED" || status === "TIMED_OUT";
}

function invalid(state: JobState, event: JobEvent, reason?: string): JobTransitionResult {
  const suffix = reason ? `: ${reason}` : "";
  return {
    ok: false,
    error: `Invalid job transition ${state.status} -> ${event.type}${suffix}`,
    state,
  };
}

function toFailureTerminal(
  state: JobState,
  event: Extract<JobEvent, { type: "failed" | "cancelled" | "timed_out" }>
): JobState {
  if (event.type === "failed") {
    return { jobId: state.jobId, status: "FAILED", changedAt: event.at, reason: event.reason };
  }
  if (event.type === "cancelled") {
    return { jobId: state.jobId, status: "CANCELLED", changedAt: event.at, reason: event.reason };
  }
  return { jobId: state.jobId, status: "TIMED_OUT", changedAt: event.at, reason: event.reason };
}

function handleUniversalTerminal(state: JobState, event: JobEvent): JobTransitionResult | null {
  if (event.type === "failed" || event.type === "cancelled" || event.type === "timed_out") {
    return { ok: true, state: toFailureTerminal(state, event) };
  }
  return null;
}

export function transitionJobState(state: JobState, event: JobEvent): JobTransitionResult {
  if (isTerminalJobStatus(state.status)) {
    return invalid(state, event, "state is terminal");
  }

  const universalTerminal = handleUniversalTerminal(state, event);
  if (universalTerminal) {
    return universalTerminal;
  }

  switch (state.status) {
    case "RECEIVED":
      if (event.type === "parsed") {
        return { ok: true, state: { jobId: state.jobId, status: "PARSED", changedAt: event.at } };
      }
      return invalid(state, event);

    case "PARSED":
      if (event.type === "policy_checked") {
        return { ok: true, state: { jobId: state.jobId, status: "POLICY_CHECKED", changedAt: event.at } };
      }
      return invalid(state, event);

    case "POLICY_CHECKED":
      if (event.type === "planned") {
        return { ok: true, state: { jobId: state.jobId, status: "PLANNED", changedAt: event.at } };
      }
      if (event.type === "denied") {
        return {
          ok: true,
          state: { jobId: state.jobId, status: "DENIED", changedAt: event.at, reason: event.reason },
        };
      }
      return invalid(state, event);

    case "PLANNED":
      if (event.type === "executing") {
        return { ok: true, state: { jobId: state.jobId, status: "EXECUTING", changedAt: event.at } };
      }
      return invalid(state, event);

    case "EXECUTING":
      if (event.type === "pr_opened") {
        return {
          ok: true,
          state: { jobId: state.jobId, status: "PR_OPENED", changedAt: event.at, prNumber: event.prNumber },
        };
      }
      if (event.type === "done") {
        return { ok: true, state: { jobId: state.jobId, status: "DONE", changedAt: event.at } };
      }
      return invalid(state, event);

    case "PR_OPENED":
      if (event.type === "waiting_approval") {
        return {
          ok: true,
          state: { jobId: state.jobId, status: "WAITING_APPROVAL", changedAt: event.at, prNumber: state.prNumber },
        };
      }
      if (event.type === "merged") {
        return {
          ok: true,
          state: { jobId: state.jobId, status: "MERGED", changedAt: event.at, prNumber: state.prNumber },
        };
      }
      return invalid(state, event);

    case "WAITING_APPROVAL":
      if (event.type === "merged") {
        return {
          ok: true,
          state: { jobId: state.jobId, status: "MERGED", changedAt: event.at, prNumber: state.prNumber },
        };
      }
      return invalid(state, event);

    case "MERGED":
      if (event.type === "deployed") {
        return {
          ok: true,
          state: { jobId: state.jobId, status: "DEPLOYED", changedAt: event.at, prNumber: state.prNumber },
        };
      }
      return invalid(state, event);

    case "DEPLOYED":
      if (event.type === "done") {
        return {
          ok: true,
          state: { jobId: state.jobId, status: "DONE", changedAt: event.at, prNumber: state.prNumber },
        };
      }
      return invalid(state, event);

    case "DONE":
    case "DENIED":
    case "FAILED":
    case "CANCELLED":
    case "TIMED_OUT":
      return invalid(state, event, "state is terminal");

    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}
