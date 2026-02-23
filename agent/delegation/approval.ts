import { parseDelegationControlCommand } from "./commandParser.js";
import {
  DelegationApprovalService,
  type ApprovalResult,
  type ApprovalServiceDeps,
} from "./approvalService.js";

export type ApprovalDeps = ApprovalServiceDeps & {
  userInput: string;
};

export type { ApprovalResult };

export async function handleDelegationControlCommand(deps: ApprovalDeps): Promise<ApprovalResult> {
  const parsed = parseDelegationControlCommand(deps.userInput, {
    hasPendingProposal: deps.proposalStore.hasPending(deps.sessionId),
  });

  const service = new DelegationApprovalService(deps);
  return service.handle(parsed);
}
