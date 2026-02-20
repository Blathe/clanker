export type DelegationControlCommand =
  | { type: "none" }
  | { type: "invalid"; error: string }
  | { type: "accept"; proposalId?: string }
  | { type: "reject"; proposalId?: string }
  | { type: "pending" };

export interface DelegationControlParseOptions {
  hasPendingProposal?: boolean;
}

function normalizeInput(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, " ");
}

function extractProposalId(normalizedInput: string): string | undefined {
  const match = normalizedInput.match(/\bp-[a-z0-9-]+\b/i);
  return match ? match[0].toLowerCase() : undefined;
}

export function parseDelegationControlCommand(
  input: string,
  options: DelegationControlParseOptions = {}
): DelegationControlCommand {
  const normalizedInput = normalizeInput(input);
  if (!normalizedInput) return { type: "none" };

  if (/(?:^|\s)\/(?:accept|reject|pending)\b/i.test(normalizedInput)) {
    return {
      type: "invalid",
      error: "Slash delegation commands are no longer supported. Use accept, reject, or pending.",
    };
  }

  const hasAccept = /\baccept\b/.test(normalizedInput);
  const hasReject = /\breject\b/.test(normalizedInput);
  const hasPending = /\bpending\b/.test(normalizedInput);
  const proposalId = extractProposalId(normalizedInput);
  const hasPendingProposal = options.hasPendingProposal ?? false;

  if (hasAccept && hasReject) {
    return {
      type: "invalid",
      error: "Delegation control intent is ambiguous: both accept and reject were found.",
    };
  }

  if (hasAccept) {
    if (!hasPendingProposal && !proposalId) {
      return { type: "none" };
    }
    return proposalId ? { type: "accept", proposalId } : { type: "accept" };
  }

  if (hasReject) {
    if (!hasPendingProposal && !proposalId) {
      return { type: "none" };
    }
    return proposalId ? { type: "reject", proposalId } : { type: "reject" };
  }

  if (hasPending) {
    return { type: "pending" };
  }

  return { type: "none" };
}
