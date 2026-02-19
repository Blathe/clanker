/**
 * Unit tests for session limit enforcement
 * Tests that concurrent sessions are bounded to prevent memory exhaustion
 */

import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";

const MAX_SESSIONS = 100;

// Mock the session state structure
interface SessionState {
  history: ChatCompletionMessageParam[];
  busy: boolean;
}

/**
 * Manages sessions with a maximum concurrent limit
 */
class SessionManager {
  private sessions: Map<string, SessionState> = new Map();
  private maxSessions: number;

  constructor(maxSessions: number = MAX_SESSIONS) {
    this.maxSessions = maxSessions;
  }

  /**
   * Get or create a session
   * Returns { session, error } where error is set if session creation is rejected
   */
  getSession(sessionId: string): { session: SessionState | null; error: string | null } {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      return { session: existing, error: null };
    }

    // Check if we've hit the session limit
    if (this.sessions.size >= this.maxSessions) {
      return {
        session: null,
        error: `Session limit reached (${this.maxSessions} concurrent sessions). Please try again later.`,
      };
    }

    // Create new session
    const created: SessionState = {
      history: [{ role: "system", content: "System prompt" }],
      busy: false,
    };
    this.sessions.set(sessionId, created);
    return { session: created, error: null };
  }

  /**
   * Get session count (for testing)
   */
  getSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Clear all sessions (for testing)
   */
  clear(): void {
    this.sessions.clear();
  }
}

describe("Session Limit Management", () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager(MAX_SESSIONS);
  });

  describe("SessionManager.getSession", () => {
    test("should create a new session when under limit", () => {
      const { session, error } = manager.getSession("session-1");

      expect(error).toBeNull();
      expect(session).not.toBeNull();
      expect(session?.history[0].role).toBe("system");
      expect(manager.getSessionCount()).toBe(1);
    });

    test("should return existing session without incrementing count", () => {
      manager.getSession("session-1");
      expect(manager.getSessionCount()).toBe(1);

      const { session, error } = manager.getSession("session-1");
      expect(error).toBeNull();
      expect(session).not.toBeNull();
      expect(manager.getSessionCount()).toBe(1); // Still 1, not 2
    });

    test("should reject new session when at limit", () => {
      // Create MAX_SESSIONS sessions
      for (let i = 0; i < MAX_SESSIONS; i++) {
        const { session, error } = manager.getSession(`session-${i}`);
        expect(session).not.toBeNull();
        expect(error).toBeNull();
      }

      // Next session should be rejected
      const { session, error } = manager.getSession(`session-${MAX_SESSIONS}`);
      expect(session).toBeNull();
      expect(error).toContain("Session limit reached");
      expect(manager.getSessionCount()).toBe(MAX_SESSIONS);
    });

    test("should allow new sessions after clearing", () => {
      // Create sessions up to limit
      for (let i = 0; i < MAX_SESSIONS; i++) {
        manager.getSession(`session-${i}`);
      }
      expect(manager.getSessionCount()).toBe(MAX_SESSIONS);

      // Clear and try again
      manager.clear();
      const { session, error } = manager.getSession("new-session");
      expect(session).not.toBeNull();
      expect(error).toBeNull();
      expect(manager.getSessionCount()).toBe(1);
    });

    test("should have proper error message format", () => {
      // Create sessions up to limit
      for (let i = 0; i < MAX_SESSIONS; i++) {
        manager.getSession(`session-${i}`);
      }

      const { error } = manager.getSession("overflow");
      expect(error).toMatch(/Session limit reached/);
      expect(error).toMatch(/\d+/); // Should contain number
    });

    test("should track session count correctly with mixed creates/existing", () => {
      // Create 3 sessions
      manager.getSession("a");
      manager.getSession("b");
      manager.getSession("c");
      expect(manager.getSessionCount()).toBe(3);

      // Access existing sessions
      manager.getSession("a");
      manager.getSession("b");
      expect(manager.getSessionCount()).toBe(3); // Still 3

      // Create new session
      manager.getSession("d");
      expect(manager.getSessionCount()).toBe(4);
    });

    test("should reject when limit is exactly at threshold", () => {
      const limitedManager = new SessionManager(3);

      limitedManager.getSession("a");
      limitedManager.getSession("b");
      const { session: session3, error: error3 } = limitedManager.getSession("c");

      expect(session3).not.toBeNull();
      expect(error3).toBeNull();
      expect(limitedManager.getSessionCount()).toBe(3);

      // 4th session should be rejected
      const { session: session4, error: error4 } = limitedManager.getSession("d");
      expect(session4).toBeNull();
      expect(error4).not.toBeNull();
    });
  });
});
