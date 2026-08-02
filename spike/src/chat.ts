/**
 * Conversation logic.
 *
 * SPEC section 5 specifies Claude Sonnet; we are building against OpenAI until an
 * Anthropic key exists. Everything below the `ChatProvider` interface is swappable —
 * adding `anthropic.ts` that satisfies the same interface is the entire migration.
 */

import OpenAI from "openai";
import { buildSystemPrompt, vetLine, type PersonaPromptInput } from "@ammamma/core";

export interface ChatTurn {
  role: "assistant" | "user";
  /** For the user, this is the Whisper transcript — expect it to be messy. */
  content: string;
}

export interface ChatRequest extends PersonaPromptInput {
  history: ChatTurn[];
}

export interface ChatResponse {
  text: string;
  model: string;
  latencyMs: number;
  /** Set when an outbound check replaced the response. See SPEC sections 9 and 10. */
  rejected: string | null;
}

export interface ChatProvider {
  readonly name: string;
  respond(request: ChatRequest): Promise<ChatResponse>;
}

export function createOpenAiChatProvider(client: OpenAI, model: string): ChatProvider {
  return {
    name: `openai:${model}`,

    async respond(request: ChatRequest): Promise<ChatResponse> {
      const startedAt = performance.now();

      const completion = await client.chat.completions.create({
        model,
        // Warmth needs room; a cold temperature makes Ammamma sound like a form letter.
        temperature: 0.8,
        max_tokens: 200,
        messages: [
          { role: "system", content: buildSystemPrompt(request) },
          ...request.history.map((turn) => ({ role: turn.role, content: turn.content })),
        ],
      });

      const raw = completion.choices[0]?.message?.content ?? "";
      // vetLine substitutes wholesale on any violation — payment reference, cold tone,
      // or empty generation. See packages/core/src/persona.ts.
      const vetted = vetLine(raw);

      return {
        text: vetted.text,
        model,
        latencyMs: Math.round(performance.now() - startedAt),
        rejected: vetted.rejected,
      };
    },
  };
}
