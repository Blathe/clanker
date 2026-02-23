import {
  createReceivedJobState,
  isTerminalJobStatus,
  transitionJobState,
  type JobState,
} from "../../../src/jobs/stateMachine.js";

function apply(state: JobState, event: Parameters<typeof transitionJobState>[1]): JobState {
  const result = transitionJobState(state, event);
  if (!result.ok) {
    throw new Error(`transition failed: ${result.error}`);
  }
  return result.state;
}

describe("job state machine", () => {
  test("follows full PR workflow to done", () => {
    const received = createReceivedJobState("job_1", 100);
    const parsed = apply(received, { type: "parsed", at: 110 });
    const policyChecked = apply(parsed, { type: "policy_checked", at: 120 });
    const planned = apply(policyChecked, { type: "planned", at: 130 });
    const executing = apply(planned, { type: "executing", at: 140 });
    const prOpened = apply(executing, { type: "pr_opened", at: 150, prNumber: 42 });
    const waitingApproval = apply(prOpened, { type: "waiting_approval", at: 160 });
    const merged = apply(waitingApproval, { type: "merged", at: 170 });
    const deployed = apply(merged, { type: "deployed", at: 180 });
    const done = apply(deployed, { type: "done", at: 190 });

    expect(done.status).toBe("DONE");
    expect(isTerminalJobStatus(done.status)).toBe(true);
  });

  test("supports no-repo-change path to done", () => {
    const received = createReceivedJobState("job_2", 100);
    const parsed = apply(received, { type: "parsed", at: 110 });
    const policyChecked = apply(parsed, { type: "policy_checked", at: 120 });
    const planned = apply(policyChecked, { type: "planned", at: 130 });
    const executing = apply(planned, { type: "executing", at: 140 });
    const done = apply(executing, { type: "done", at: 150 });

    expect(done.status).toBe("DONE");
  });

  test("supports denied as terminal from policy_checked", () => {
    const received = createReceivedJobState("job_3", 100);
    const parsed = apply(received, { type: "parsed", at: 110 });
    const policyChecked = apply(parsed, { type: "policy_checked", at: 120 });
    const denied = apply(policyChecked, { type: "denied", at: 130, reason: "R3 requires approval" });

    expect(denied.status).toBe("DENIED");
    expect(isTerminalJobStatus(denied.status)).toBe(true);
  });

  test("supports failed/cancelled/timed_out terminal events", () => {
    const received = createReceivedJobState("job_4", 100);

    const failed = apply(received, { type: "failed", at: 110, reason: "executor crashed" });
    expect(failed.status).toBe("FAILED");

    const received2 = createReceivedJobState("job_5", 100);
    const cancelled = apply(received2, { type: "cancelled", at: 120, reason: "operator cancelled" });
    expect(cancelled.status).toBe("CANCELLED");

    const received3 = createReceivedJobState("job_6", 100);
    const timedOut = apply(received3, { type: "timed_out", at: 130, reason: "deadline exceeded" });
    expect(timedOut.status).toBe("TIMED_OUT");
  });

  test("rejects invalid transitions", () => {
    const received = createReceivedJobState("job_7", 100);
    const invalid = transitionJobState(received, { type: "merged", at: 110 });
    expect(invalid.ok).toBe(false);
  });

  test("terminal states reject further transitions", () => {
    const done: JobState = {
      jobId: "job_8",
      status: "DONE",
      changedAt: 100,
    };

    const result = transitionJobState(done, { type: "parsed", at: 110 });
    expect(result.ok).toBe(false);
  });
});
