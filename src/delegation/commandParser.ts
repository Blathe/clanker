export type DelegationControlCommand =
  | { type: "none" }
  | { type: "invalid"; error: string }
  | { type: "accept"; proposalId?: string }
  | { type: "reject"; proposalId?: string }
  | { type: "pending" };

function parseSingleOptionalArgCommand(
  raw: string,
  command: "/accept" | "/reject"
): DelegationControlCommand {
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return { type: command.slice(1) as "accept" | "reject" };
  if (parts.length === 2) {
    return { type: command.slice(1) as "accept" | "reject", proposalId: parts[1] };
  }
  return {
    type: "invalid",
    error: `Usage: ${command} or ${command} <proposalId>`,
  };
}

export function parseDelegationControlCommand(input: string): DelegationControlCommand {
  const raw = input.trim();
  if (!raw.startsWith("/")) return { type: "none" };
  if (raw === "/pending") return { type: "pending" };
  if (raw.startsWith("/pending ")) {
    return { type: "invalid", error: "Usage: /pending" };
  }
  if (raw === "/accept" || raw.startsWith("/accept ")) {
    return parseSingleOptionalArgCommand(raw, "/accept");
  }
  if (raw === "/reject" || raw.startsWith("/reject ")) {
    return parseSingleOptionalArgCommand(raw, "/reject");
  }
  return { type: "none" };
}
