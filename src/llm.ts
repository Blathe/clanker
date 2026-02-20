import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";
import { z } from "zod";
import type { LLMResponse } from "./types.js";

const MODEL = "gpt-4o";
const MAX_TOKENS = 1024;

/**
 * Validates OpenAI API key format
 * OpenAI keys must start with "sk-"
 */
function validateOpenAIKey(key: string | undefined): { valid: boolean; error: string | null } {
  if (!key) {
    return { valid: false, error: "OPENAI_API_KEY is not set" };
  }

  if (!key.startsWith("sk-")) {
    return {
      valid: false,
      error: "OPENAI_API_KEY must start with 'sk-'. Check your API key format.",
    };
  }

  return { valid: true, error: null };
}

// Zod schemas for validating LLM responses
const CommandResponseSchema = z.object({
  type: z.literal("command"),
  command: z.string().min(1),
  working_dir: z.string().optional(),
  explanation: z.string(),
});

const EditResponseSchema = z.object({
  type: z.literal("edit"),
  file: z.string().min(1),
  old: z.string(),
  new: z.string(),
  explanation: z.string(),
});

const DelegateResponseSchema = z.object({
  type: z.literal("delegate"),
  prompt: z.string().min(1),
  working_dir: z.string().optional(),
  explanation: z.string(),
});

const MessageResponseSchema = z.object({
  type: z.literal("message"),
  explanation: z.string(),
});

const LLMResponseSchema = z.union([
  CommandResponseSchema,
  EditResponseSchema,
  DelegateResponseSchema,
  MessageResponseSchema,
]);

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    const apiKey = process.env.OPENAI_API_KEY;
    const validation = validateOpenAIKey(apiKey);
    if (!validation.valid) {
      throw new Error(validation.error!);
    }
    _client = new OpenAI({ apiKey });
  }
  return _client;
}

export async function callLLM(
  messages: ChatCompletionMessageParam[]
): Promise<LLMResponse> {
  const client = getClient();
  const response = await client.chat.completions.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    response_format: { type: "json_object" },
    messages,
  });

  const content = response.choices[0].message.content ?? "{}";
  const parsed = JSON.parse(content);

  // Validate against schema to ensure response has correct structure
  return LLMResponseSchema.parse(parsed);
}
