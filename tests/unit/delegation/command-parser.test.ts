import {
  parseDelegationControlCommand,
  type DelegationControlCommand,
} from "../../../agent/delegation/commandParser.js";

describe("parseDelegationControlCommand", () => {
  test("parses conversational accept with pending proposal context", () => {
    const parsed = parseDelegationControlCommand("please accept this one", {
      hasPendingProposal: true,
    });
    expect(parsed).toEqual({ type: "accept" });
  });

  test("parses conversational accept with proposal id", () => {
    const parsed = parseDelegationControlCommand("yes, accept proposal p-123");
    expect(parsed).toEqual({ type: "accept", proposalId: "p-123" });
  });

  test("parses conversational reject with pending proposal context", () => {
    const parsed = parseDelegationControlCommand("I want to reject this", {
      hasPendingProposal: true,
    });
    expect(parsed).toEqual({ type: "reject" });
  });

  test("parses conversational reject with proposal id", () => {
    const parsed = parseDelegationControlCommand("reject proposal p-123");
    expect(parsed).toEqual({ type: "reject", proposalId: "p-123" });
  });

  test("parses conversational pending request", () => {
    const parsed = parseDelegationControlCommand("can you show pending changes?");
    expect(parsed).toEqual({ type: "pending" });
  });

  test("returns none for accept when no pending proposal and no id", () => {
    const parsed = parseDelegationControlCommand("accept this");
    expect(parsed).toEqual({ type: "none" });
  });

  test("returns invalid when both accept and reject appear", () => {
    const parsed = parseDelegationControlCommand("accept or reject, not sure", {
      hasPendingProposal: true,
    });
    expect(parsed.type).toBe("invalid");
    if (parsed.type === "invalid") {
      expect(parsed.error).toContain("ambiguous");
    }
  });

  test("returns invalid for slash forms with migration guidance", () => {
    const parsed = parseDelegationControlCommand("/accept p-1", {
      hasPendingProposal: true,
    });
    expect(parsed.type).toBe("invalid");
    if (parsed.type === "invalid") {
      expect(parsed.error).toContain("no longer supported");
      expect(parsed.error).toContain("accept");
      expect(parsed.error).toContain("reject");
      expect(parsed.error).toContain("pending");
    }
  });

  test("extracts proposal id case-insensitively from natural text", () => {
    const parsed = parseDelegationControlCommand("please ACCEPT proposal P-ABC-123");
    expect(parsed).toEqual({ type: "accept", proposalId: "p-abc-123" });
  });

  test("returns none for non-control input", () => {
    const parsed = parseDelegationControlCommand("list files");
    expect(parsed).toEqual({ type: "none" });
  });

  test("returns none for unknown slash command", () => {
    const parsed = parseDelegationControlCommand("/help");
    expect(parsed).toEqual({ type: "none" });
  });

  test("treats whitespace robustly", () => {
    const parsed: DelegationControlCommand = parseDelegationControlCommand("  accept   p-1  ");
    expect(parsed).toEqual({ type: "accept", proposalId: "p-1" });
  });
});
