/**
 * Unit tests for session history management
 * Tests that session history is bounded to prevent memory exhaustion
 */

import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";

const MAX_HISTORY = 50;

// Mock the session state structure
interface SessionState {
  history: ChatCompletionMessageParam[];
  busy: boolean;
}

/**
 * Trims session history to keep system prompt + last N messages
 * Prevents unbounded memory growth in long-running sessions
 */
function trimSessionHistory(history: ChatCompletionMessageParam[]): void {
  if (history.length <= MAX_HISTORY + 1) {
    return; // +1 for system prompt
  }

  // Keep system prompt (index 0) and the most recent MAX_HISTORY messages
  const systemPrompt = history[0];
  const recentMessages = history.slice(-(MAX_HISTORY));
  history.splice(0, history.length, systemPrompt, ...recentMessages);
}

describe("Session History Management", () => {
  describe("trimSessionHistory", () => {
    test("should not trim history under the limit", () => {
      const history: ChatCompletionMessageParam[] = [
        { role: "system", content: "System prompt" },
        { role: "user", content: "User message 1" },
        { role: "assistant", content: "Assistant response 1" },
      ];
      const originalLength = history.length;

      trimSessionHistory(history);

      expect(history.length).toBe(originalLength);
      expect(history[0].role).toBe("system");
    });

    test("should preserve system prompt at index 0", () => {
      const systemPrompt: ChatCompletionMessageParam = { role: "system", content: "System prompt" };
      const history: ChatCompletionMessageParam[] = [
        systemPrompt,
        { role: "user", content: "User message 1" },
        { role: "assistant", content: "Response 1" },
      ];

      trimSessionHistory(history);

      expect(history[0]).toBe(systemPrompt);
    });

    test("should trim history when exceeding MAX_HISTORY + 1", () => {
      const systemPrompt: ChatCompletionMessageParam = { role: "system", content: "System prompt" };
      const history: ChatCompletionMessageParam[] = [systemPrompt];

      // Add 60 messages (exceeds MAX_HISTORY of 50)
      for (let i = 1; i <= 60; i++) {
        history.push({
          role: i % 2 === 0 ? "assistant" : "user",
          content: `Message ${i}`,
        });
      }

      expect(history.length).toBe(61); // System + 60 messages

      trimSessionHistory(history);

      // Should be capped at system prompt + 50 messages
      expect(history.length).toBe(51);
      expect(history[0].role).toBe("system");
    });

    test("should keep the most recent messages after trimming", () => {
      const systemPrompt: ChatCompletionMessageParam = { role: "system", content: "System prompt" };
      const history: ChatCompletionMessageParam[] = [systemPrompt];

      // Add 60 messages
      for (let i = 1; i <= 60; i++) {
        history.push({
          role: "user",
          content: `Message ${i}`,
        });
      }

      trimSessionHistory(history);

      // After trimming, the first message after system prompt should be "Message 11"
      // (since we kept last 50 out of 60)
      expect(history[1].content).toBe("Message 11");
      expect(history[history.length - 1].content).toBe("Message 60");
    });

    test("should handle history at exact boundary (MAX_HISTORY + 1)", () => {
      const systemPrompt: ChatCompletionMessageParam = { role: "system", content: "System prompt" };
      const history: ChatCompletionMessageParam[] = [systemPrompt];

      // Add exactly MAX_HISTORY messages (50)
      for (let i = 1; i <= MAX_HISTORY; i++) {
        history.push({
          role: "user",
          content: `Message ${i}`,
        });
      }

      const originalLength = history.length; // 51 (system + 50)

      trimSessionHistory(history);

      // Should not trim at exact boundary
      expect(history.length).toBe(originalLength);
    });

    test("should handle history just over boundary (MAX_HISTORY + 2)", () => {
      const systemPrompt: ChatCompletionMessageParam = { role: "system", content: "System prompt" };
      const history: ChatCompletionMessageParam[] = [systemPrompt];

      // Add MAX_HISTORY + 1 messages (51)
      for (let i = 1; i <= MAX_HISTORY + 1; i++) {
        history.push({
          role: "user",
          content: `Message ${i}`,
        });
      }

      trimSessionHistory(history);

      // Should trim to system + 50
      expect(history.length).toBe(51);
      expect(history[1].content).toBe("Message 2"); // First message kept should be Message 2
    });

    test("should preserve message order when trimming", () => {
      const systemPrompt: ChatCompletionMessageParam = { role: "system", content: "System prompt" };
      const history: ChatCompletionMessageParam[] = [systemPrompt];

      // Add 70 messages with alternating roles
      for (let i = 1; i <= 70; i++) {
        history.push({
          role: i % 2 === 0 ? "assistant" : "user",
          content: `Message ${i}`,
        });
      }

      trimSessionHistory(history);

      // Verify message order is preserved
      for (let i = 1; i < history.length; i++) {
        const expectedNum = i + (70 - MAX_HISTORY); // First kept message should be 21
        expect(history[i].content).toBe(`Message ${expectedNum}`);
      }
    });
  });
});
