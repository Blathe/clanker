/**
 * JobQueue — async job queueing for long-running delegation tasks
 * Prevents the session busy flag from blocking user interactions
 */

import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";

export type SendFn = (text: string) => Promise<void>;

export interface QueuedJob {
  id: string;
  sessionId: string;
  prompt: string;
  send: SendFn;
  history: ChatCompletionMessageParam[];
}

export interface DelegateResult {
  exitCode: number;
  summary: string;
}

const MAX_CONCURRENT_JOBS = 10;

/**
 * In-process async job queue for delegation tasks
 * Allows multiple long-running jobs to execute in parallel without blocking the session
 */
export class JobQueue {
  private activeCount = 0;

  /**
   * Get current count of active (running) jobs
   */
  get size(): number {
    return this.activeCount;
  }

  /**
   * Enqueue a job for async execution
   * Returns true if queued, false if queue is at capacity
   */
  enqueue(
    job: QueuedJob,
    delegateFn: (prompt: string) => Promise<DelegateResult>
  ): boolean {
    if (this.activeCount >= MAX_CONCURRENT_JOBS) {
      return false;
    }

    this.activeCount++;
    this._run(job, delegateFn).finally(() => {
      this.activeCount--;
    });
    return true;
  }

  /**
   * Execute a queued job in the background
   * Appends result to history and notifies via send callback
   */
  private async _run(
    job: QueuedJob,
    delegateFn: (prompt: string) => Promise<DelegateResult>
  ): Promise<void> {
    try {
      console.log(`[JobQueue] Starting delegation task ${job.id}`);
      const result = await delegateFn(job.prompt);
      console.log(`[JobQueue] Delegation task ${job.id} completed, sending notification`);
      job.history.push({
        role: "user",
        content: `[Background task completed] Claude delegation result: ${result.summary}`,
      });
      try {
        await job.send(`Claude has finished the delegated task:\n\n${result.summary}`);
        console.log(`[JobQueue] Successfully sent notification for task ${job.id}`);
      } catch (err) {
        console.error(`[JobQueue] Failed to send notification for task ${job.id}: ${err}`);
      }
    } catch (err) {
      console.error(`[JobQueue] Task ${job.id} failed: ${err}`);
      try {
        await job.send(
          `The delegated task failed: ${err instanceof Error ? err.message : String(err)}`
        );
        console.log(`[JobQueue] Successfully sent error notification for task ${job.id}`);
      } catch (sendErr) {
        console.error(`[JobQueue] Failed to send error notification for task ${job.id}: ${sendErr}`);
      }
    }
  }
}
