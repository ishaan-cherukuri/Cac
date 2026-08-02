/**
 * Env loading and validation for the spike.
 *
 * Deliberately dependency-free: Node 22 loads `.env` via --env-file-if-exists,
 * so there is nothing to install and nothing that can drift from the app's config.
 */

export const TARGET_LANGUAGE = "te" as const; // Telugu (ISO-639-1)
export const TARGET_LANGUAGE_NAME = "Telugu" as const;

export type TtsProvider = "elevenlabs" | "openai";

export interface SpikeConfig {
  openaiApiKey: string;
  elevenLabsApiKey: string | null;
  elevenLabsVoiceId: string | null;
  /** ElevenLabs model. Telugu coverage varies by model — see README. */
  elevenLabsModelId: string;
  openaiTtsVoice: string;
  openaiTtsModel: string;
}

class MissingKeyError extends Error {
  constructor(varName: string, why: string) {
    super(
      `Missing ${varName}.\n\n  ${why}\n\n` +
        `  Fix: copy .env.example to .env in the repo root and fill in ${varName}.\n` +
        `       cp .env.example .env\n`,
    );
    this.name = "MissingKeyError";
  }
}

export function loadConfig(): SpikeConfig {
  const openaiApiKey = process.env.OPENAI_API_KEY?.trim();
  if (!openaiApiKey) {
    throw new MissingKeyError(
      "OPENAI_API_KEY",
      "Required for Whisper transcription — the spike cannot run without it.",
    );
  }

  const elevenLabsApiKey = process.env.ELEVENLABS_API_KEY?.trim() || null;
  const elevenLabsVoiceId = process.env.ELEVENLABS_VOICE_ID?.trim() || null;

  return {
    openaiApiKey,
    elevenLabsApiKey,
    elevenLabsVoiceId,
    // eleven_v3 is the ONLY ElevenLabs model that supports Telugu (verified against
    // /v1/models: 74 languages incl. "te"). multilingual_v2 and turbo/flash_v2_5 do not
    // list it — using them would read Telugu text with a non-Telugu phoneme set.
    elevenLabsModelId: process.env.ELEVENLABS_MODEL_ID?.trim() || "eleven_v3",
    openaiTtsVoice: process.env.OPENAI_TTS_VOICE?.trim() || "shimmer",
    openaiTtsModel: process.env.OPENAI_TTS_MODEL?.trim() || "gpt-4o-mini-tts",
  };
}

/**
 * ElevenLabs is primary per SPEC, but it needs BOTH a key and a voice id.
 * Missing either is a normal state early on, not an error — we fall back to OpenAI
 * TTS (the spec's sanctioned fallback) and say so loudly.
 */
export function resolveTtsProvider(config: SpikeConfig): {
  provider: TtsProvider;
  reason: string;
} {
  if (!config.elevenLabsApiKey) {
    return { provider: "openai", reason: "ELEVENLABS_API_KEY is not set" };
  }
  if (!config.elevenLabsVoiceId) {
    return { provider: "openai", reason: "ELEVENLABS_VOICE_ID is not set" };
  }
  return { provider: "elevenlabs", reason: "ElevenLabs key and voice id present" };
}
