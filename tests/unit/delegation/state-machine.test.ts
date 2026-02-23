import {
  createQueuedDelegationState,
  isTerminalDelegationStatus,
  transitionDelegationState,
  type DelegationState,
} from "../../../agent/delegation/stateMachine.js";

function apply(state: DelegationState, event: Parameters<typeof transitionDelegationState>[1]) {
  const result = transitionDelegationState(state, event);
  if (!result.ok) {
    throw new Error(`transition failed: ${result.error}`);
  }
  return result.state;
}

describe("delegation state machine", () => {
  test("moves queued -> running -> proposal_ready -> accepted", () => {
    const queued = createQueuedDelegationState(100);

    const running = apply(queued, { type: "start", at: 110 });
    expect(running.status).toBe("running");

    const ready = apply(running, {
      type: "delegate_success_with_diff",
      at: 120,
      proposalId: "p-1",
    });
    expect(ready.status).toBe("proposal_ready");

    const accepted = apply(ready, { type: "accept", at: 130, proposalId: "p-1" });
    expect(accepted.status).toBe("accepted");
  });

  test("moves running -> no_changes", () => {
    const queued = createQueuedDelegationState(100);
    const running = apply(queued, { type: "start", at: 101 });
    const noChanges = apply(running, { type: "delegate_success_no_diff", at: 102 });
    expect(noChanges.status).toBe("no_changes");
    expect(isTerminalDelegationStatus(noChanges.status)).toBe(true);
  });

  test("moves running -> failed with error", () => {
    const queued = createQueuedDelegationState(100);
    const running = apply(queued, { type: "start", at: 101 });
    const failed = apply(running, { type: "delegate_failed", at: 103, error: "delegate crashed" });
    expect(failed.status).toBe("failed");
    if (failed.status !== "failed") {
      throw new Error("expected failed state");
    }
    expect(failed.error).toBe("delegate crashed");
  });

  test("moves proposal_ready -> rejected", () => {
    const queued = createQueuedDelegationState(100);
    const running = apply(queued, { type: "start", at: 101 });
    const ready = apply(running, {
      type: "delegate_success_with_diff",
      at: 102,
      proposalId: "p-2",
    });
    const rejected = apply(ready, { type: "reject", at: 103, proposalId: "p-2" });
    expect(rejected.status).toBe("rejected");
  });

  test("moves proposal_ready -> expired", () => {
    const queued = createQueuedDelegationState(100);
    const running = apply(queued, { type: "start", at: 101 });
    const ready = apply(running, {
      type: "delegate_success_with_diff",
      at: 102,
      proposalId: "p-3",
    });
    const expired = apply(ready, { type: "expire", at: 200 });
    expect(expired.status).toBe("expired");
  });

  test("rejects invalid transitions", () => {
    const queued = createQueuedDelegationState(100);
    const noStart = transitionDelegationState(queued, { type: "delegate_success_no_diff", at: 101 });
    expect(noStart.ok).toBe(false);

    const running = apply(queued, { type: "start", at: 101 });
    const acceptTooEarly = transitionDelegationState(running, { type: "accept", at: 102, proposalId: "p-1" });
    expect(acceptTooEarly.ok).toBe(false);
  });

  test("rejects accept/reject when proposal id does not match", () => {
    const queued = createQueuedDelegationState(100);
    const running = apply(queued, { type: "start", at: 101 });
    const ready = apply(running, {
      type: "delegate_success_with_diff",
      at: 102,
      proposalId: "p-9",
    });

    const mismatchedAccept = transitionDelegationState(ready, {
      type: "accept",
      at: 103,
      proposalId: "p-wrong",
    });
    expect(mismatchedAccept.ok).toBe(false);

    const mismatchedReject = transitionDelegationState(ready, {
      type: "reject",
      at: 103,
      proposalId: "p-wrong",
    });
    expect(mismatchedReject.ok).toBe(false);
  });

  test("terminal states reject further transitions", () => {
    const accepted: DelegationState = {
      status: "accepted",
      changedAt: 10,
      proposalId: "p-1",
    };
    const result = transitionDelegationState(accepted, { type: "start", at: 11 });
    expect(result.ok).toBe(false);
  });
});
