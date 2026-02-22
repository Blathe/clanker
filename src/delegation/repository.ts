import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
}

export class FileProposalRepository implements ProposalRepository {
  private readonly filePath: string;
  private readonly bySession: Map<string, StoredProposalRecord>;

  constructor(options: FileProposalRepositoryOptions = {}) {
    this.filePath = options.filePath ?? join(process.cwd(), "sessions", "proposals.json");
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
      raw = readFileSync(this.filePath, "utf8");
    } catch {
      return new Map();
    }

    try {
      const parsed = JSON.parse(raw) as Partial<FileRepositoryPayload>;
      const records = Array.isArray(parsed.records) ? parsed.records : [];
      const map = new Map<string, StoredProposalRecord>();
      for (const record of records) {
        const sessionId = record?.proposal?.sessionId;
        if (typeof sessionId === "string" && sessionId.length > 0) {
          map.set(sessionId, record);
        }
      }
      return map;
    } catch {
      return new Map();
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const payload: FileRepositoryPayload = {
      version: 1,
      records: [...this.bySession.values()],
    };
    writeFileSync(this.filePath, JSON.stringify(payload, null, 2), "utf8");
  }
}
