/**
 * TTS benchmark for Telugu.
 *
 * Measures TIME TO FIRST AUDIO BYTE, not total duration. Users perceive latency as
 * "how long until she starts talking" — the tail generates while playback is underway,
 * so TTFB is the number that decides whether free-form conversation is viable.
 *
 *   node --env-file=.env scripts/bench-tts.mjs
 *
 * Writes samples to spike/out/bench/ so quality can be judged by ear as well. A model
 * being fast is worthless if its Telugu is unintelligible.
 */

import { mkdir, writeFile } from "node:fs/promises";

const OUT_DIR = "spike/out/bench";

// Two sentences: roughly what Ammamma says in one turn.
const LINE =
  "ఏమైంది కన్నా? ఈరోజు నాతో మాట్లాడాలని అనిపించిందా? భోజనం చేశావా?";

const elevenKey = process.env.ELEVENLABS_API_KEY;
const voiceId = process.env.ELEVENLABS_VOICE_ID;
const openaiKey = process.env.OPENAI_API_KEY;

/** Reads a streaming response, recording when the first byte lands. */
async function measureStream(response, startedAt) {
  let firstByteAt = null;
  const chunks = [];
  for await (const chunk of response.body) {
    if (firstByteAt === null) firstByteAt = Date.now();
    chunks.push(chunk);
  }
  return {
    ttfb: firstByteAt === null ? null : firstByteAt - startedAt,
    total: Date.now() - startedAt,
    bytes: Buffer.concat(chunks.map((c) => Buffer.from(c))),
  };
}

async function elevenLabs({ label, model, stream, latencyHint }) {
  const base = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
  const url = new URL(stream ? `${base}/stream` : base);
  if (latencyHint !== undefined) {
    url.searchParams.set("optimize_streaming_latency", String(latencyHint));
  }

  const startedAt = Date.now();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": elevenKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text: LINE,
      model_id: model,
      voice_settings: { stability: 0.6, similarity_boost: 0.8, style: 0.15 },
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return { label, error: `HTTP ${response.status} ${detail.slice(0, 120)}` };
  }

  const result = await measureStream(response, startedAt);
  return { label, ...result };
}

async function openaiTts({ label, model }) {
  const startedAt = Date.now();
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      voice: "shimmer",
      input: LINE,
      response_format: "mp3",
      instructions:
        "Speak as a warm, unhurried Telugu grandmother talking to a grandchild she loves.",
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return { label, error: `HTTP ${response.status} ${detail.slice(0, 120)}` };
  }

  const result = await measureStream(response, startedAt);
  return { label, ...result };
}

const CASES = [
  // The current production path — the baseline to beat.
  () => elevenLabs({ label: "eleven_v3 (non-stream)", model: "eleven_v3", stream: false }),
  // The critical unknown: does streaming cut time-to-first-audio?
  () => elevenLabs({ label: "eleven_v3 (stream)", model: "eleven_v3", stream: true }),
  () =>
    elevenLabs({
      label: "eleven_v3 (stream, lat=4)",
      model: "eleven_v3",
      stream: true,
      latencyHint: 4,
    }),
  // Unlisted for Telugu, but unlisted != unintelligible. If this works we are done.
  () =>
    elevenLabs({ label: "eleven_flash_v2_5 (stream)", model: "eleven_flash_v2_5", stream: true }),
  () =>
    elevenLabs({
      label: "eleven_turbo_v2_5 (stream)",
      model: "eleven_turbo_v2_5",
      stream: true,
    }),
  // Different provider, different latency curve. Already our sanctioned fallback.
  () => openaiTts({ label: "openai gpt-4o-mini-tts", model: "gpt-4o-mini-tts" }),
  () => openaiTts({ label: "openai tts-1", model: "tts-1" }),
];

await mkdir(OUT_DIR, { recursive: true });

console.log(`Text (${LINE.length} chars): ${LINE}\n`);
console.log("model".padEnd(30) + "TTFB".padEnd(10) + "total".padEnd(10) + "size");
console.log("-".repeat(62));

for (const run of CASES) {
  let result;
  try {
    result = await run();
  } catch (error) {
    result = { label: "unknown", error: String(error).slice(0, 120) };
  }

  if (result.error) {
    console.log(result.label.padEnd(30) + "— " + result.error);
    continue;
  }

  const name = result.label.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  await writeFile(`${OUT_DIR}/${name}.mp3`, result.bytes);

  console.log(
    result.label.padEnd(30) +
      `${(result.ttfb / 1000).toFixed(2)}s`.padEnd(10) +
      `${(result.total / 1000).toFixed(2)}s`.padEnd(10) +
      `${Math.round(result.bytes.length / 1024)}KB`,
  );
}

console.log(`\nSamples in ${OUT_DIR}/ — judge Telugu quality by ear before trusting any number.`);
console.log("A model that is fast and unintelligible is not a candidate.");
