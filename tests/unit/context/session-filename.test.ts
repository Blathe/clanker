/**
 * Unit tests for session filename parsing
 * Tests that session filenames are parsed correctly to extract timestamps
 */

/**
 * Extracts the timestamp from a session filename
 * Expected format: YYYY-MM-DDTHH-MM-SS_<pid>.jsonl
 * Returns timestamp in format "YYYY-MM-DD HH:MM:SS" for display
 */
function extractSessionTimestamp(filename: string): string | null {
  // Validate filename format: should end with _<numbers>.jsonl
  const match = filename.match(/^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})_(\d+)\.jsonl$/);
  if (!match) {
    return null; // Invalid format
  }

  const timestamp = match[1]; // e.g., "2024-01-15T14-30-45"
  // Convert T to space and hyphens to colons in time portion
  // "2024-01-15T14-30-45" -> "2024-01-15 14:30:45"
  return timestamp.replace("T", " ").replace(/-(\d{2})-(\d{2})$/, ":$1:$2");
}

describe("Session Filename Parsing", () => {
  describe("extractSessionTimestamp", () => {
    test("should extract timestamp from valid filename", () => {
      const result = extractSessionTimestamp("2024-01-15T14-30-45_12345.jsonl");
      expect(result).toBe("2024-01-15 14:30:45");
    });

    test("should handle different PIDs", () => {
      const result1 = extractSessionTimestamp("2024-01-15T14-30-45_1.jsonl");
      const result2 = extractSessionTimestamp("2024-01-15T14-30-45_99999.jsonl");

      expect(result1).toBe("2024-01-15 14:30:45");
      expect(result2).toBe("2024-01-15 14:30:45");
    });

    test("should return null for invalid format (no underscore)", () => {
      const result = extractSessionTimestamp("2024-01-15T14-30-45-12345.jsonl");
      expect(result).toBeNull();
    });

    test("should return null for invalid format (wrong extension)", () => {
      const result = extractSessionTimestamp("2024-01-15T14-30-45_12345.txt");
      expect(result).toBeNull();
    });

    test("should return null for invalid date format", () => {
      const result = extractSessionTimestamp("2024/01/15T14-30-45_12345.jsonl");
      expect(result).toBeNull();
    });

    test("should return null for invalid time format", () => {
      const result = extractSessionTimestamp("2024-01-15T14.30.45_12345.jsonl");
      expect(result).toBeNull();
    });

    test("should return null for empty filename", () => {
      const result = extractSessionTimestamp("");
      expect(result).toBeNull();
    });

    test("should return null for malformed timestamp", () => {
      const result = extractSessionTimestamp("invalid_timestamp_12345.jsonl");
      expect(result).toBeNull();
    });

    test("should handle edge case dates (leap year)", () => {
      const result = extractSessionTimestamp("2024-02-29T23-59-59_99999.jsonl");
      expect(result).toBe("2024-02-29 23:59:59");
    });

    test("should handle midnight timestamps", () => {
      const result = extractSessionTimestamp("2024-01-01T00-00-00_1.jsonl");
      expect(result).toBe("2024-01-01 00:00:00");
    });

    test("should handle end of day timestamps", () => {
      const result = extractSessionTimestamp("2024-12-31T23-59-59_99999.jsonl");
      expect(result).toBe("2024-12-31 23:59:59");
    });

    test("should be robust against extra underscores in PID section", () => {
      const result = extractSessionTimestamp("2024-01-15T14-30-45_123_45.jsonl");
      expect(result).toBeNull(); // PID should only be digits
    });

    test("should not be fooled by files with similar names", () => {
      const result = extractSessionTimestamp("session_2024-01-15T14-30-45_12345.jsonl");
      expect(result).toBeNull(); // Must start with date
    });
  });
});
