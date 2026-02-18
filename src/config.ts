export function getEnv(name: string): string | undefined {
  const value = process.env[name];
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function parseCsvList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function parseCsvEnvSet(name: string): Set<string> {
  return new Set(parseCsvList(getEnv(name)));
}

export function isDiscordSnowflake(value: string): boolean {
  return /^[0-9]{17,20}$/.test(value);
}

export function parseDiscordIdCsv(name: string): { values: string[]; invalid: string[] } {
  const values = parseCsvList(getEnv(name));
  const invalid = values.filter((value) => !isDiscordSnowflake(value));
  return { values, invalid };
}

export function parseBoolFlag(name: string): { enabled: boolean; valid: boolean } {
  const raw = getEnv(name);
  if (!raw) return { enabled: false, valid: true };
  if (/^(1|true|yes|on)$/i.test(raw)) return { enabled: true, valid: true };
  if (/^(0|false|no|off)$/i.test(raw)) return { enabled: false, valid: true };
  return { enabled: false, valid: false };
}

export function envFlagEnabled(name: string): boolean {
  return parseBoolFlag(name).enabled;
}

export interface TransportConfig {
  repl: boolean;
  discord: boolean;
}

export interface ParsedTransports extends TransportConfig {
  invalid: string[];
}

export function parseTransportsDetailed(name: string): ParsedTransports {
  const raw = getEnv(name);
  if (!raw) return { repl: true, discord: true, invalid: [] };

  const entries = raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const values = new Set(entries);
  const invalid = entries.filter((value) => value !== "repl" && value !== "discord");

  return {
    repl: values.has("repl"),
    discord: values.has("discord"),
    invalid,
  };
}

export function parseTransports(name: string): TransportConfig {
  const parsed = parseTransportsDetailed(name);
  return { repl: parsed.repl, discord: parsed.discord };
}
