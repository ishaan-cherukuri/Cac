import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { loadConfig, resolveTtsProvider, type SpikeConfig } from "./config.ts";

function makeConfig(overrides: Partial<SpikeConfig> = {}): SpikeConfig {
  return {
    openaiApiKey: "sk-test",
    elevenLabsApiKey: "el-test",
    elevenLabsVoiceId: "voice-test",
    elevenLabsModelId: "eleven_multilingual_v2",
    openaiTtsVoice: "shimmer",
    openaiTtsModel: "gpt-4o-mini-tts",
    ...overrides,
  };
}

describe("resolveTtsProvider", () => {
  test("prefers ElevenLabs when fully configured", () => {
    assert.equal(resolveTtsProvider(makeConfig()).provider, "elevenlabs");
  });

  test("falls back to OpenAI when the key is absent", () => {
    // The expected state until ElevenLabs keys are added — must not throw.
    const { provider, reason } = resolveTtsProvider(makeConfig({ elevenLabsApiKey: null }));
    assert.equal(provider, "openai");
    assert.match(reason, /ELEVENLABS_API_KEY/);
  });

  test("falls back when a key exists but no voice is chosen", () => {
    const { provider, reason } = resolveTtsProvider(makeConfig({ elevenLabsVoiceId: null }));
    assert.equal(provider, "openai");
    assert.match(reason, /ELEVENLABS_VOICE_ID/);
  });
});

describe("loadConfig", () => {
  test("fails with an actionable message when OPENAI_API_KEY is missing", () => {
    const saved = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      assert.throws(() => loadConfig(), /cp \.env\.example \.env/);
    } finally {
      if (saved !== undefined) process.env.OPENAI_API_KEY = saved;
    }
  });

  test("treats blank optional keys as absent rather than empty strings", () => {
    const saved = { ...process.env };
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.ELEVENLABS_API_KEY = "   ";
    try {
      assert.equal(loadConfig().elevenLabsApiKey, null);
    } finally {
      process.env = saved;
    }
  });
});
