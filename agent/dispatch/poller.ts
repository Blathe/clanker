import type { DispatchConfig } from "./types.js";
import type { SendFn, Channel } from "../runtime.js";

interface PollOptions {
  config: DispatchConfig;
  branchName: string;
  sendFn: SendFn;
  channel: Channel;
  pollIntervalMs: number;
  timeoutMs: number;
}

export function startPrPoller(opts: PollOptions): void {
  const { config, branchName, sendFn, pollIntervalMs, timeoutMs } = opts;
  const owner = config.repo.split("/")[0];
  const deadline = Date.now() + timeoutMs;

  async function poll(): Promise<void> {
    if (Date.now() >= deadline) {
      await sendFn(
        `GitHub Actions job timed out. Check github.com/${config.repo}/actions for status.`
      );
      return;
    }

    try {
      const url = `https://api.github.com/repos/${config.repo}/pulls?head=${owner}:${branchName}&state=open`;
      const response = await fetch(url, {
        headers: {
          "Authorization": `Bearer ${config.githubToken}`,
          "Accept": "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });

      if (response.ok) {
        const pulls = (await response.json()) as Array<{ title: string; html_url: string }>;
        if (pulls.length > 0) {
          const pr = pulls[0];
          await sendFn(`✓ PR ready: ${pr.title} — ${pr.html_url}`);
          return;
        }
      }
    } catch {
      // Network error — keep polling
    }

    setTimeout(() => void poll(), pollIntervalMs);
  }

  setTimeout(() => void poll(), pollIntervalMs);
}
