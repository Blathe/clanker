import {
  parseDelegationControlCommand,
  type DelegationControlCommand,
} from "../../../src/delegation/commandParser.js";

describe("parseDelegationControlCommand", () => {
  test("parses /accept without id", () => {
    const parsed = parseDelegationControlCommand("/accept");
    expect(parsed).toEqual({ type: "accept" });
  });

  test("parses /accept with id", () => {
    const parsed = parseDelegationControlCommand("/accept p-123");
    expect(parsed).toEqual({ type: "accept", proposalId: "p-123" });
  });

  test("parses /reject without id", () => {
    const parsed = parseDelegationControlCommand("/reject");
    expect(parsed).toEqual({ type: "reject" });
  });

  test("parses /reject with id", () => {
    const parsed = parseDelegationControlCommand("/reject p-123");
    expect(parsed).toEqual({ type: "reject", proposalId: "p-123" });
  });

  test("parses /pending", () => {
    const parsed = parseDelegationControlCommand("/pending");
    expect(parsed).toEqual({ type: "pending" });
  });

  test("returns invalid for extra args on /pending", () => {
    const parsed = parseDelegationControlCommand("/pending x");
    expect(parsed.type).toBe("invalid");
    if (parsed.type === "invalid") {
      expect(parsed.error).toContain("/pending");
    }
  });

  test("returns invalid for extra args on /accept", () => {
    const parsed = parseDelegationControlCommand("/accept a b");
    expect(parsed.type).toBe("invalid");
    if (parsed.type === "invalid") {
      expect(parsed.error).toContain("/accept");
    }
  });

  test("returns invalid for extra args on /reject", () => {
    const parsed = parseDelegationControlCommand("/reject a b");
    expect(parsed.type).toBe("invalid");
    if (parsed.type === "invalid") {
      expect(parsed.error).toContain("/reject");
    }
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
    const parsed: DelegationControlCommand = parseDelegationControlCommand("  /accept   p-1  ");
    expect(parsed).toEqual({ type: "accept", proposalId: "p-1" });
  });
});
