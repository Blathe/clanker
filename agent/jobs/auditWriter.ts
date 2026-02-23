import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DIRS } from "../paths.js";

export interface AuditEventInput {
  jobId: string;
  atIso: string;
  eventType: string;
  payload: Record<string, unknown>;
}

export interface AuditAppendResult {
  filePath: string;
  line: string;
}

export interface AuditWriterOptions {
  rootDir?: string;
  mkdirDir?: (path: string) => void;
  appendTextFile?: (path: string, text: string) => void;
}

function monthPathParts(atIso: string): { year: string; month: string; unixSeconds: number } {
  const date = new Date(atIso);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid atIso timestamp: ${atIso}`);
  }

  return {
    year: String(date.getUTCFullYear()),
    month: String(date.getUTCMonth() + 1).padStart(2, "0"),
    unixSeconds: Math.floor(date.getTime() / 1000),
  };
}

export class AuditWriter {
  private readonly rootDir: string;
  private readonly mkdirDir: (path: string) => void;
  private readonly appendTextFile: (path: string, text: string) => void;

  constructor(options: AuditWriterOptions = {}) {
    this.rootDir = options.rootDir ?? process.cwd();
    this.mkdirDir = options.mkdirDir ?? ((path) => mkdirSync(path, { recursive: true }));
    this.appendTextFile = options.appendTextFile ?? ((path, text) => appendFileSync(path, text, "utf8"));
  }

  appendEvent(input: AuditEventInput): AuditAppendResult {
    const { year, month, unixSeconds } = monthPathParts(input.atIso);
    const dirPath = join(this.rootDir, DIRS.audit, year, month);
    const filePath = join(dirPath, `${input.jobId}.jsonl`);

    this.mkdirDir(dirPath);

    const lineObj = {
      t: unixSeconds,
      at: input.atIso,
      ev: input.eventType,
      job_id: input.jobId,
      ...input.payload,
    };
    const line = `${JSON.stringify(lineObj)}\n`;
    this.appendTextFile(filePath, line);

    return { filePath, line };
  }
}

