import type { DelegateResult } from "./types.js";
import type { CreateProposalInput, ProposalStore } from "./proposals.js";
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
}

export interface DelegationServiceDeps {
  proposalStore: Pick<ProposalStore, "createProposal">;
  validateWorkingDir: (dir: string) => WorkingDirValidationResult;
  runDelegationInIsolatedWorktree?: (input: WorktreeDelegationInput) => Promise<WorktreeDelegationResult>;
  cleanupProposalArtifacts?: (proposal: CreateProposalInput) => void;
  runDelegate: (prompt: string, cwd?: string) => Promise<{ exitCode: number; summary: string }>;
  onProposalCreated?: (proposal: CreateProposalInput) => void;
}

export class DelegationService {
  private readonly deps: DelegationServiceDeps;

  constructor(deps: DelegationServiceDeps) {
    this.deps = deps;
  }

  async delegateWithReview(input: DelegateWithReviewInput): Promise<DelegateResult> {
    if (input.workingDir) {
      const wdValidation = this.deps.validateWorkingDir(input.workingDir);
      if (!wdValidation.valid) {
        throw new Error(wdValidation.error || "Invalid working directory");
      }
    }

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

    return {
      exitCode: result.exitCode,
      summary: result.summary,
      noChanges: result.noChanges,
    };
  }
}
