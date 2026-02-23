import type { DelegateResult } from "./types.js";
import type { PendingProposal } from "./proposals.js";
import { getRuntimeConfig } from "../runtimeConfig.js";
import { truncateText } from "../validators.js";

function iso(ts: number): string {
  return new Date(ts).toISOString();
}

function truncateDiff(diff: string): string {
  const runtimeConfig = getRuntimeConfig();
  const { result, truncated } = truncateText(
    diff,
    runtimeConfig.delegateFileDiffMaxLines,
    runtimeConfig.delegateFileDiffMaxChars
  );
  return truncated ? `${result}\n... [diff truncated]` : result;
}

function formatProposalFileMessage(fileDiff: {
  filePath: string;
  language: string;
  diff: string;
}): string {
  const diffBody = truncateDiff(fileDiff.diff.trim() || "(no textual diff output)");
  return [
    `File: ${fileDiff.filePath}`,
    `Language: ${fileDiff.language}`,
    "```diff",
    diffBody,
    "```",
  ].join("\n");
}

export function formatPendingProposalMessages(proposal: PendingProposal): string[] {
  const filesSummary =
    proposal.changedFiles.length > 0
      ? proposal.changedFiles.join(", ")
      : "No file list available";
  const messages: string[] = [
    [
      `[PENDING PROPOSAL] ${proposal.id}`,
      `Here are the proposed changes to the ${proposal.projectName} project.`,
      `Expires: ${iso(proposal.expiresAt)}`,
      `Changed files (${proposal.changedFiles.length}): ${filesSummary}`,
      proposal.diffStat ? `Diffstat:\n${proposal.diffStat}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
  ];

  if (proposal.fileDiffs.length === 0) {
    messages.push("No per-file diff output is available.");
  } else {
    for (const fileDiff of proposal.fileDiffs) {
      messages.push(formatProposalFileMessage(fileDiff));
    }
  }

  messages.push(`Use accept ${proposal.id} to apply or reject ${proposal.id} to discard.`);
  return messages;
}

export function formatPendingProposalMessage(proposal: PendingProposal): string {
  return formatPendingProposalMessages(proposal).join("\n\n");
}

export function formatDelegateCompletionMessage(result: DelegateResult): string {
  return formatDelegateCompletionMessages(result).join("\n\n");
}

export function formatDelegateCompletionMessages(result: DelegateResult): string[] {
  if (result.proposal) {
    const proposal = result.proposal;
    const fileList = proposal.changedFiles.length > 0 ? proposal.changedFiles.join(", ") : "No files listed";
    const messages: string[] = [
      [
        "Claude has finished the delegated task.",
        `Here are the proposed changes to the ${proposal.projectName} project.`,
        result.summary ? `Summary:\n${result.summary}` : "",
        `[PROPOSAL READY] ${proposal.id}`,
        `Expires: ${iso(proposal.expiresAt)}`,
        `Changed files (${proposal.changedFiles.length}): ${fileList}`,
        proposal.diffStat ? `Diffstat:\n${proposal.diffStat}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    ];

    if (proposal.fileDiffs.length === 0) {
      messages.push("No per-file diff output is available.");
    } else {
      for (const fileDiff of proposal.fileDiffs) {
        messages.push(formatProposalFileMessage(fileDiff));
      }
    }

    messages.push(`Use accept ${proposal.id} to apply or reject ${proposal.id} to discard.`);
    return messages;
  }

  if (result.noChanges) {
    return [[
      "Claude has finished the delegated task.",
      result.summary ? `Summary:\n${result.summary}` : "",
      "No file changes were proposed.",
    ]
      .filter(Boolean)
      .join("\n\n")];
  }

  return [result.summary
    ? `Claude has finished the delegated task:\n\n${result.summary}`
    : "Claude has finished the delegated task."];
}
