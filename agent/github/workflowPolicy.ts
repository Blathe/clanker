export type WorkflowStepKind =
  | "untrusted_analysis"
  | "broker_network"
  | "pr_write"
  | "deploy";

export interface StepSecretPolicy {
  step: WorkflowStepKind;
  allowSecrets: boolean;
  allowRepoWrite: boolean;
}

export interface ValidateStepSecretAccessInput {
  step: WorkflowStepKind;
  requestedSecrets: string[];
  requestedRepoWrite: boolean;
}

export type ValidateStepSecretAccessResult =
  | { ok: true }
  | { ok: false; error: string };

const STEP_POLICIES: Record<WorkflowStepKind, StepSecretPolicy> = {
  untrusted_analysis: {
    step: "untrusted_analysis",
    allowSecrets: false,
    allowRepoWrite: false,
  },
  broker_network: {
    step: "broker_network",
    allowSecrets: true,
    allowRepoWrite: false,
  },
  pr_write: {
    step: "pr_write",
    allowSecrets: true,
    allowRepoWrite: true,
  },
  deploy: {
    step: "deploy",
    allowSecrets: true,
    allowRepoWrite: true,
  },
};

export function getStepSecretPolicy(step: WorkflowStepKind): StepSecretPolicy {
  return STEP_POLICIES[step];
}

export function validateStepSecretAccess(
  input: ValidateStepSecretAccessInput
): ValidateStepSecretAccessResult {
  const policy = getStepSecretPolicy(input.step);
  const requestedSecretCount = input.requestedSecrets.length;

  if (!policy.allowSecrets && requestedSecretCount > 0) {
    return {
      ok: false,
      error: `Step ${input.step} is untrusted and must not receive secrets`,
    };
  }

  if (!policy.allowRepoWrite && input.requestedRepoWrite) {
    return {
      ok: false,
      error: `Step ${input.step} is not permitted to request repository write access`,
    };
  }

  return { ok: true };
}

