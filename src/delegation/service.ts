import type { DelegateResult } from "./types.js";
import type { CreateProposalInput, ProposalStore } from "./proposals.js";
import { randomUUID } from "node:crypto";
import {
  runDelegationInIsolatedWorktree as runDelegationInIsolatedWorktreeDefault,
  cleanupProposalArtifacts as cleanupProposalArtifactsDefault,
  type WorktreeDelegationInput,
  type WorktreeDelegationResult,
} from "./worktree.js";

interface WorkingDirValidationResult {
  valid: boolean;
  error?: string;
}

export interface DelegateWithReviewInput {
  sessionId: string;
  delegatePrompt: string;
  workingDir?: string;
  runId?: string;
}

export interface DelegationTransitionEvent {
  runId: string;
  sessionId: string;
  state: "started" | "proposal_ready" | "no_changes" | "completed" | "failed";
  proposalId?: string;
  error?: string;
}

export interface DelegationServiceDeps {
  proposalStore: Pick<ProposalStore, "createProposal">;
  validateWorkingDir: (dir: string) => WorkingDirValidationResult;
  runDelegationInIsolatedWorktree?: (input: WorktreeDelegationInput) => Promise<WorktreeDelegationResult>;
  cleanupProposalArtifacts?: (proposal: CreateProposalInput) => void;
  runDelegate: (prompt: string, cwd?: string) => Promise<{ exitCode: number; summary: string }>;
  onProposalCreated?: (proposal: CreateProposalInput) => void;
  onStateTransition?: (event: DelegationTransitionEvent) => void;
  createRunId?: () => string;
}

export class DelegationService {
  private readonly deps: DelegationServiceDeps;

  constructor(deps: DelegationServiceDeps) {
    this.deps = deps;
  }

  async delegateWithReview(input: DelegateWithReviewInput): Promise<DelegateResult> {
    const runId = input.runId || this.deps.createRunId?.() || randomUUID();
    const emitTransition = (event: Omit<DelegationTransitionEvent, "runId" | "sessionId">) => {
      this.deps.onStateTransition?.({
        runId,
        sessionId: input.sessionId,
        ...event,
      });
    };

    try {
      if (input.workingDir) {
        const wdValidation = this.deps.validateWorkingDir(input.workingDir);
        if (!wdValidation.valid) {
          throw new Error(wdValidation.error || "Invalid working directory");
        }
      }

      emitTransition({ state: "started" });

      const runDelegationInIsolatedWorktree =
        this.deps.runDelegationInIsolatedWorktree ?? runDelegationInIsolatedWorktreeDefault;
      const cleanupProposalArtifacts =
        this.deps.cleanupProposalArtifacts ?? cleanupProposalArtifactsDefault;

      const result = await runDelegationInIsolatedWorktree({
        sessionId: input.sessionId,
        prompt: input.delegatePrompt,
        repoRoot: input.workingDir,
        runDelegate: (prompt, cwd) => this.deps.runDelegate(prompt, cwd),
      });

      if (result.proposal) {
        const created = this.deps.proposalStore.createProposal(result.proposal);
        if (!created.ok) {
          cleanupProposalArtifacts(result.proposal);
          throw new Error(created.error || "Could not store delegated proposal.");
        }

        this.deps.onProposalCreated?.(result.proposal);
        emitTransition({
          state: "proposal_ready",
          proposalId: result.proposal.id,
        });

        return {
          exitCode: result.exitCode,
          summary: result.summary,
          proposal: {
            id: result.proposal.id,
            projectName: result.proposal.projectName,
            expiresAt: result.proposal.expiresAt,
            changedFiles: result.proposal.changedFiles,
            diffStat: result.proposal.diffStat,
            diffPreview: result.proposal.diffPreview,
            fileDiffs: result.proposal.fileDiffs,
          },
        };
      }

      emitTransition({
        state: result.noChanges ? "no_changes" : "completed",
      });
      return {
        exitCode: result.exitCode,
        summary: result.summary,
        noChanges: result.noChanges,
      };
    } catch (err) {
      emitTransition({
        state: "failed",
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }
}
