import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";
import type { Channel, SendFn } from "../runtime.js";
import { parseDelegationControlCommand } from "./commandParser.js";
import { formatPendingProposalMessages } from "./messages.js";
import type { PendingProposal, ProposalStore } from "./proposals.js";

export interface ApprovalDeps {
  channel: Channel;
  sessionId: string;
  userInput: string;
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
  deps: ApprovalDeps,
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

function expireStaleForSession(deps: ApprovalDeps): { expiredForSession: boolean } {
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

export async function handleDelegationControlCommand(deps: ApprovalDeps): Promise<ApprovalResult> {
  const parsed = parseDelegationControlCommand(deps.userInput, {
    hasPendingProposal: deps.proposalStore.hasPending(deps.sessionId),
  });
  if (parsed.type === "none") return { handled: false };

  const { expiredForSession } = expireStaleForSession(deps);

  if (parsed.type === "invalid") {
    await deps.send(`[INVALID] ${parsed.error}`);
    pushHistory(deps.history, `Delegation control command rejected: ${parsed.error}`);
    return { handled: true };
  }

  if (parsed.type === "pending") {
    const pending = deps.proposalStore.getProposal(deps.sessionId);
    if (!pending) {
      await deps.send("There is no pending delegated proposal for this session.");
      pushHistory(deps.history, "No pending delegated proposal.");
      return { handled: true };
    }
    for (const msg of formatPendingProposalMessages(pending)) {
      await deps.send(msg);
    }
    pushHistory(deps.history, `Pending proposal shown: ${pending.id}`);
    return { handled: true };
  }

  if (parsed.type === "reject") {
    const resolved = deps.proposalStore.rejectProposal(deps.sessionId, parsed.proposalId);
    if (!resolved.ok || !resolved.proposal) {
      if (expiredForSession) {
        await deps.send("The pending proposal expired and was discarded.");
      } else {
        await deps.send(resolved.error || "Could not reject proposal.");
      }
      pushHistory(deps.history, `Proposal reject failed: ${resolved.error || "unknown error"}`);
      return { handled: true };
    }
    deps.cleanupProposal(resolved.proposal);
    deps.onProposalRejected?.(resolved.proposal);
    await deps.send(`[PROPOSAL REJECTED] ${resolved.proposal.id}\n\nProposal rejected.`);
    pushHistory(deps.history, `Proposal rejected: ${resolved.proposal.id}`);
    return { handled: true };
  }

  if (!canApplyFromChannel(deps.channel, deps.discordUnsafeEnableWrites)) {
    await deps.send(
      "Applying delegated changes is disabled from Discord unless DISCORD_UNSAFE_ENABLE_WRITES=1."
    );
    pushHistory(deps.history, "Proposal apply denied from Discord unsafe mode off.");
    return { handled: true };
  }

  const resolved = resolvePendingForSession(deps, parsed.proposalId);
  if (!resolved.ok || !resolved.proposal) {
    if (expiredForSession) {
      await deps.send("The pending proposal expired and was discarded.");
    } else {
      await deps.send(resolved.error || "Could not find proposal.");
    }
    pushHistory(deps.history, `Proposal apply failed: ${resolved.error || "unknown error"}`);
    return { handled: true };
  }

  const preconditions = deps.verifyApplyPreconditions(resolved.proposal);
  if (!preconditions.ok) {
    const msg = preconditions.error || "Cannot apply proposal due to repository state.";
    await deps.send(msg);
    deps.onProposalApplyFailed?.(resolved.proposal, msg);
    pushHistory(deps.history, `Proposal apply blocked: ${msg}`);
    return { handled: true };
  }

  const applied = deps.applyPatch(resolved.proposal);
  if (!applied.ok) {
    const msg = applied.error || "Failed to apply proposal patch.";
    await deps.send(msg);
    deps.onProposalApplyFailed?.(resolved.proposal, msg);
    pushHistory(deps.history, `Proposal apply failed: ${msg}`);
    return { handled: true };
  }

  const accepted = deps.proposalStore.acceptProposal(deps.sessionId, parsed.proposalId);
  if (!accepted.ok || !accepted.proposal) {
    const msg = accepted.error || "Proposal applied, but internal state did not resolve.";
    await deps.send(msg);
    pushHistory(deps.history, `Proposal apply state mismatch: ${msg}`);
    return { handled: true };
  }

  deps.cleanupProposal(accepted.proposal);
  deps.onProposalAccepted?.(accepted.proposal);
  await deps.send(
    `[PROPOSAL APPLIED] ${accepted.proposal.id}\n\nProposal applied.\nChanged files: ${accepted.proposal.changedFiles.length}`
  );
  pushHistory(deps.history, `Proposal applied: ${accepted.proposal.id}`);
  return { handled: true };
}
