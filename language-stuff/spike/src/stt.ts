/**
 * Speech-to-text. This module carries the highest risk in the whole project:
 * if Whisper cannot handle accented heritage-speaker Telugu, SPEC step 1 says stop.
 *
 * We transcribe with two models rather than one. `whisper-1` is what the SPEC names,
 * but a side-by-side against `gpt-4o-transcribe` costs one extra call and turns a
 * pass/fail into a provider decision.
 */

import { createReadStream } from "node:fs";
import OpenAI from "openai";
import { TARGET_LANGUAGE } from "./config.ts";

export interface TranscriptionResult {
  model: string;
  text: string;
  /** Wall-clock ms for the call — latency is a product constraint, not a footnote. */
  latencyMs: number;
}

/**
 * `whisper-1` is deliberately absent. The SPEC names Whisper as the STT provider, but
 * OpenAI's hosted whisper-1 rejects Telugu outright with
 *   400 Language 'te' is not supported
 * — verified 2026-07-29 against real audio. It is not a quality problem, it is a hard
 * refusal, so there is nothing to compare and no reason to spend a call on it.
 */
export const STT_MODELS = ["gpt-4o-transcribe", "gpt-4o-mini-transcribe"] as const;

export async function transcribe(
  client: OpenAI,
  audioPath: string,
  model: string,
): Promise<TranscriptionResult> {
  const startedAt = performance.now();

  const response = await client.audio.transcriptions.create({
    file: createReadStream(audioPath),
    model,
    language: TARGET_LANGUAGE,
    // No `prompt` bias here on purpose: biasing toward expected vocabulary would
    // flatter the model and hide exactly the weakness this spike exists to find.
  });

  return {
    model,
    text: response.text.trim(),
    latencyMs: Math.round(performance.now() - startedAt),
  };
}

/**
 * Transcribe with every candidate model. One model failing must not sink the run —
 * a partial comparison is still a useful signal.
 */
export async function transcribeAll(
  client: OpenAI,
  audioPath: string,
): Promise<Array<TranscriptionResult | { model: string; error: string }>> {
  const settled = await Promise.allSettled(
    STT_MODELS.map((model) => transcribe(client, audioPath, model)),
  );

  return settled.map((outcome, index) => {
    const model = STT_MODELS[index] ?? "unknown";
    if (outcome.status === "fulfilled") return outcome.value;
    return { model, error: describeError(outcome.reason) };
  });
}

export function describeError(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  return String(reason);
}
