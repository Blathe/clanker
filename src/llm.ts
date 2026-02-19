import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";
import { z } from "zod";
import type { LLMResponse } from "./types.js";

const MODEL = "gpt-4o";
const MAX_TOKENS = 1024;

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
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY environment variable is not set");
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
