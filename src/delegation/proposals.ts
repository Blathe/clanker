import type { ProposalFileDiff } from "./types.js";
import {
  createQueuedDelegationState,
  transitionDelegationState,
  type DelegationState,
} from "./stateMachine.js";
import {
  InMemoryProposalRepository,
  type ProposalRepository,
  type StoredProposalRecord,
} from "./repository.js";

export interface PendingProposal {
  id: string;
  sessionId: string;
  createdAt: number;
  expiresAt: number;
  projectName: string;
  repoRoot: string;
  baseHead: string;
  worktreePath: string;
  patchPath: string;
  changedFiles: string[];
  diffStat: string;
  diffPreview: string;
  fileDiffs: ProposalFileDiff[];
  delegateSummary: string;
  delegateExitCode: number;
}

export type CreateProposalInput = PendingProposal;

export interface ProposalResolutionResult {
  ok: boolean;
  proposal?: PendingProposal;
  state?: DelegationState;
  error?: string;
}

export class ProposalStore {
  private readonly repository: ProposalRepository;

  constructor(repository: ProposalRepository = new InMemoryProposalRepository()) {
    this.repository = repository;
  }

  createProposal(input: CreateProposalInput): ProposalResolutionResult {
    const existing = this.repository.get(input.sessionId);
    if (existing) {
      return {
        ok: false,
        error: `Session ${input.sessionId} already has a pending proposal (${existing.proposal.id}).`,
      };
    }

    const queued = createQueuedDelegationState(input.createdAt);
    const running = transitionDelegationState(queued, { type: "start", at: input.createdAt });
    if (!running.ok) {
      return { ok: false, error: running.error };
    }
    const ready = transitionDelegationState(running.state, {
      type: "delegate_success_with_diff",
      at: input.createdAt,
      proposalId: input.id,
    });
    if (!ready.ok) {
      return { ok: false, error: ready.error };
    }

    this.repository.set({ proposal: input, state: ready.state });
    return { ok: true, proposal: input, state: ready.state };
  }

  getProposal(sessionId: string): PendingProposal | null {
    return this.repository.get(sessionId)?.proposal ?? null;
  }

  getState(sessionId: string): DelegationState | null {
    return this.repository.get(sessionId)?.state ?? null;
  }

  hasPending(sessionId: string): boolean {
    return this.repository.has(sessionId);
  }

  listPending(sessionId?: string): PendingProposal[] {
    return this.repository.list(sessionId).map((record) => record.proposal);
  }

  acceptProposal(sessionId: string, optionalId?: string, at: number = Date.now()): ProposalResolutionResult {
    const resolved = this.resolve(sessionId, optionalId);
    if (!resolved.ok || !resolved.proposal || !resolved.state) return resolved;

    const transitioned = transitionDelegationState(resolved.state, {
      type: "accept",
      at,
      proposalId: optionalId,
    });
    if (!transitioned.ok) {
      return { ok: false, error: transitioned.error };
    }

    this.repository.delete(sessionId);
    return { ok: true, proposal: resolved.proposal, state: transitioned.state };
  }

  rejectProposal(sessionId: string, optionalId?: string, at: number = Date.now()): ProposalResolutionResult {
    const resolved = this.resolve(sessionId, optionalId);
    if (!resolved.ok || !resolved.proposal || !resolved.state) return resolved;

    const transitioned = transitionDelegationState(resolved.state, {
      type: "reject",
      at,
      proposalId: optionalId,
    });
    if (!transitioned.ok) {
      return { ok: false, error: transitioned.error };
    }

    this.repository.delete(sessionId);
    return { ok: true, proposal: resolved.proposal, state: transitioned.state };
  }

  expireStale(now: number = Date.now()): PendingProposal[] {
    const expired: PendingProposal[] = [];
    for (const record of this.repository.list()) {
      const sessionId = record.proposal.sessionId;
      if (record.proposal.expiresAt <= now) {
        const transitioned = transitionDelegationState(record.state, {
          type: "expire",
          at: now,
        });
        if (!transitioned.ok) {
          // Remove stale records even if state bookkeeping was already terminal.
          this.repository.delete(sessionId);
          expired.push(record.proposal);
          continue;
        }
        expired.push(record.proposal);
        this.repository.delete(sessionId);
      }
    }
    return expired;
  }

  private resolve(sessionId: string, optionalId?: string): ProposalResolutionResult {
    const record = this.repository.get(sessionId);
    if (!record) {
      return {
        ok: false,
        error: `No pending proposal exists for session ${sessionId}.`,
      };
    }
    if (optionalId && record.proposal.id !== optionalId) {
      return {
        ok: false,
        error: `Proposal id ${optionalId} does not match pending proposal ${record.proposal.id}.`,
      };
    }
    return { ok: true, proposal: record.proposal, state: record.state };
  }
}
