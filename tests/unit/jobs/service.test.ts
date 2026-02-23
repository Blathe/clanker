import { JobService } from "../../../agent/jobs/service.js";
import type { UserMessagePacket } from "../../../agent/packets/types.js";

function makeUserPacket(jobId: string): UserMessagePacket {
  return {
    packet_type: "user_message",
    packet_id: `pkt_${jobId}`,
    job_id: jobId,
    created_at: "2026-02-23T12:00:00Z",
    channel: "discord",
    session_id: "sess_1",
    message: "scan and patch",
  };
}

describe("job service", () => {
  test("creates and retrieves a job from user packet", () => {
    const service = new JobService();
    const state = service.createJob(makeUserPacket("job_1"), 100);

    expect(state.status).toBe("RECEIVED");
    expect(service.getState("job_1")?.status).toBe("RECEIVED");
  });

  test("denies job from policy decision", () => {
    const service = new JobService();
    service.createJob(makeUserPacket("job_2"), 100);

    service.markParsed("job_2", 110);
    const denied = service.applyPolicyDecision("job_2", 120, {
      allowed: false,
      reason: "R3 owner approval required",
    });

    expect(denied.status).toBe("DENIED");
    if (denied.status !== "DENIED") {
      throw new Error("expected denied state");
    }
    expect(denied.reason).toContain("R3");
  });

  test("supports no-change lifecycle to done", () => {
    const service = new JobService();
    service.createJob(makeUserPacket("job_3"), 100);

    service.markParsed("job_3", 110);
    service.applyPolicyDecision("job_3", 120, { allowed: true });
    service.markPlanned("job_3", 130);
    service.markExecuting("job_3", 140);
    const done = service.markDone("job_3", 150);

    expect(done.status).toBe("DONE");
  });

  test("supports PR workflow and enforces one PR per job", () => {
    const service = new JobService();
    service.createJob(makeUserPacket("job_4"), 100);

    service.markParsed("job_4", 110);
    service.applyPolicyDecision("job_4", 120, { allowed: true });
    service.markPlanned("job_4", 130);
    service.markExecuting("job_4", 140);
    service.openPr("job_4", 150, 99);
    service.markWaitingApproval("job_4", 160);
    service.markMerged("job_4", 170);
    service.markDeployed("job_4", 180);
    const done = service.markDone("job_4", 190);

    expect(done.status).toBe("DONE");

    expect(() => service.openPr("job_4", 200, 100)).toThrow("already has PR");
  });

  test("throws when job does not exist", () => {
    const service = new JobService();
    expect(() => service.markParsed("missing", 100)).toThrow("Job not found");
  });
});
