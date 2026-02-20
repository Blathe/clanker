import type { DelegateResult } from "./types.js";
import type { PendingProposal } from "./proposals.js";

function iso(ts: number): string {
  return new Date(ts).toISOString();
}

export function formatPendingProposalMessage(proposal: PendingProposal): string {
  const filesSummary =
    proposal.changedFiles.length > 0
      ? proposal.changedFiles.join(", ")
      : "No file list available";
  return [
    `[PENDING PROPOSAL] ${proposal.id}`,
    `Expires: ${iso(proposal.expiresAt)}`,
    `Changed files (${proposal.changedFiles.length}): ${filesSummary}`,
    proposal.diffStat ? `Diffstat:\n${proposal.diffStat}` : "",
    proposal.diffPreview ? `Diff preview:\n${proposal.diffPreview}` : "",
    `Use /accept ${proposal.id} to apply or /reject ${proposal.id} to discard.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function formatDelegateCompletionMessage(result: DelegateResult): string {
  if (result.proposal) {
    const proposal = result.proposal;
    const fileList = proposal.changedFiles.length > 0 ? proposal.changedFiles.join(", ") : "No files listed";
    return [
      "Claude has finished the delegated task.",
      result.summary ? `Summary:\n${result.summary}` : "",
      `[PROPOSAL READY] ${proposal.id}`,
      `Expires: ${iso(proposal.expiresAt)}`,
      `Changed files (${proposal.changedFiles.length}): ${fileList}`,
      proposal.diffStat ? `Diffstat:\n${proposal.diffStat}` : "",
      proposal.diffPreview ? `Diff preview:\n${proposal.diffPreview}` : "",
      `Use /accept ${proposal.id} to apply or /reject ${proposal.id} to discard.`,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  if (result.noChanges) {
    return [
      "Claude has finished the delegated task.",
      result.summary ? `Summary:\n${result.summary}` : "",
      "No file changes were proposed.",
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  return result.summary
    ? `Claude has finished the delegated task:\n\n${result.summary}`
    : "Claude has finished the delegated task.";
}
