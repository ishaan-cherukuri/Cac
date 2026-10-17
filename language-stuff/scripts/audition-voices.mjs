/**
 * Auditions ElevenLabs voices for a language's grandmother and saves one clip per voice,
 * so a human can choose by ear. Nothing is uploaded and nothing in the app changes.
 *
 *   node --env-file=.env scripts/audition-voices.mjs --language hi            # 3 voices
 *   node --env-file=.env scripts/audition-voices.mjs --language hi --count 5
 *
 * Writes spike/out/voices-<lang>/<n>-<voice name>-<voice id>.mp3 (spike/out is gitignored).
 * When you have picked one, put its id in `elevenLabs.voiceId` for that language in
 * packages/core/src/languages.ts.
 *
 * Candidates are female voices from your ElevenLabs library, older-sounding and
 * Indian-accented first. Cost: one short line per voice (~60 characters each).
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { languageProfile } from "../packages/core/src/languages.ts";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};

const language = languageProfile(flag("--language", "hi"));
const count = Number(flag("--count", "3"));
const key = process.env.ELEVENLABS_API_KEY;
if (!key) {
  console.error("Need ELEVENLABS_API_KEY in .env");
  process.exit(1);
}

/** The audition line: a real line from the starter topic plus her fallback line. */
const AUDITION = {
  hi: "होली है! आज रंग खेलोगे ना, बेटा? थोड़ा और बताओ, बेटा।",
  te: "ఏమైంది కన్నా? ఈరోజు నాతో మాట్లాడాలని అనిపించిందా?",
}[language.code];

const response = await fetch("https://api.elevenlabs.io/v2/voices?page_size=100", {
  headers: { "xi-api-key": key },
});
if (!response.ok) {
  console.error(`Could not list voices: ${response.status} ${await response.text()}`);
  process.exit(1);
}
const { voices } = await response.json();

/** Higher is a better fit for a grandmother speaking this language. */
function score(voice) {
  const labels = Object.values(voice.labels ?? {}).join(" ").toLowerCase();
  const text = `${voice.name} ${voice.description ?? ""} ${labels}`.toLowerCase();
  let points = 0;
  if (/female|woman/.test(text)) points += 4;
  if (/old|elder|middle|mature|grand|aged/.test(text)) points += 2;
  if (/indian|hindi|india/.test(text)) points += 3;
  if (language.code === "te" && /telugu/.test(text)) points += 3;
  if (/warm|soft|calm|gentle|kind/.test(text)) points += 1;
  if (/male\b/.test(labels) && !/female/.test(labels)) points -= 10;
  return points;
}

const candidates = voices
  .map((voice) => ({ voice, points: score(voice) }))
  .filter(({ points }) => points > 0)
  .sort((a, b) => b.points - a.points)
  .slice(0, count);

if (candidates.length === 0) {
  console.error("No female voices in this ElevenLabs library. Add some from the Voice Library first.");
  process.exit(1);
}

const outDir = join("spike", "out", `voices-${language.code}`);
await mkdir(outDir, { recursive: true });
console.log(`Auditioning ${candidates.length} voice(s) for ${language.name} (${language.elevenLabs.modelId})\n`);

for (const [index, { voice }] of candidates.entries()) {
  const tts = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice.voice_id}`, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({
      text: AUDITION,
      model_id: language.elevenLabs.modelId,
      voice_settings: { stability: 0.6, similarity_boost: 0.8, style: 0.15 },
    }),
  });
  if (!tts.ok) {
    console.error(`  ${voice.name}: failed (${tts.status})`);
    continue;
  }
  const safeName = voice.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const path = join(outDir, `${index + 1}-${safeName}-${voice.voice_id}.mp3`);
  await writeFile(path, Buffer.from(await tts.arrayBuffer()));
  console.log(`  ${index + 1}. ${voice.name}  (${voice.voice_id})\n     ${path}`);
}

console.log(`\nListen, pick one, and set its id as ${language.code}.elevenLabs.voiceId in packages/core/src/languages.ts.`);
