/**
 * Truncates text by line count and character count.
 * Returns the truncated string and whether truncation occurred.
 */
export function truncateText(
  text: string,
  maxLines: number,
  maxChars: number
): { result: string; truncated: boolean } {
  const limited = text.split("\n").slice(0, maxLines).join("\n");
  const result = limited.length > maxChars ? limited.slice(0, maxChars) : limited;
  return { result, truncated: result.length < text.length };
}

/**
 * Validates user input length to prevent DoS and memory exhaustion
 */
export function validateInputLength(input: string, maxLen: number): { valid: boolean; error: string | null } {
  if (!input) {
    return { valid: false, error: "Input cannot be empty" };
  }

  if (input.length > maxLen) {
    return {
      valid: false,
      error: `Input too long (${input.length} characters, max ${maxLen}). Please keep your message shorter.`,
    };
  }

  return { valid: true, error: null };
}
