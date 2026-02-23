import { z } from "zod";
import {
  ChangeProposalPacketSchema,
  JobSpecPacketSchema,
  PacketSchema,
  PlanPacketSchema,
  PolicyDecisionPacketSchema,
  ToolCallPacketSchema,
  ToolResultPacketSchema,
  UserMessagePacketSchema,
} from "../../../src/packets/schema.js";

function makeBase(packetType: string) {
  return {
    packet_type: packetType,
    packet_id: "pkt_123",
    job_id: "job_123",
    created_at: "2026-02-23T12:00:00Z",
  };
}

describe("packet schema validation", () => {
  test("validates UserMessagePacket", () => {
    const parsed = UserMessagePacketSchema.parse({
      ...makeBase("user_message"),
      channel: "discord",
      session_id: "sess_1",
      message: "scan this repo",
    });
    expect(parsed.packet_type).toBe("user_message");
  });

  test("validates JobSpecPacket", () => {
    const parsed = JobSpecPacketSchema.parse({
      ...makeBase("job_spec"),
      intent: "REPO_VULN_FIX_FIRST",
      constraints: {
        allowed_tools: ["git", "rg"],
        allowed_domains: ["github.com"],
        max_files_changed: 25,
      },
      outputs: {
        pr_required: true,
        evidence_required: ["scan_report"],
      },
    });
    expect(parsed.intent).toBe("REPO_VULN_FIX_FIRST");
  });

  test("validates PlanPacket", () => {
    const parsed = PlanPacketSchema.parse({
      ...makeBase("plan"),
      steps: [
        {
          id: "step_1",
          description: "Run vulnerability scanner",
          evidence_required: ["scan_report"],
        },
      ],
    });
    expect(parsed.steps).toHaveLength(1);
  });

  test("validates ToolCallPacket", () => {
    const parsed = ToolCallPacketSchema.parse({
      ...makeBase("tool_call"),
      tool: "npm",
      args: ["test"],
      expected_outputs: ["tests_passed"],
    });
    expect(parsed.tool).toBe("npm");
  });

  test("validates ToolResultPacket", () => {
    const parsed = ToolResultPacketSchema.parse({
      ...makeBase("tool_result"),
      tool: "npm",
      exit_code: 0,
      stdout: "ok",
      stderr: "",
      artifacts: [{ path: "reports/out.txt", sha256: "a".repeat(64) }],
    });
    expect(parsed.exit_code).toBe(0);
  });

  test("validates PolicyDecisionPacket", () => {
    const parsed = PolicyDecisionPacketSchema.parse({
      ...makeBase("policy_decision"),
      allowed: false,
      risk_level: "R3",
      requires_approval: true,
      approval_authority: "owner",
      reasons: ["Touches /.github/workflows"],
    });
    expect(parsed.risk_level).toBe("R3");
  });

  test("validates ChangeProposalPacket", () => {
    const parsed = ChangeProposalPacketSchema.parse({
      ...makeBase("change_proposal"),
      touched_files: ["src/main.ts"],
      summary: "Tighten policy checks",
      risk_delta: { from: "R1", to: "R2" },
      pr_required: true,
    });
    expect(parsed.pr_required).toBe(true);
  });

  test("union schema accepts each packet type", () => {
    const packets = [
      {
        ...makeBase("user_message"),
        channel: "repl",
        session_id: "sess_a",
        message: "hello",
      },
      {
        ...makeBase("policy_decision"),
        allowed: true,
        risk_level: "R0",
        requires_approval: false,
        approval_authority: "none",
        reasons: ["Read-only action"],
      },
    ];

    for (const pkt of packets) {
      const parsed = PacketSchema.parse(pkt);
      expect(parsed.packet_id).toBe("pkt_123");
    }
  });

  test("rejects malformed created_at", () => {
    expect(() =>
      UserMessagePacketSchema.parse({
        ...makeBase("user_message"),
        created_at: "not-a-date",
        channel: "discord",
        session_id: "sess_1",
        message: "hello",
      })
    ).toThrow(z.ZodError);
  });

  test("rejects invalid risk level", () => {
    expect(() =>
      PolicyDecisionPacketSchema.parse({
        ...makeBase("policy_decision"),
        allowed: true,
        risk_level: "R9",
        requires_approval: false,
        approval_authority: "none",
        reasons: ["invalid"],
      })
    ).toThrow(z.ZodError);
  });
});
