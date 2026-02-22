import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";
import type { DelegationControlCommand } from "./commandParser.js";
import { formatPendingProposalMessages } from "./messages.js";
import type { PendingProposal, ProposalStore } from "./proposals.js";
import type { Channel, SendFn } from "../runtime.js";

export interface ApprovalServiceDeps {
  channel: Channel;
  sessionId: string;
  discordUnsafeEnableWrites: boolean;
  now: () => number;
  send: SendFn;
  history: ChatCompletionMessageParam[];
  proposalStore: ProposalStore;
  verifyApplyPreconditions: (proposal: PendingProposal) => { ok: boolean; error?: string };
  applyPatch: (proposal: PendingProposal) => { ok: boolean; error?: string };
  cleanupProposal: (proposal: PendingProposal) => void;
  onProposalExpired?: (proposal: PendingProposal) => void;
  onProposalAccepted?: (proposal: PendingProposal) => void;
  onProposalRejected?: (proposal: PendingProposal) => void;
  onProposalApplyFailed?: (proposal: PendingProposal, error: string) => void;
}

export interface ApprovalResult {
  handled: boolean;
}

function pushHistory(history: ChatCompletionMessageParam[], content: string): void {
  history.push({ role: "user", content });
}

function canApplyFromChannel(channel: Channel, discordUnsafeEnableWrites: boolean): boolean {
  if (channel !== "discord") return true;
  return discordUnsafeEnableWrites;
}

function resolvePendingForSession(
  deps: ApprovalServiceDeps,
  optionalId?: string
): { ok: boolean; proposal?: PendingProposal; error?: string } {
  const proposal = deps.proposalStore.getProposal(deps.sessionId);
  if (!proposal) {
    return { ok: false, error: "No pending delegated proposal for this session." };
  }
  if (optionalId && proposal.id !== optionalId) {
    return {
      ok: false,
      error: `Proposal id ${optionalId} does not match pending proposal ${proposal.id}.`,
    };
  }
  return { ok: true, proposal };
}

function expireStaleForSession(deps: ApprovalServiceDeps): { expiredForSession: boolean } {
  const expired = deps.proposalStore.expireStale(deps.now());
  let expiredForSession = false;
  for (const proposal of expired) {
    if (proposal.sessionId === deps.sessionId) {
      expiredForSession = true;
    }
    deps.cleanupProposal(proposal);
    deps.onProposalExpired?.(proposal);
  }
  return { expiredForSession };
}

export class DelegationApprovalService {
  private readonly deps: ApprovalServiceDeps;

  constructor(deps: ApprovalServiceDeps) {
    this.deps = deps;
  }

  async handle(parsed: DelegationControlCommand): Promise<ApprovalResult> {
    if (parsed.type === "none") return { handled: false };

    const { expiredForSession } = expireStaleForSession(this.deps);

    if (parsed.type === "invalid") {
      await this.deps.send(`[INVALID] ${parsed.error}`);
      pushHistory(this.deps.history, `Delegation control command rejected: ${parsed.error}`);
      return { handled: true };
    }

    if (parsed.type === "pending") {
      const pending = this.deps.proposalStore.getProposal(this.deps.sessionId);
      if (!pending) {
        await this.deps.send("There is no pending delegated proposal for this session.");
        pushHistory(this.deps.history, "No pending delegated proposal.");
        return { handled: true };
      }
      for (const msg of formatPendingProposalMessages(pending)) {
        await this.deps.send(msg);
      }
      pushHistory(this.deps.history, `Pending proposal shown: ${pending.id}`);
      return { handled: true };
    }

    if (parsed.type === "reject") {
      const resolved = this.deps.proposalStore.rejectProposal(this.deps.sessionId, parsed.proposalId, this.deps.now());
      if (!resolved.ok || !resolved.proposal) {
        if (expiredForSession) {
          await this.deps.send("The pending proposal expired and was discarded.");
        } else {
          await this.deps.send(resolved.error || "Could not reject proposal.");
        }
        pushHistory(this.deps.history, `Proposal reject failed: ${resolved.error || "unknown error"}`);
        return { handled: true };
      }
      this.deps.cleanupProposal(resolved.proposal);
      this.deps.onProposalRejected?.(resolved.proposal);
      await this.deps.send(`[PROPOSAL REJECTED] ${resolved.proposal.id}\n\nProposal rejected.`);
      pushHistory(this.deps.history, `Proposal rejected: ${resolved.proposal.id}`);
      return { handled: true };
    }

    if (!canApplyFromChannel(this.deps.channel, this.deps.discordUnsafeEnableWrites)) {
      await this.deps.send(
        "Applying delegated changes is disabled from Discord unless DISCORD_UNSAFE_ENABLE_WRITES=1."
      );
      pushHistory(this.deps.history, "Proposal apply denied from Discord unsafe mode off.");
      return { handled: true };
    }

    const resolved = resolvePendingForSession(this.deps, parsed.proposalId);
    if (!resolved.ok || !resolved.proposal) {
      if (expiredForSession) {
        await this.deps.send("The pending proposal expired and was discarded.");
      } else {
        await this.deps.send(resolved.error || "Could not find proposal.");
      }
      pushHistory(this.deps.history, `Proposal apply failed: ${resolved.error || "unknown error"}`);
      return { handled: true };
    }

    const preconditions = this.deps.verifyApplyPreconditions(resolved.proposal);
    if (!preconditions.ok) {
      const msg = preconditions.error || "Cannot apply proposal due to repository state.";
      await this.deps.send(msg);
      this.deps.onProposalApplyFailed?.(resolved.proposal, msg);
      pushHistory(this.deps.history, `Proposal apply blocked: ${msg}`);
      return { handled: true };
    }

    const applied = this.deps.applyPatch(resolved.proposal);
    if (!applied.ok) {
      const msg = applied.error || "Failed to apply proposal patch.";
      await this.deps.send(msg);
      this.deps.onProposalApplyFailed?.(resolved.proposal, msg);
      pushHistory(this.deps.history, `Proposal apply failed: ${msg}`);
      return { handled: true };
    }

    const accepted = this.deps.proposalStore.acceptProposal(this.deps.sessionId, parsed.proposalId, this.deps.now());
    if (!accepted.ok || !accepted.proposal) {
      const msg = accepted.error || "Proposal applied, but internal state did not resolve.";
      await this.deps.send(msg);
      pushHistory(this.deps.history, `Proposal apply state mismatch: ${msg}`);
      return { handled: true };
    }

    this.deps.cleanupProposal(accepted.proposal);
    this.deps.onProposalAccepted?.(accepted.proposal);
    await this.deps.send(
      `[PROPOSAL APPLIED] ${accepted.proposal.id}\n\nProposal applied.\nChanged files: ${accepted.proposal.changedFiles.length}`
    );
    pushHistory(this.deps.history, `Proposal applied: ${accepted.proposal.id}`);
    return { handled: true };
  }
}
