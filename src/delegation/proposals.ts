export interface PendingProposal {
  id: string;
  sessionId: string;
  createdAt: number;
  expiresAt: number;
  repoRoot: string;
  baseHead: string;
  worktreePath: string;
  patchPath: string;
  changedFiles: string[];
  diffStat: string;
  diffPreview: string;
  delegateSummary: string;
  delegateExitCode: number;
}

export type CreateProposalInput = PendingProposal;

export interface ProposalResolutionResult {
  ok: boolean;
  proposal?: PendingProposal;
  error?: string;
}

export class ProposalStore {
  private bySession: Map<string, PendingProposal> = new Map();

  createProposal(input: CreateProposalInput): ProposalResolutionResult {
    const existing = this.bySession.get(input.sessionId);
    if (existing) {
      return {
        ok: false,
        error: `Session ${input.sessionId} already has a pending proposal (${existing.id}).`,
      };
    }
    this.bySession.set(input.sessionId, input);
    return { ok: true, proposal: input };
  }

  getProposal(sessionId: string): PendingProposal | null {
    return this.bySession.get(sessionId) ?? null;
  }

  hasPending(sessionId: string): boolean {
    return this.bySession.has(sessionId);
  }

  listPending(sessionId?: string): PendingProposal[] {
    if (sessionId) {
      const proposal = this.bySession.get(sessionId);
      return proposal ? [proposal] : [];
    }
    return [...this.bySession.values()];
  }

  acceptProposal(sessionId: string, optionalId?: string): ProposalResolutionResult {
    const resolved = this.resolve(sessionId, optionalId);
    if (!resolved.ok || !resolved.proposal) return resolved;
    this.bySession.delete(sessionId);
    return resolved;
  }

  rejectProposal(sessionId: string, optionalId?: string): ProposalResolutionResult {
    const resolved = this.resolve(sessionId, optionalId);
    if (!resolved.ok || !resolved.proposal) return resolved;
    this.bySession.delete(sessionId);
    return resolved;
  }

  expireStale(now: number = Date.now()): PendingProposal[] {
    const expired: PendingProposal[] = [];
    for (const [sessionId, proposal] of this.bySession.entries()) {
      if (proposal.expiresAt <= now) {
        expired.push(proposal);
        this.bySession.delete(sessionId);
      }
    }
    return expired;
  }

  private resolve(sessionId: string, optionalId?: string): ProposalResolutionResult {
    const proposal = this.bySession.get(sessionId);
    if (!proposal) {
      return {
        ok: false,
        error: `No pending proposal exists for session ${sessionId}.`,
      };
    }
    if (optionalId && proposal.id !== optionalId) {
      return {
        ok: false,
        error: `Proposal id ${optionalId} does not match pending proposal ${proposal.id}.`,
      };
    }
    return { ok: true, proposal };
  }
}
