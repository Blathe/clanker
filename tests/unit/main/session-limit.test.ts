/**
 * Unit tests for session limit enforcement using production SessionManager
 */

import { SessionManager } from "../../../agent/session.js";

const MAX_SESSIONS = 100;

describe("Session Limit Management", () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager({ maxSessions: MAX_SESSIONS, systemPrompt: "System prompt" });
  });

  describe("SessionManager", () => {
    test("should create a new session when under limit", () => {
      expect(manager.hasSession("session-1")).toBe(false);
      const state = manager.getSession("session-1");
      expect(state).not.toBeNull();
      expect(state.history[0].role).toBe("system");
      expect(manager.getCount()).toBe(1);
    });

    test("should return existing session without incrementing count", () => {
      manager.getSession("session-1");
      expect(manager.getCount()).toBe(1);

      const state = manager.getSession("session-1");
      expect(state).not.toBeNull();
      expect(manager.getCount()).toBe(1); // Still 1, not 2
    });

    test("hasSession returns false for unknown session", () => {
      expect(manager.hasSession("nonexistent")).toBe(false);
    });

    test("hasSession returns true after getSession creates it", () => {
      manager.getSession("session-1");
      expect(manager.hasSession("session-1")).toBe(true);
    });

    test("isAtLimit returns false when under limit", () => {
      expect(manager.isAtLimit()).toBe(false);
    });

    test("isAtLimit returns true when at limit", () => {
      for (let i = 0; i < MAX_SESSIONS; i++) {
        manager.getSession(`session-${i}`);
      }
      expect(manager.isAtLimit()).toBe(true);
    });

    test("getCount reflects number of sessions created", () => {
      expect(manager.getCount()).toBe(0);
      manager.getSession("a");
      manager.getSession("b");
      manager.getSession("c");
      expect(manager.getCount()).toBe(3);
    });

    test("should track session count correctly with mixed creates/existing", () => {
      manager.getSession("a");
      manager.getSession("b");
      manager.getSession("c");
      expect(manager.getCount()).toBe(3);

      // Access existing sessions — count stays the same
      manager.getSession("a");
      manager.getSession("b");
      expect(manager.getCount()).toBe(3);

      // Create new session
      manager.getSession("d");
      expect(manager.getCount()).toBe(4);
    });

    test("clear removes a session", () => {
      manager.getSession("session-1");
      expect(manager.getCount()).toBe(1);
      manager.clear("session-1");
      expect(manager.getCount()).toBe(0);
      expect(manager.hasSession("session-1")).toBe(false);
    });

    test("isAtLimit becomes false after clear", () => {
      const small = new SessionManager({ maxSessions: 2, systemPrompt: "" });
      small.getSession("a");
      small.getSession("b");
      expect(small.isAtLimit()).toBe(true);
      small.clear("a");
      expect(small.isAtLimit()).toBe(false);
    });

    test("session history initialized with system prompt", () => {
      const manager2 = new SessionManager({ maxSessions: 10, systemPrompt: "custom prompt" });
      const state = manager2.getSession("x");
      expect(state.history).toHaveLength(1);
      expect(state.history[0]).toMatchObject({ role: "system", content: "custom prompt" });
    });
  });
});
