/**
 * Unit tests for session file format validation
 * Tests that session files are validated before reading
 */

/**
 * Validates that a filename matches the expected session file format
 * Expected format: YYYY-MM-DDTHH-MM-SS_<pid>.jsonl
 */
function isValidSessionFilename(filename: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}_\d+\.jsonl$/.test(filename);
}

/**
 * Filters filenames to only valid session files
 */
function filterValidSessionFiles(filenames: string[]): string[] {
  return filenames.filter(isValidSessionFilename);
}

describe("Session File Format Validation", () => {
  describe("isValidSessionFilename", () => {
    test("should accept valid session filename", () => {
      expect(isValidSessionFilename("2024-01-15T14-30-45_12345.jsonl")).toBe(true);
    });

    test("should accept valid filename with large PID", () => {
      expect(isValidSessionFilename("2024-01-15T14-30-45_999999999.jsonl")).toBe(true);
    });

    test("should accept valid filename with single digit PID", () => {
      expect(isValidSessionFilename("2024-01-15T14-30-45_1.jsonl")).toBe(true);
    });

    test("should reject file without .jsonl extension", () => {
      expect(isValidSessionFilename("2024-01-15T14-30-45_12345.txt")).toBe(false);
    });

    test("should reject file without underscore separator", () => {
      expect(isValidSessionFilename("2024-01-15T14-30-45-12345.jsonl")).toBe(false);
    });

    test("should reject file with invalid date format", () => {
      expect(isValidSessionFilename("2024/01/15T14-30-45_12345.jsonl")).toBe(false);
    });

    test("should reject file with invalid time format", () => {
      expect(isValidSessionFilename("2024-01-15T14.30.45_12345.jsonl")).toBe(false);
    });

    test("should reject file with non-numeric PID", () => {
      expect(isValidSessionFilename("2024-01-15T14-30-45_abc123.jsonl")).toBe(false);
    });

    test("should reject file with no PID", () => {
      expect(isValidSessionFilename("2024-01-15T14-30-45_.jsonl")).toBe(false);
    });

    test("should reject empty filename", () => {
      expect(isValidSessionFilename("")).toBe(false);
    });

    test("should reject completely malformed filename", () => {
      expect(isValidSessionFilename("invalid_session_file")).toBe(false);
    });

    test("should reject file with extra dots", () => {
      expect(isValidSessionFilename("2024-01-15T14-30-45_12345.jsonl.bak")).toBe(false);
    });

    test("should reject file with uppercase extension", () => {
      expect(isValidSessionFilename("2024-01-15T14-30-45_12345.JSONL")).toBe(false);
    });

    test("should reject file with leading dots", () => {
      expect(isValidSessionFilename(".2024-01-15T14-30-45_12345.jsonl")).toBe(false);
    });

    test("should reject file with spaces", () => {
      expect(isValidSessionFilename("2024-01-15 T14-30-45_12345.jsonl")).toBe(false);
    });
  });

  describe("filterValidSessionFiles", () => {
    test("should keep only valid files", () => {
      const input = [
        "2024-01-15T14-30-45_12345.jsonl",
        "invalid_file.txt",
        "2024-01-15T14-30-45_999.jsonl",
        "random.data",
      ];

      const result = filterValidSessionFiles(input);

      expect(result).toEqual([
        "2024-01-15T14-30-45_12345.jsonl",
        "2024-01-15T14-30-45_999.jsonl",
      ]);
    });

    test("should return empty array if no valid files", () => {
      const input = ["file1.txt", "file2.data", "session.json"];

      const result = filterValidSessionFiles(input);

      expect(result).toEqual([]);
    });

    test("should handle empty input", () => {
      const result = filterValidSessionFiles([]);

      expect(result).toEqual([]);
    });

    test("should preserve order of valid files", () => {
      const input = [
        "2024-01-14T10-00-00_100.jsonl",
        "2024-01-15T14-30-45_200.jsonl",
        "2024-01-16T18-45-30_300.jsonl",
      ];

      const result = filterValidSessionFiles(input);

      expect(result).toEqual(input); // Order preserved
    });

    test("should filter out malformed files while keeping valid ones", () => {
      const input = [
        "2024-01-15T14-30-45_12345.jsonl",
        "2024-01-15T14-30-45-12345.jsonl", // No underscore
        "2024-01-15T14-30-45_12345.txt", // Wrong extension
        "2024-01-15T14-30-45_12345.jsonl", // Valid
      ];

      const result = filterValidSessionFiles(input);

      expect(result).toHaveLength(2);
      expect(result[0]).toBe("2024-01-15T14-30-45_12345.jsonl");
      expect(result[1]).toBe("2024-01-15T14-30-45_12345.jsonl");
    });
  });
});
