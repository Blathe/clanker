import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { JobStatus } from "./stateMachine.js";

export interface JobSummaryInput {
  jobId: string;
  createdAtIso: string;
  status: JobStatus;
  summary: string;
  evidenceLinks: string[];
}

export interface JobSummaryWriteResult {
  filePath: string;
  content: string;
}

export interface FileJobRepositoryOptions {
  rootDir?: string;
  writeTextFile?: (path: string, text: string) => void;
  renamePath?: (from: string, to: string) => void;
  mkdirDir?: (path: string) => void;
}

function monthPathParts(createdAtIso: string): { year: string; month: string } {
  const date = new Date(createdAtIso);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid createdAtIso timestamp: ${createdAtIso}`);
  }

  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return { year, month };
}

function toMarkdown(input: JobSummaryInput): string {
  const lines = [
    `# Job ${input.jobId}`,
    "",
    `Created: ${input.createdAtIso}`,
    `Status: ${input.status}`,
    "",
    "## Summary",
    input.summary,
    "",
    "## Evidence",
  ];

  if (input.evidenceLinks.length === 0) {
    lines.push("- None");
  } else {
    for (const link of input.evidenceLinks) {
      lines.push(`- ${link}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

export class FileJobRepository {
  private readonly rootDir: string;
  private readonly writeTextFile: (path: string, text: string) => void;
  private readonly renamePath: (from: string, to: string) => void;
  private readonly mkdirDir: (path: string) => void;

  constructor(options: FileJobRepositoryOptions = {}) {
    this.rootDir = options.rootDir ?? process.cwd();
    this.writeTextFile = options.writeTextFile ?? ((path, text) => writeFileSync(path, text, "utf8"));
    this.renamePath = options.renamePath ?? ((from, to) => renameSync(from, to));
    this.mkdirDir = options.mkdirDir ?? ((path) => mkdirSync(path, { recursive: true }));
  }

  writeSummary(input: JobSummaryInput): JobSummaryWriteResult {
    const { year, month } = monthPathParts(input.createdAtIso);
    const dirPath = join(this.rootDir, "jobs", year, month);
    const filePath = join(dirPath, `${input.jobId}.md`);
    const content = toMarkdown(input);

    this.mkdirDir(dirPath);
    const tmpPath = `${filePath}.tmp`;
    this.writeTextFile(tmpPath, content);
    this.renamePath(tmpPath, filePath);

    return { filePath, content };
  }
}

