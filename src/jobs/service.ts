import type { UserMessagePacket } from "../packets/types.js";
import {
  createReceivedJobState,
  transitionJobState,
  type JobState,
} from "./stateMachine.js";

export interface PolicyDecisionInput {
  allowed: boolean;
  reason?: string;
}

export class JobService {
  private readonly states = new Map<string, JobState>();
  private readonly jobPrNumbers = new Map<string, number>();
  private readonly initialPackets = new Map<string, UserMessagePacket>();

  createJob(packet: UserMessagePacket, at: number): JobState {
    if (this.states.has(packet.job_id)) {
      throw new Error(`Job already exists: ${packet.job_id}`);
    }

    const state = createReceivedJobState(packet.job_id, at);
    this.states.set(packet.job_id, state);
    this.initialPackets.set(packet.job_id, packet);
    return state;
  }

  getState(jobId: string): JobState | null {
    return this.states.get(jobId) ?? null;
  }

  getInitialPacket(jobId: string): UserMessagePacket | null {
    return this.initialPackets.get(jobId) ?? null;
  }

  markParsed(jobId: string, at: number): JobState {
    return this.applyEvent(jobId, { type: "parsed", at });
  }

  applyPolicyDecision(jobId: string, at: number, decision: PolicyDecisionInput): JobState {
    this.applyEvent(jobId, { type: "policy_checked", at });

    if (!decision.allowed) {
      return this.applyEvent(jobId, {
        type: "denied",
        at,
        reason: decision.reason || "Blocked by policy",
      });
    }

    return this.requireState(jobId);
  }

  markPlanned(jobId: string, at: number): JobState {
    return this.applyEvent(jobId, { type: "planned", at });
  }

  markExecuting(jobId: string, at: number): JobState {
    return this.applyEvent(jobId, { type: "executing", at });
  }

  openPr(jobId: string, at: number, prNumber: number): JobState {
    if (this.jobPrNumbers.has(jobId)) {
      throw new Error(`Job ${jobId} already has PR #${this.jobPrNumbers.get(jobId)}`);
    }

    const next = this.applyEvent(jobId, { type: "pr_opened", at, prNumber });
    this.jobPrNumbers.set(jobId, prNumber);
    return next;
  }

  markWaitingApproval(jobId: string, at: number): JobState {
    return this.applyEvent(jobId, { type: "waiting_approval", at });
  }

  markMerged(jobId: string, at: number): JobState {
    return this.applyEvent(jobId, { type: "merged", at });
  }

  markDeployed(jobId: string, at: number): JobState {
    return this.applyEvent(jobId, { type: "deployed", at });
  }

  markDone(jobId: string, at: number): JobState {
    return this.applyEvent(jobId, { type: "done", at });
  }

  markFailed(jobId: string, at: number, reason: string): JobState {
    return this.applyEvent(jobId, { type: "failed", at, reason });
  }

  markCancelled(jobId: string, at: number, reason: string): JobState {
    return this.applyEvent(jobId, { type: "cancelled", at, reason });
  }

  markTimedOut(jobId: string, at: number, reason: string): JobState {
    return this.applyEvent(jobId, { type: "timed_out", at, reason });
  }

  private requireState(jobId: string): JobState {
    const state = this.states.get(jobId);
    if (!state) {
      throw new Error(`Job not found: ${jobId}`);
    }
    return state;
  }

  private applyEvent(jobId: string, event: Parameters<typeof transitionJobState>[1]): JobState {
    const state = this.requireState(jobId);
    const result = transitionJobState(state, event);
    if (!result.ok) {
      throw new Error(result.error);
    }
    this.states.set(jobId, result.state);
    return result.state;
  }
}

