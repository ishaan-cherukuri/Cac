/**
 * Text-to-speech. ElevenLabs primary, OpenAI TTS fallback, per SPEC section 5.
 *
 * Telugu coverage is the open question for BOTH providers — that is what this spike
 * is measuring. Neither is assumed to work.
 */

import OpenAI from "openai";
import type { SpikeConfig, TtsProvider } from "./config.ts";

export interface SynthesisResult {
  provider: TtsProvider;
  model: string;
  audio: Buffer;
  latencyMs: number;
}

const ELEVENLABS_ENDPOINT = "https://api.elevenlabs.io/v1/text-to-speech";

async function synthesizeElevenLabs(
  text: string,
  config: SpikeConfig,
): Promise<SynthesisResult> {
  const { elevenLabsApiKey, elevenLabsVoiceId, elevenLabsModelId } = config;
  if (!elevenLabsApiKey || !elevenLabsVoiceId) {
    throw new Error("synthesizeElevenLabs called without a key and voice id");
  }

  const startedAt = performance.now();
  const response = await fetch(`${ELEVENLABS_ENDPOINT}/${elevenLabsVoiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": elevenLabsApiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: elevenLabsModelId,
      voice_settings: {
        // Higher stability + lower style keeps an elderly voice from drifting
        // theatrical across turns. The persona must sound like the same person.
        stability: 0.6,
        similarity_boost: 0.8,
        style: 0.15,
        use_speaker_boost: true,
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "<unreadable body>");
    throw new Error(
      `ElevenLabs returned ${response.status} ${response.statusText}: ${detail.slice(0, 400)}`,
    );
  }

  return {
    provider: "elevenlabs",
    model: elevenLabsModelId,
    audio: Buffer.from(await response.arrayBuffer()),
    latencyMs: Math.round(performance.now() - startedAt),
  };
}

async function synthesizeOpenAi(
  text: string,
  client: OpenAI,
  config: SpikeConfig,
): Promise<SynthesisResult> {
  const startedAt = performance.now();

  const response = await client.audio.speech.create({
    model: config.openaiTtsModel,
    voice: config.openaiTtsVoice,
    input: text,
    instructions:
      "Speak as a warm, unhurried Telugu grandmother talking to a grandchild she loves. " +
      "Gentle pace, natural pauses. Not a narrator, not a teacher.",
  });

  return {
    provider: "openai",
    model: config.openaiTtsModel,
    audio: Buffer.from(await response.arrayBuffer()),
    latencyMs: Math.round(performance.now() - startedAt),
  };
}

/**
 * Synthesize with the preferred provider, falling back to OpenAI if ElevenLabs errors.
 * A fallback is reported, never silent — silently degrading voice quality would hide
 * the exact signal this spike needs to surface.
 */
export async function synthesize(
  text: string,
  client: OpenAI,
  config: SpikeConfig,
  preferred: TtsProvider,
): Promise<{ result: SynthesisResult; fellBackBecause: string | null }> {
  if (preferred === "elevenlabs") {
    try {
      return { result: await synthesizeElevenLabs(text, config), fellBackBecause: null };
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      return {
        result: await synthesizeOpenAi(text, client, config),
        fellBackBecause: why,
      };
    }
  }

  return { result: await synthesizeOpenAi(text, client, config), fellBackBecause: null };
}
