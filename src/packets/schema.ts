import { z } from "zod";

const RiskLevelSchema = z.enum(["R0", "R1", "R2", "R3"]);
const ApprovalAuthoritySchema = z.enum(["none", "owner"]);

const IsoTimestampSchema = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "created_at must be an ISO-8601 timestamp",
  });

const BasePacketSchema = z.object({
  packet_type: z.string().min(1),
  packet_id: z.string().min(1),
  job_id: z.string().min(1),
  created_at: IsoTimestampSchema,
});

export const UserMessagePacketSchema = BasePacketSchema.extend({
  packet_type: z.literal("user_message"),
  channel: z.enum(["repl", "discord", "web"]),
  session_id: z.string().min(1),
  message: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const JobSpecPacketSchema = BasePacketSchema.extend({
  packet_type: z.literal("job_spec"),
  intent: z.string().min(1),
  constraints: z
    .object({
      allowed_tools: z.array(z.string().min(1)).default([]),
      allowed_domains: z.array(z.string().min(1)).default([]),
      max_files_changed: z.number().int().positive().optional(),
      max_prs: z.number().int().positive().optional(),
    })
    .strict(),
  outputs: z
    .object({
      pr_required: z.boolean(),
      evidence_required: z.array(z.string().min(1)).default([]),
    })
    .strict(),
});

export const PlanPacketSchema = BasePacketSchema.extend({
  packet_type: z.literal("plan"),
  steps: z
    .array(
      z
        .object({
          id: z.string().min(1),
          description: z.string().min(1),
          evidence_required: z.array(z.string().min(1)).default([]),
        })
        .strict()
    )
    .min(1),
});

export const ToolCallPacketSchema = BasePacketSchema.extend({
  packet_type: z.literal("tool_call"),
  tool: z.string().min(1),
  args: z.array(z.string()).default([]),
  expected_outputs: z.array(z.string().min(1)).default([]),
  working_dir: z.string().min(1).optional(),
});

export const ToolResultPacketSchema = BasePacketSchema.extend({
  packet_type: z.literal("tool_result"),
  tool: z.string().min(1),
  exit_code: z.number().int(),
  stdout: z.string(),
  stderr: z.string(),
  artifacts: z
    .array(
      z
        .object({
          path: z.string().min(1),
          sha256: z.string().regex(/^[A-Fa-f0-9]{64}$/),
        })
        .strict()
    )
    .default([]),
});

export const PolicyDecisionPacketSchema = BasePacketSchema.extend({
  packet_type: z.literal("policy_decision"),
  allowed: z.boolean(),
  risk_level: RiskLevelSchema,
  requires_approval: z.boolean(),
  approval_authority: ApprovalAuthoritySchema,
  reasons: z.array(z.string().min(1)).min(1),
});

export const ChangeProposalPacketSchema = BasePacketSchema.extend({
  packet_type: z.literal("change_proposal"),
  touched_files: z.array(z.string().min(1)).min(1),
  summary: z.string().min(1),
  risk_delta: z
    .object({
      from: RiskLevelSchema,
      to: RiskLevelSchema,
    })
    .strict(),
  pr_required: z.boolean(),
});

export const PacketSchema = z.discriminatedUnion("packet_type", [
  UserMessagePacketSchema,
  JobSpecPacketSchema,
  PlanPacketSchema,
  ToolCallPacketSchema,
  ToolResultPacketSchema,
  PolicyDecisionPacketSchema,
  ChangeProposalPacketSchema,
]);

