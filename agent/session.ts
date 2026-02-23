import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";

export interface SessionState {
  history: ChatCompletionMessageParam[];
  busy: boolean;
}

export interface SessionManagerOptions {
  maxSessions: number;
  systemPrompt: string;
}

/**
 * Manages sessions with a maximum concurrent limit.
 * Prevents memory exhaustion from unlimited session creation.
 */
export class SessionManager {
  private sessions: Map<string, SessionState> = new Map();
  private maxSessions: number;
  private systemPrompt: string;

  constructor(options: SessionManagerOptions) {
    this.maxSessions = options.maxSessions;
    this.systemPrompt = options.systemPrompt;
  }

  getSession(sessionId: string): SessionState {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;

    const created: SessionState = {
      history: [{ role: "system", content: this.systemPrompt }],
      busy: false,
    };
    this.sessions.set(sessionId, created);
    return created;
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  isAtLimit(): boolean {
    return this.sessions.size >= this.maxSessions;
  }

  getCount(): number {
    return this.sessions.size;
  }

  clear(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}
