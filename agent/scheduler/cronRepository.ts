import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

const IsoTimestampSchema = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "must be an ISO-8601 timestamp",
  });

export const CronJobSpecSchema = z
  .object({
    intent: z.string().min(1),
    inputs: z.record(z.string(), z.unknown()),
    constraints: z
      .object({
        allowed_domains: z.array(z.string().min(1)).default([]),
        max_prs: z.number().int().positive().optional(),
      })
      .strict(),
  })
  .strict();

export const CronLastRunSchema = z
  .object({
    at: IsoTimestampSchema,
    status: z.string().min(1),
  })
  .strict();

export const CronJobEntrySchema = z
  .object({
    job_id: z.string().min(1),
    enabled: z.boolean(),
    timezone: z.string().min(1),
    schedule_cron: z.string().min(1),
    cron_summary: z.string().min(1),
    cron_notes: z.string().nullable(),
    next_runs_utc: z.array(IsoTimestampSchema),
    next_runs_local: z.array(z.string().min(1)),
    job_spec: CronJobSpecSchema,
    last_run: CronLastRunSchema.optional(),
  })
  .strict();

export const CronRegistrySchema = z
  .object({
    version: z.literal(1),
    updated_at: IsoTimestampSchema,
    jobs: z.array(CronJobEntrySchema),
  })
  .strict();

export type CronJobEntry = z.infer<typeof CronJobEntrySchema>;
export type CronRegistry = z.infer<typeof CronRegistrySchema>;

export interface FileCronRepositoryOptions {
  filePath?: string;
  readTextFile?: (path: string) => string;
  writeTextFile?: (path: string, text: string) => void;
  renamePath?: (from: string, to: string) => void;
  mkdirDir?: (path: string) => void;
  pathExists?: (path: string) => boolean;
  nowIso?: () => string;
}

export class FileCronRepository {
  private readonly filePath: string;
  private readonly readTextFile: (path: string) => string;
  private readonly writeTextFile: (path: string, text: string) => void;
  private readonly renamePath: (from: string, to: string) => void;
  private readonly mkdirDir: (path: string) => void;
  private readonly pathExists: (path: string) => boolean;
  private readonly nowIso: () => string;
  private registry: CronRegistry;

  constructor(options: FileCronRepositoryOptions = {}) {
    this.filePath = options.filePath ?? join(process.cwd(), "cron", "jobs.json");
    this.readTextFile = options.readTextFile ?? ((path) => readFileSync(path, "utf8"));
    this.writeTextFile = options.writeTextFile ?? ((path, text) => writeFileSync(path, text, "utf8"));
    this.renamePath = options.renamePath ?? ((from, to) => renameSync(from, to));
    this.mkdirDir = options.mkdirDir ?? ((path) => mkdirSync(path, { recursive: true }));
    this.pathExists = options.pathExists ?? ((path) => existsSync(path));
    this.nowIso = options.nowIso ?? (() => new Date().toISOString());
    this.registry = this.load();
  }

  listJobs(): CronJobEntry[] {
    return [...this.registry.jobs];
  }

  getJob(jobId: string): CronJobEntry | null {
    return this.registry.jobs.find((entry) => entry.job_id === jobId) ?? null;
  }

  upsertJob(entry: CronJobEntry): CronJobEntry {
    const parsed = CronJobEntrySchema.parse(entry);
    const index = this.registry.jobs.findIndex((job) => job.job_id === parsed.job_id);

    if (index >= 0) {
      this.registry.jobs[index] = parsed;
    } else {
      this.registry.jobs.push(parsed);
    }
    this.registry.updated_at = this.nowIso();
    this.persist();
    return parsed;
  }

  deleteJob(jobId: string): void {
    const before = this.registry.jobs.length;
    this.registry.jobs = this.registry.jobs.filter((entry) => entry.job_id !== jobId);
    if (this.registry.jobs.length !== before) {
      this.registry.updated_at = this.nowIso();
      this.persist();
    }
  }

  private load(): CronRegistry {
    if (!this.pathExists(this.filePath)) {
      return {
        version: 1,
        updated_at: this.nowIso(),
        jobs: [],
      };
    }

    const raw = this.readTextFile(this.filePath);
    const parsed = JSON.parse(raw);
    return CronRegistrySchema.parse(parsed);
  }

  private persist(): void {
    this.mkdirDir(dirname(this.filePath));
    const tmpPath = `${this.filePath}.tmp`;
    const text = JSON.stringify(this.registry, null, 2);
    this.writeTextFile(tmpPath, text);
    this.renamePath(tmpPath, this.filePath);
  }
}

