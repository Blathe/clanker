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
