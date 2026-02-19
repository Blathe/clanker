/**
 * Unit tests for JobQueue
 * Tests async job queueing for long-running delegation tasks
 */

import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";

const MAX_CONCURRENT_JOBS = 10;

interface QueuedJob {
  id: string;
  sessionId: string;
  prompt: string;
  send: (text: string) => Promise<void>;
  history: ChatCompletionMessageParam[];
}

class JobQueue {
  private activeCount = 0;

  get size(): number {
    return this.activeCount;
  }

  enqueue(
    job: QueuedJob,
    delegateFn: (prompt: string) => Promise<{ exitCode: number; summary: string }>
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

  private async _run(
    job: QueuedJob,
    delegateFn: (prompt: string) => Promise<{ exitCode: number; summary: string }>
  ): Promise<void> {
    try {
      const result = await delegateFn(job.prompt);
      job.history.push({
        role: "user",
        content: `[Background task completed] Claude delegation result: ${result.summary}`,
      });
      await job.send(`Claude has finished the delegated task:\n\n${result.summary}`);
    } catch (err) {
      await job.send(
        `The delegated task failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}

describe("JobQueue", () => {
  let queue: JobQueue;

  beforeEach(() => {
    queue = new JobQueue();
  });

  describe("enqueue and execution", () => {
    test("should enqueue and execute a job successfully", async () => {
      const send = jest.fn().mockResolvedValue(undefined);
      const history: ChatCompletionMessageParam[] = [
        { role: "system", content: "test" },
      ];
      const delegateFn = jest
        .fn()
        .mockResolvedValue({ exitCode: 0, summary: "Task completed" });

      const job: QueuedJob = {
        id: "job-1",
        sessionId: "session-1",
        prompt: "test prompt",
        send,
        history,
      };

      const queued = queue.enqueue(job, delegateFn);
      expect(queued).toBe(true);
      expect(queue.size).toBe(1);

      // Wait for async execution
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(delegateFn).toHaveBeenCalledWith("test prompt");
      expect(send).toHaveBeenCalledWith(expect.stringContaining("Task completed"));
      expect(history.length).toBe(2); // system + user (background result)
      expect(queue.size).toBe(0);
    });

    test("should handle delegateFn errors gracefully", async () => {
      const send = jest.fn().mockResolvedValue(undefined);
      const history: ChatCompletionMessageParam[] = [
        { role: "system", content: "test" },
      ];
      const delegateFn = jest
        .fn()
        .mockRejectedValue(new Error("Delegation failed"));

      const job: QueuedJob = {
        id: "job-1",
        sessionId: "session-1",
        prompt: "failing prompt",
        send,
        history,
      };

      const queued = queue.enqueue(job, delegateFn);
      expect(queued).toBe(true);

      // Wait for async execution
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(send).toHaveBeenCalledWith(
        expect.stringContaining("The delegated task failed")
      );
      expect(send).toHaveBeenCalledWith(
        expect.stringContaining("Delegation failed")
      );
      expect(queue.size).toBe(0);
    });
  });

  describe("capacity management", () => {
    test("should reject enqueue when at MAX_CONCURRENT_JOBS", async () => {
      const send = jest.fn().mockResolvedValue(undefined);
      const delegateFn = jest
        .fn()
        .mockImplementation(
          () =>
            new Promise((resolve) =>
              setTimeout(() => resolve({ exitCode: 0, summary: "Done" }), 100)
            )
        );

      // Fill queue with long-running jobs
      const jobs: QueuedJob[] = [];
      for (let i = 0; i < MAX_CONCURRENT_JOBS; i++) {
        const job: QueuedJob = {
          id: `job-${i}`,
          sessionId: "session-1",
          prompt: `prompt-${i}`,
          send,
          history: [{ role: "system", content: "test" }],
        };
        jobs.push(job);
        const result = queue.enqueue(job, delegateFn);
        expect(result).toBe(true);
      }

      expect(queue.size).toBe(MAX_CONCURRENT_JOBS);

      // Next job should be rejected
      const rejected: QueuedJob = {
        id: "job-overflow",
        sessionId: "session-1",
        prompt: "overflow",
        send,
        history: [{ role: "system", content: "test" }],
      };
      const result = queue.enqueue(rejected, delegateFn);
      expect(result).toBe(false);
      expect(queue.size).toBe(MAX_CONCURRENT_JOBS);
    });

    test("should allow new jobs after previous ones complete", async () => {
      const send = jest.fn().mockResolvedValue(undefined);
      const delegateFn = jest
        .fn()
        .mockResolvedValue({ exitCode: 0, summary: "Done" });

      // Enqueue first job
      const job1: QueuedJob = {
        id: "job-1",
        sessionId: "session-1",
        prompt: "prompt-1",
        send,
        history: [{ role: "system", content: "test" }],
      };
      queue.enqueue(job1, delegateFn);
      expect(queue.size).toBe(1);

      // Wait for completion
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(queue.size).toBe(0);

      // Enqueue second job
      const job2: QueuedJob = {
        id: "job-2",
        sessionId: "session-1",
        prompt: "prompt-2",
        send,
        history: [{ role: "system", content: "test" }],
      };
      queue.enqueue(job2, delegateFn);
      expect(queue.size).toBe(1);

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(queue.size).toBe(0);
    });
  });

  describe("concurrency", () => {
    test("should run multiple jobs concurrently", async () => {
      const send = jest.fn().mockResolvedValue(undefined);
      const timestamps: number[] = [];

      const delegateFn = jest.fn().mockImplementation(() => {
        return new Promise((resolve) => {
          timestamps.push(Date.now());
          setTimeout(() => resolve({ exitCode: 0, summary: "Done" }), 20);
        });
      });

      // Enqueue 3 jobs rapidly
      for (let i = 0; i < 3; i++) {
        const job: QueuedJob = {
          id: `job-${i}`,
          sessionId: "session-1",
          prompt: `prompt-${i}`,
          send,
          history: [{ role: "system", content: "test" }],
        };
        queue.enqueue(job, delegateFn);
      }

      // All 3 should be active
      expect(queue.size).toBe(3);

      // Wait for completion
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(queue.size).toBe(0);
      expect(delegateFn).toHaveBeenCalledTimes(3);
    });

    test("should properly track activeCount with rapid enqueue/dequeue", async () => {
      const send = jest.fn().mockResolvedValue(undefined);
      const delegateFn = jest
        .fn()
        .mockResolvedValue({ exitCode: 0, summary: "Done" });

      const enqueueCount = 5;
      for (let i = 0; i < enqueueCount; i++) {
        const job: QueuedJob = {
          id: `job-${i}`,
          sessionId: "session-1",
          prompt: `prompt-${i}`,
          send,
          history: [{ role: "system", content: "test" }],
        };
        queue.enqueue(job, delegateFn);
      }

      expect(queue.size).toBe(enqueueCount);

      // Wait for all to complete
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(queue.size).toBe(0);
    });
  });

  describe("history mutation", () => {
    test("should append background task result to history on success", async () => {
      const send = jest.fn().mockResolvedValue(undefined);
      const history: ChatCompletionMessageParam[] = [
        { role: "system", content: "system prompt" },
      ];
      const delegateFn = jest
        .fn()
        .mockResolvedValue({ exitCode: 0, summary: "Task accomplished successfully" });

      const job: QueuedJob = {
        id: "job-1",
        sessionId: "session-1",
        prompt: "test",
        send,
        history,
      };

      queue.enqueue(job, delegateFn);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(history.length).toBe(2);
      expect(history[1].role).toBe("user");
      expect((history[1] as any).content).toContain(
        "Background task completed"
      );
      expect((history[1] as any).content).toContain(
        "Task accomplished successfully"
      );
    });

    test("should not modify history on error", async () => {
      const send = jest.fn().mockResolvedValue(undefined);
      const history: ChatCompletionMessageParam[] = [
        { role: "system", content: "system prompt" },
      ];
      const delegateFn = jest
        .fn()
        .mockRejectedValue(new Error("Task failed"));

      const job: QueuedJob = {
        id: "job-1",
        sessionId: "session-1",
        prompt: "test",
        send,
        history,
      };

      queue.enqueue(job, delegateFn);
      await new Promise((resolve) => setTimeout(resolve, 50));

      // On error, history should not be modified
      expect(history.length).toBe(1);
    });
  });
});
