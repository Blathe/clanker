import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.js";
import type { LLMResponse } from "./types.js";

const MODEL = "gpt-4o";
const MAX_TOKENS = 1024;

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
  return JSON.parse(content) as LLMResponse;
}
