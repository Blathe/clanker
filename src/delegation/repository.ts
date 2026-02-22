import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { PendingProposal } from "./proposals.js";
import type { DelegationState } from "./stateMachine.js";

export interface StoredProposalRecord {
  proposal: PendingProposal;
  state: DelegationState;
}

export interface ProposalRepository {
  get(sessionId: string): StoredProposalRecord | null;
  has(sessionId: string): boolean;
  list(sessionId?: string): StoredProposalRecord[];
  set(record: StoredProposalRecord): void;
  delete(sessionId: string): void;
}

export class InMemoryProposalRepository implements ProposalRepository {
  private readonly bySession = new Map<string, StoredProposalRecord>();

  get(sessionId: string): StoredProposalRecord | null {
    return this.bySession.get(sessionId) ?? null;
  }

  has(sessionId: string): boolean {
    return this.bySession.has(sessionId);
  }

  list(sessionId?: string): StoredProposalRecord[] {
    if (sessionId) {
      const record = this.bySession.get(sessionId);
      return record ? [record] : [];
    }
    return [...this.bySession.values()];
  }

  set(record: StoredProposalRecord): void {
    this.bySession.set(record.proposal.sessionId, record);
  }

  delete(sessionId: string): void {
    this.bySession.delete(sessionId);
  }
}

interface FileRepositoryPayload {
  version: 1;
  records: StoredProposalRecord[];
}

export interface FileProposalRepositoryOptions {
  filePath?: string;
  readTextFile?: (path: string) => string;
  writeTextFile?: (path: string, text: string) => void;
  renamePath?: (from: string, to: string) => void;
  mkdirDir?: (path: string) => void;
  pathExists?: (path: string) => boolean;
  now?: () => number;
}

export class FileProposalRepository implements ProposalRepository {
  private readonly filePath: string;
  private readonly bySession: Map<string, StoredProposalRecord>;
  private readonly readTextFile: (path: string) => string;
  private readonly writeTextFile: (path: string, text: string) => void;
  private readonly renamePath: (from: string, to: string) => void;
  private readonly mkdirDir: (path: string) => void;
  private readonly pathExists: (path: string) => boolean;
  private readonly now: () => number;

  constructor(options: FileProposalRepositoryOptions = {}) {
    this.filePath = options.filePath ?? join(process.cwd(), "sessions", "proposals.json");
    this.readTextFile = options.readTextFile ?? ((path) => readFileSync(path, "utf8"));
    this.writeTextFile = options.writeTextFile ?? ((path, text) => writeFileSync(path, text, "utf8"));
    this.renamePath = options.renamePath ?? ((from, to) => renameSync(from, to));
    this.mkdirDir = options.mkdirDir ?? ((path) => mkdirSync(path, { recursive: true }));
    this.pathExists = options.pathExists ?? ((path) => existsSync(path));
    this.now = options.now ?? (() => Date.now());
    this.bySession = this.load();
  }

  get(sessionId: string): StoredProposalRecord | null {
    return this.bySession.get(sessionId) ?? null;
  }

  has(sessionId: string): boolean {
    return this.bySession.has(sessionId);
  }

  list(sessionId?: string): StoredProposalRecord[] {
    if (sessionId) {
      const record = this.bySession.get(sessionId);
      return record ? [record] : [];
    }
    return [...this.bySession.values()];
  }

  set(record: StoredProposalRecord): void {
    this.bySession.set(record.proposal.sessionId, record);
    this.persist();
  }

  delete(sessionId: string): void {
    this.bySession.delete(sessionId);
    this.persist();
  }

  private load(): Map<string, StoredProposalRecord> {
    let raw = "";
    try {
      raw = this.readTextFile(this.filePath);
    } catch {
      return new Map();
    }

    try {
      const parsed = JSON.parse(raw) as Partial<FileRepositoryPayload>;
      const records = Array.isArray(parsed.records) ? parsed.records : [];
      const map = new Map<string, StoredProposalRecord>();
      for (const record of records) {
        const sessionId = record?.proposal?.sessionId;
        if (typeof sessionId !== "string" || sessionId.length === 0) continue;
        if (record.proposal.expiresAt <= this.now()) continue;
        if (!record.proposal.patchPath || !this.pathExists(record.proposal.patchPath)) continue;
        map.set(sessionId, record);
      }
      return map;
    } catch {
      return new Map();
    }
  }

  private persist(): void {
    this.mkdirDir(dirname(this.filePath));
    const payload: FileRepositoryPayload = {
      version: 1,
      records: [...this.bySession.values()],
    };
    const tmpPath = `${this.filePath}.tmp`;
    this.writeTextFile(tmpPath, JSON.stringify(payload, null, 2));
    this.renamePath(tmpPath, this.filePath);
  }
}
