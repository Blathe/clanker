export type DelegationStatus =
  | "queued"
  | "running"
  | "proposal_ready"
  | "no_changes"
  | "failed"
  | "accepted"
  | "rejected"
  | "expired";

interface BaseState {
  status: DelegationStatus;
  changedAt: number;
}

export interface QueuedDelegationState extends BaseState {
  status: "queued";
}

export interface RunningDelegationState extends BaseState {
  status: "running";
}

export interface ProposalReadyDelegationState extends BaseState {
  status: "proposal_ready";
  proposalId: string;
}

export interface NoChangesDelegationState extends BaseState {
  status: "no_changes";
}

export interface FailedDelegationState extends BaseState {
  status: "failed";
  error: string;
}

export interface AcceptedDelegationState extends BaseState {
  status: "accepted";
  proposalId: string;
}

export interface RejectedDelegationState extends BaseState {
  status: "rejected";
  proposalId: string;
}

export interface ExpiredDelegationState extends BaseState {
  status: "expired";
  proposalId: string;
}

export type DelegationState =
  | QueuedDelegationState
  | RunningDelegationState
  | ProposalReadyDelegationState
  | NoChangesDelegationState
  | FailedDelegationState
  | AcceptedDelegationState
  | RejectedDelegationState
  | ExpiredDelegationState;

export type DelegationEvent =
  | { type: "start"; at: number }
  | { type: "delegate_success_with_diff"; at: number; proposalId: string }
  | { type: "delegate_success_no_diff"; at: number }
  | { type: "delegate_failed"; at: number; error: string }
  | { type: "accept"; at: number; proposalId?: string }
  | { type: "reject"; at: number; proposalId?: string }
  | { type: "expire"; at: number };

export type DelegationTransitionResult =
  | { ok: true; state: DelegationState }
  | { ok: false; error: string; state: DelegationState };

function invalid(state: DelegationState, event: DelegationEvent, reason?: string): DelegationTransitionResult {
  const suffix = reason ? `: ${reason}` : "";
  return {
    ok: false,
    error: `Invalid delegation transition ${state.status} -> ${event.type}${suffix}`,
    state,
  };
}

function proposalIdMatches(expected: string, provided?: string): boolean {
  return !provided || provided === expected;
}

export function createQueuedDelegationState(at: number): QueuedDelegationState {
  return { status: "queued", changedAt: at };
}

export function isTerminalDelegationStatus(status: DelegationStatus): boolean {
  return (
    status === "no_changes" ||
    status === "failed" ||
    status === "accepted" ||
    status === "rejected" ||
    status === "expired"
  );
}

export function transitionDelegationState(
  state: DelegationState,
  event: DelegationEvent
): DelegationTransitionResult {
  switch (state.status) {
    case "queued": {
      if (event.type !== "start") {
        return invalid(state, event);
      }
      return { ok: true, state: { status: "running", changedAt: event.at } };
    }

    case "running": {
      if (event.type === "delegate_success_with_diff") {
        return {
          ok: true,
          state: { status: "proposal_ready", changedAt: event.at, proposalId: event.proposalId },
        };
      }
      if (event.type === "delegate_success_no_diff") {
        return { ok: true, state: { status: "no_changes", changedAt: event.at } };
      }
      if (event.type === "delegate_failed") {
        return {
          ok: true,
          state: { status: "failed", changedAt: event.at, error: event.error },
        };
      }
      return invalid(state, event);
    }

    case "proposal_ready": {
      if (event.type === "accept") {
        if (!proposalIdMatches(state.proposalId, event.proposalId)) {
          return invalid(state, event, "proposal id mismatch");
        }
        return {
          ok: true,
          state: { status: "accepted", changedAt: event.at, proposalId: state.proposalId },
        };
      }
      if (event.type === "reject") {
        if (!proposalIdMatches(state.proposalId, event.proposalId)) {
          return invalid(state, event, "proposal id mismatch");
        }
        return {
          ok: true,
          state: { status: "rejected", changedAt: event.at, proposalId: state.proposalId },
        };
      }
      if (event.type === "expire") {
        return {
          ok: true,
          state: { status: "expired", changedAt: event.at, proposalId: state.proposalId },
        };
      }
      return invalid(state, event);
    }

    case "no_changes":
    case "failed":
    case "accepted":
    case "rejected":
    case "expired": {
      return invalid(state, event, "state is terminal");
    }

    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}
