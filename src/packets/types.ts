import type { z } from "zod";
import {
  ChangeProposalPacketSchema,
  JobSpecPacketSchema,
  PacketSchema,
  PlanPacketSchema,
  PolicyDecisionPacketSchema,
  ToolCallPacketSchema,
  ToolResultPacketSchema,
  UserMessagePacketSchema,
} from "./schema.js";

export type UserMessagePacket = z.infer<typeof UserMessagePacketSchema>;
export type JobSpecPacket = z.infer<typeof JobSpecPacketSchema>;
export type PlanPacket = z.infer<typeof PlanPacketSchema>;
export type ToolCallPacket = z.infer<typeof ToolCallPacketSchema>;
export type ToolResultPacket = z.infer<typeof ToolResultPacketSchema>;
export type PolicyDecisionPacket = z.infer<typeof PolicyDecisionPacketSchema>;
export type ChangeProposalPacket = z.infer<typeof ChangeProposalPacketSchema>;
export type Packet = z.infer<typeof PacketSchema>;

