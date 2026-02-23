type EnvMap = Record<string, string | undefined>;

export interface RuntimeConfig {
  openAiModel: string;
  openAiMaxTokens: number;
  maxHistory: number;
  maxSessions: number;
  maxUserInput: number;
  maxCommandLength: number;
  maxOutputBytes: number;
  maxActionsPerTurn: number;
  loggerMaxOut: number;
  loggerMaxCmd: number;
  loggerMaxMsg: number;
  dispatchPollIntervalMs: number;
  dispatchPollTimeoutMs: number;
}

interface NumericOverride {
  name: string;
  defaultValue: number;
  min: number;
}

const NUMERIC_OVERRIDES: NumericOverride[] = [
  { name: "CLANKER_OPENAI_MAX_TOKENS", defaultValue: 1024, min: 1 },
  { name: "CLANKER_MAX_HISTORY", defaultValue: 50, min: 1 },
  { name: "CLANKER_MAX_SESSIONS", defaultValue: 100, min: 1 },
  { name: "CLANKER_MAX_USER_INPUT", defaultValue: 8000, min: 1 },
  { name: "CLANKER_MAX_COMMAND_LENGTH", defaultValue: 10000, min: 1 },
  { name: "CLANKER_MAX_OUTPUT_BYTES", defaultValue: 512 * 1024, min: 1 },
  { name: "CLANKER_MAX_ACTIONS_PER_TURN", defaultValue: 8, min: 1 },
  { name: "CLANKER_LOGGER_MAX_OUT", defaultValue: 500, min: 1 },
  { name: "CLANKER_LOGGER_MAX_CMD", defaultValue: 200, min: 1 },
  { name: "CLANKER_LOGGER_MAX_MSG", defaultValue: 300, min: 1 },
  { name: "CLANKER_DISPATCH_POLL_INTERVAL_MS", defaultValue: 30000, min: 1 },
  { name: "CLANKER_DISPATCH_POLL_TIMEOUT_MS", defaultValue: 1800000, min: 1 },
];

function parsePositiveInteger(
  env: EnvMap,
  override: NumericOverride
): { value: number; error?: string } {
  const raw = env[override.name];
  if (raw === undefined || raw.trim() === "") {
    return { value: override.defaultValue };
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    return {
      value: override.defaultValue,
      error: `${override.name} must be an integer >= ${override.min} (received: "${raw}").`,
    };
  }
  if (parsed < override.min) {
    return {
      value: override.defaultValue,
      error: `${override.name} must be >= ${override.min} (received: ${parsed}).`,
    };
  }

  return { value: parsed };
}

export function validateRuntimeConfigEnv(
  env: EnvMap = process.env as EnvMap
): string[] {
  const errors: string[] = [];

  const modelRaw = env.CLANKER_OPENAI_MODEL;
  if (modelRaw !== undefined && modelRaw.trim() === "") {
    errors.push("CLANKER_OPENAI_MODEL cannot be empty when set.");
  }

  for (const override of NUMERIC_OVERRIDES) {
    const parsed = parsePositiveInteger(env, override);
    if (parsed.error) {
      errors.push(parsed.error);
    }
  }

  return errors;
}

function getRequired(map: Map<string, number>, key: string): number {
  const value = map.get(key);
  if (value === undefined) {
    throw new Error(`Required runtime config key missing: ${key}`);
  }
  return value;
}

export function buildRuntimeConfig(
  env: EnvMap = process.env as EnvMap
): RuntimeConfig {
  const errors = validateRuntimeConfigEnv(env);
  if (errors.length > 0) {
    throw new Error(`Invalid runtime configuration:\n- ${errors.join("\n- ")}`);
  }

  const values = new Map<string, number>();
  for (const override of NUMERIC_OVERRIDES) {
    values.set(override.name, parsePositiveInteger(env, override).value);
  }

  const model = env.CLANKER_OPENAI_MODEL?.trim() || "gpt-4o";

  return {
    openAiModel: model,
    openAiMaxTokens: getRequired(values, "CLANKER_OPENAI_MAX_TOKENS"),
    maxHistory: getRequired(values, "CLANKER_MAX_HISTORY"),
    maxSessions: getRequired(values, "CLANKER_MAX_SESSIONS"),
    maxUserInput: getRequired(values, "CLANKER_MAX_USER_INPUT"),
    maxCommandLength: getRequired(values, "CLANKER_MAX_COMMAND_LENGTH"),
    maxOutputBytes: getRequired(values, "CLANKER_MAX_OUTPUT_BYTES"),
    maxActionsPerTurn: getRequired(values, "CLANKER_MAX_ACTIONS_PER_TURN"),
    loggerMaxOut: getRequired(values, "CLANKER_LOGGER_MAX_OUT"),
    loggerMaxCmd: getRequired(values, "CLANKER_LOGGER_MAX_CMD"),
    loggerMaxMsg: getRequired(values, "CLANKER_LOGGER_MAX_MSG"),
    dispatchPollIntervalMs: getRequired(values, "CLANKER_DISPATCH_POLL_INTERVAL_MS"),
    dispatchPollTimeoutMs: getRequired(values, "CLANKER_DISPATCH_POLL_TIMEOUT_MS"),
  };
}

let cachedRuntimeConfig: RuntimeConfig | null = null;

export function getRuntimeConfig(): RuntimeConfig {
  if (!cachedRuntimeConfig) {
    cachedRuntimeConfig = buildRuntimeConfig();
  }
  return cachedRuntimeConfig;
}
