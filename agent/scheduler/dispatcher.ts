export interface DispatcherJob {
  job_id: string;
  enabled: boolean;
  timezone: string;
  schedule_cron: string;
}

export interface DueRunInstance {
  job_id: string;
  scheduled_at_utc: string;
  run_instance_id: string;
}

export interface ComputeDueRunsInput {
  jobs: DispatcherJob[];
  windowStartUtc: string;
  windowEndUtc: string;
}

interface CronField {
  any: boolean;
  values: Set<number>;
}

interface ParsedCron {
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
}

interface ZonedParts {
  minute: number;
  hour: number;
  dayOfMonth: number;
  month: number;
  dayOfWeek: number;
}

const WEEKDAY_TO_NUM: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function normalizeMinute(date: Date): Date {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    0,
    0
  ));
}

function parseNumber(raw: string, min: number, max: number, fieldName: string): number {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`Invalid ${fieldName} value: ${raw}`);
  }
  return parsed;
}

function addRange(target: Set<number>, start: number, end: number, step: number): void {
  for (let value = start; value <= end; value += step) {
    target.add(value);
  }
}

function parseField(source: string, min: number, max: number, fieldName: string, allowSunday7 = false): CronField {
  const trimmed = source.trim();
  if (trimmed === "*") {
    return { any: true, values: new Set<number>() };
  }

  const values = new Set<number>();
  const parts = trimmed.split(",");
  for (const part of parts) {
    const token = part.trim();
    if (!token) {
      throw new Error(`Invalid ${fieldName} token: empty`);
    }

    const [base, stepRaw] = token.split("/");
    const step = stepRaw ? parseNumber(stepRaw, 1, max - min + 1, `${fieldName} step`) : 1;

    if (base === "*") {
      addRange(values, min, max, step);
      continue;
    }

    if (base.includes("-")) {
      const [startRaw, endRaw] = base.split("-");
      const start = parseNumber(startRaw, min, max, fieldName);
      const end = parseNumber(endRaw, min, max, fieldName);
      if (start > end) {
        throw new Error(`Invalid ${fieldName} range: ${base}`);
      }
      addRange(values, start, end, step);
      continue;
    }

    const single = parseNumber(base, min, max, fieldName);
    if (allowSunday7 && single === 7) {
      values.add(0);
    } else {
      values.add(single);
    }
  }

  return { any: false, values };
}

function parseCronExpression(cron: string): ParsedCron {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`Invalid cron expression (expected 5 fields): ${cron}`);
  }

  return {
    minute: parseField(fields[0], 0, 59, "minute"),
    hour: parseField(fields[1], 0, 23, "hour"),
    dayOfMonth: parseField(fields[2], 1, 31, "day-of-month"),
    month: parseField(fields[3], 1, 12, "month"),
    dayOfWeek: parseField(fields[4], 0, 7, "day-of-week", true),
  };
}

function fieldMatches(field: CronField, value: number): boolean {
  return field.any || field.values.has(value);
}

function getZonedParts(date: Date, timezone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(date);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  const weekdayRaw = byType.get("weekday");
  if (!weekdayRaw || WEEKDAY_TO_NUM[weekdayRaw] === undefined) {
    throw new Error(`Could not parse weekday for timezone ${timezone}`);
  }

  return {
    minute: parseNumber(byType.get("minute") || "", 0, 59, "minute"),
    hour: parseNumber(byType.get("hour") || "", 0, 23, "hour"),
    dayOfMonth: parseNumber(byType.get("day") || "", 1, 31, "day"),
    month: parseNumber(byType.get("month") || "", 1, 12, "month"),
    dayOfWeek: WEEKDAY_TO_NUM[weekdayRaw],
  };
}

function cronMatches(parsed: ParsedCron, zoned: ZonedParts): boolean {
  const minuteOk = fieldMatches(parsed.minute, zoned.minute);
  const hourOk = fieldMatches(parsed.hour, zoned.hour);
  const monthOk = fieldMatches(parsed.month, zoned.month);

  const domOk = fieldMatches(parsed.dayOfMonth, zoned.dayOfMonth);
  const dowOk = fieldMatches(parsed.dayOfWeek, zoned.dayOfWeek);

  const domRestricted = !parsed.dayOfMonth.any;
  const dowRestricted = !parsed.dayOfWeek.any;
  const dayOk = domRestricted && dowRestricted ? domOk || dowOk : domOk && dowOk;

  return minuteOk && hourOk && monthOk && dayOk;
}

function dateRangeByMinute(startUtc: Date, endUtc: Date): Date[] {
  const normalizedStart = normalizeMinute(startUtc);
  const normalizedEnd = normalizeMinute(endUtc);
  const result: Date[] = [];
  for (let t = normalizedStart.getTime(); t <= normalizedEnd.getTime(); t += 60_000) {
    result.push(new Date(t));
  }
  return result;
}

export function buildRunInstanceId(jobId: string, scheduledAtUtc: string): string {
  return `${jobId}:${scheduledAtUtc}`;
}

export function dedupeRunInstances(
  due: DueRunInstance[],
  existingRunInstanceIds: Set<string>
): DueRunInstance[] {
  const seen = new Set(existingRunInstanceIds);
  const filtered: DueRunInstance[] = [];

  for (const item of due) {
    if (seen.has(item.run_instance_id)) {
      continue;
    }
    seen.add(item.run_instance_id);
    filtered.push(item);
  }

  return filtered;
}

export function computeDueRunInstances(input: ComputeDueRunsInput): DueRunInstance[] {
  const start = new Date(input.windowStartUtc);
  const end = new Date(input.windowEndUtc);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("windowStartUtc and windowEndUtc must be valid ISO timestamps");
  }
  if (start.getTime() > end.getTime()) {
    throw new Error("windowStartUtc must be <= windowEndUtc");
  }

  const compiledJobs = input.jobs
    .filter((job) => job.enabled)
    .map((job) => ({ job, parsedCron: parseCronExpression(job.schedule_cron) }));

  const due: DueRunInstance[] = [];
  const times = dateRangeByMinute(start, end);

  for (const time of times) {
    const scheduledAtUtc = time.toISOString().replace(".000", "");

    for (const entry of compiledJobs) {
      const zoned = getZonedParts(time, entry.job.timezone);
      if (!cronMatches(entry.parsedCron, zoned)) {
        continue;
      }
      due.push({
        job_id: entry.job.job_id,
        scheduled_at_utc: scheduledAtUtc,
        run_instance_id: buildRunInstanceId(entry.job.job_id, scheduledAtUtc),
      });
    }
  }

  return dedupeRunInstances(due, new Set());
}

