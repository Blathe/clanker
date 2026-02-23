import type { Channel, SendFn } from "../runtime.js";
import type { UserMessagePacket } from "../packets/types.js";
import { evaluateJobPolicy } from "../jobPolicy.js";
import type { JobPrOrchestrator } from "../github/prOrchestrator.js";
import { AuditWriter } from "./auditWriter.js";
import { FileJobRepository } from "./repository.js";
import { JobService } from "./service.js";

export interface SubmitJobInput {
  sessionId: string;
  channel: Channel;
  userInput: string;
  send: SendFn;
  proposedTouchedPaths?: string[];
  ownerApproved?: boolean;
}

export interface SubmitJobResult {
  jobId: string;
}

export interface AsyncJobSubmitterOptions {
  service: JobService;
  jobRepository: FileJobRepository;
  auditWriter: AuditWriter;
  prOrchestrator?: JobPrOrchestrator;
  createJobId?: () => string;
  now?: () => Date;
}

function defaultJobId(): string {
  const t = new Date();
  const stamp = t.toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 8);
  return `job_${stamp}_${rand}`;
}

function createUserPacket(input: SubmitJobInput, jobId: string, nowIso: string): UserMessagePacket {
  return {
    packet_type: "user_message",
    packet_id: `pkt_${jobId}`,
    job_id: jobId,
    created_at: nowIso,
    channel: input.channel,
    session_id: input.sessionId,
    message: input.userInput,
  };
}

function summarizeUserIntent(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "No user summary provided.";
  return trimmed.length > 400 ? `${trimmed.slice(0, 400)}...` : trimmed;
}

export class AsyncJobSubmitter {
  private readonly service: JobService;
  private readonly jobRepository: FileJobRepository;
  private readonly auditWriter: AuditWriter;
  private readonly prOrchestrator?: JobPrOrchestrator;
  private readonly createJobId: () => string;
  private readonly now: () => Date;
  private readonly inFlight = new Set<Promise<void>>();

  constructor(options: AsyncJobSubmitterOptions) {
    this.service = options.service;
    this.jobRepository = options.jobRepository;
    this.auditWriter = options.auditWriter;
    this.prOrchestrator = options.prOrchestrator;
    this.createJobId = options.createJobId ?? defaultJobId;
    this.now = options.now ?? (() => new Date());
  }

  async submit(input: SubmitJobInput): Promise<SubmitJobResult> {
    const now = this.now();
    const nowIso = now.toISOString();
    const jobId = this.createJobId();
    const packet = createUserPacket(input, jobId, nowIso);

    this.service.createJob(packet, now.getTime());
    const receivedSummary = this.jobRepository.writeSummary({
      jobId,
      createdAtIso: nowIso,
      status: "RECEIVED",
      summary: summarizeUserIntent(input.userInput),
      evidenceLinks: [],
    });
    this.auditWriter.appendEvent({
      jobId,
      atIso: nowIso,
      eventType: "received",
      payload: {
        channel: input.channel,
        session_id: input.sessionId,
      },
    });

    await input.send(`Job accepted: ${jobId}. Running now. I'll report back with links.`);
    await input.send(`Job record: ${receivedSummary.filePath}`);

    const runPromise = this.runJob(input, jobId).finally(() => {
      this.inFlight.delete(runPromise);
    });
    this.inFlight.add(runPromise);
    return { jobId };
  }

  async drain(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.allSettled([...this.inFlight]);
    }
  }

  private async runJob(input: SubmitJobInput, jobId: string): Promise<void> {
    const startedAt = this.now();
    const startedIso = startedAt.toISOString();
    await input.send(`Job running: ${jobId}`);

    this.service.markParsed(jobId, startedAt.getTime());
    this.auditWriter.appendEvent({
      jobId,
      atIso: startedIso,
      eventType: "parsed",
      payload: {},
    });

    const touchedPaths = input.proposedTouchedPaths ?? ["/jobs/", "/audit/"];
    const policy = evaluateJobPolicy({
      touchedPaths,
      ownerApproved: input.ownerApproved,
    });
    const policyState = this.service.applyPolicyDecision(jobId, this.now().getTime(), {
      allowed: policy.allowed,
      reason: policy.reasons.join("; "),
    });
    this.auditWriter.appendEvent({
      jobId,
      atIso: this.now().toISOString(),
      eventType: "policy_checked",
      payload: {
        risk_level: policy.riskLevel,
        allowed: policy.allowed,
        requires_approval: policy.requiresApproval,
      },
    });

    if (policyState.status === "DENIED") {
      const deniedSummary = this.jobRepository.writeSummary({
        jobId,
        createdAtIso: startedIso,
        status: "DENIED",
        summary: `Denied by policy: ${policyState.reason}`,
        evidenceLinks: [],
      });
      await input.send(`Job denied: ${jobId}. Reason: ${policyState.reason}`);
      await input.send(`Job record: ${deniedSummary.filePath}`);
      return;
    }

    this.service.markPlanned(jobId, this.now().getTime());
    this.service.markExecuting(jobId, this.now().getTime());
    this.auditWriter.appendEvent({
      jobId,
      atIso: this.now().toISOString(),
      eventType: "executing",
      payload: {},
    });

    const finalSummary = this.jobRepository.writeSummary({
      jobId,
      createdAtIso: startedIso,
      status: "EXECUTING",
      summary: `Executing plan for request: ${summarizeUserIntent(input.userInput)}`,
      evidenceLinks: [],
    });

    let prUrl: string | undefined;
    if (this.prOrchestrator) {
      const prResult = await this.prOrchestrator.openOrUpdateJobPr({
        jobId,
        title: `Job ${jobId}: execution summary`,
        body: "Automated job execution artifacts.",
        commitMessage: `job(${jobId}): update artifacts`,
        files: {
          [`jobs/${new Date(startedIso).getUTCFullYear()}/${String(new Date(startedIso).getUTCMonth() + 1).padStart(2, "0")}/${jobId}.md`]:
            finalSummary.content,
        },
      });
      this.service.openPr(jobId, this.now().getTime(), prResult.pr.number);
      this.service.markMerged(jobId, this.now().getTime());
      this.service.markDeployed(jobId, this.now().getTime());
      prUrl = prResult.pr.url;
    }

    const doneState = this.service.markDone(jobId, this.now().getTime());
    const doneSummary = this.jobRepository.writeSummary({
      jobId,
      createdAtIso: startedIso,
      status: doneState.status,
      summary: `Completed request: ${summarizeUserIntent(input.userInput)}`,
      evidenceLinks: prUrl ? [prUrl] : [],
    });
    const audit = this.auditWriter.appendEvent({
      jobId,
      atIso: this.now().toISOString(),
      eventType: "done",
      payload: {
        status: doneState.status,
      },
    });

    let completion = `Job completed: ${jobId}\nJob record: ${doneSummary.filePath}\nAudit log: ${audit.filePath}`;
    if (prUrl) {
      completion += `\nPR: ${prUrl}`;
    }
    await input.send(completion);
  }
}
