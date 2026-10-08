/**
 * Pre-generates the grandmother's scripted audio and uploads it to Supabase Storage.
 *
 * Fixes two problems at once:
 *   1. The grandmother used to never SPEAK her question — the app shows text and waits.
 *      SPEC 3.1's loop is "AI speaks -> user records -> AI responds"; turn one had no voice.
 *   2. TTS is 6-17s of every turn. Scripted lines never change, so synthesizing them
 *      once takes TTS off the critical path entirely for easy and medium levels.
 *
 * Voice and model come from each topic's language profile (packages/core/src/languages.ts).
 * Telugu uses eleven_v3, the slowest ElevenLabs model but the only one that officially
 * supports Telugu; latency is irrelevant for audio generated ahead of time. A language
 * whose voice has not been chosen yet is skipped, not read with the wrong voice.
 *
 * What gets generated, per SPEC 3.1:
 *   - ai_prompt_native   -> every turn, every level (she always asks)
 *   - model_answer_native -> easy level only (she says the answer for the user to repeat)
 *   - each key_vocab word -> "Words you've said" plays it back in her voice
 *
 * Idempotent: skips anything already uploaded, so it is safe to re-run and resume after
 * a quota limit. Character cost is reported as it goes.
 *
 *   node --env-file=.env scripts/pregenerate-audio.mjs --limit 1     # prove it, one topic
 *   node --env-file=.env scripts/pregenerate-audio.mjs               # everything
 *   node --env-file=.env scripts/pregenerate-audio.mjs --prompts-only
 *   node --env-file=.env scripts/pregenerate-audio.mjs --language hi
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { languageProfile } from "../packages/core/src/languages.ts";
import { parseVocabEntry } from "../packages/core/src/spoken.ts";

const BUCKET = "topic-audio";
const TOPICS_DIR = "content/topics";

const args = process.argv.slice(2);
const limitIndex = args.indexOf("--limit");
const limit = limitIndex === -1 ? Infinity : Number(args[limitIndex + 1]);
const promptsOnly = args.includes("--prompts-only");
const dryRun = args.includes("--dry-run");
const languageIndex = args.indexOf("--language");
const onlyLanguage = languageIndex === -1 ? null : args[languageIndex + 1];

const elevenKey = process.env.ELEVENLABS_API_KEY;
if (!elevenKey) {
  console.error("Need ELEVENLABS_API_KEY in .env");
  process.exit(1);
}

/** Same precedence as the /speak function: per-language env, legacy Telugu env, profile. */
function voiceFor(language) {
  const profile = languageProfile(language);
  const voiceId =
    process.env[`ELEVENLABS_VOICE_ID_${profile.code.toUpperCase()}`] ??
    (profile.code === "te" ? process.env.ELEVENLABS_VOICE_ID : undefined) ??
    profile.elevenLabs.voiceId;
  return { voiceId, modelId: profile.elevenLabs.modelId };
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

/** Public, not signed. This is static app content with no user data in it — a public
 *  bucket is CDN-cacheable, which is the entire point of pre-generating. SPEC section 10
 *  specifies signed URLs for AI audio; that rule is about per-user turn audio, which is
 *  still returned inline by the Edge Function and never stored. */
async function ensureBucket() {
  const { data } = await supabase.storage.listBuckets();
  if (data?.some((b) => b.name === BUCKET)) return;
  const { error } = await supabase.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: "5MB",
    allowedMimeTypes: ["audio/mpeg"],
  });
  if (error && !/already exists/i.test(error.message)) throw new Error(error.message);
  console.log(`created public bucket "${BUCKET}"`);
}

async function synthesize(text, { voiceId, modelId }) {
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`,
    {
      method: "POST",
      headers: {
        "xi-api-key": elevenKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        voice_settings: { stability: 0.6, similarity_boost: 0.8, style: 0.15 },
      }),
    },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`ElevenLabs ${response.status}: ${detail.slice(0, 200)}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function alreadyUploaded(path) {
  const slash = path.lastIndexOf("/");
  const { data } = await supabase.storage
    .from(BUCKET)
    .list(path.slice(0, slash), { search: path.slice(slash + 1) });
  return Boolean(data?.length);
}

async function upload(path, bytes) {
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: "audio/mpeg", upsert: true });
  if (error) throw new Error(error.message);
}

// --- collect the work ---------------------------------------------------------

const files = (await readdir(TOPICS_DIR)).filter((f) => f.endsWith(".json")).sort();
const allTopics = [];
for (const file of files) {
  allTopics.push(...JSON.parse(await readFile(join(TOPICS_DIR, file), "utf8")));
}

const topics = [];
for (const topic of allTopics) {
  if (onlyLanguage && topic.target_language !== onlyLanguage) continue;
  if (!voiceFor(topic.target_language).voiceId) {
    console.warn(`skipping "${topic.title}": no voice chosen for ${topic.target_language} yet`);
    continue;
  }
  topics.push(topic);
}

const jobs = [];
for (const topic of topics.slice(0, limit)) {
  const voice = voiceFor(topic.target_language);
  for (const turn of topic.turns) {
    jobs.push({
      path: `${topic.id}/${turn.turn_number}-prompt.mp3`,
      text: turn.ai_prompt_native,
      kind: "prompt",
      voice,
    });
    if (!promptsOnly) {
      jobs.push({
        path: `${topic.id}/${turn.turn_number}-answer.mp3`,
        text: turn.model_answer_native,
        kind: "answer",
        voice,
      });
      // Path mirrors vocabAudioUrl in app/src/lib/audio.ts.
      turn.key_vocab.forEach((raw, index) => {
        const entry = parseVocabEntry(raw);
        if (!entry) return;
        jobs.push({
          path: `${topic.id}/${turn.turn_number}-vocab-${index}.mp3`,
          text: entry.native,
          kind: "vocab",
          voice,
        });
      });
    }
  }
}

const totalChars = jobs.reduce((sum, job) => sum + job.text.length, 0);
console.log(
  `${topics.slice(0, limit).length} topic(s), ${jobs.length} clip(s), ${totalChars} characters`,
);
const voices = [...new Set(jobs.map((job) => `${job.voice.modelId}/${job.voice.voiceId}`))];
console.log(`voices: ${voices.join(", ")}\n`);

if (dryRun) {
  console.log("--dry-run: nothing generated.");
  process.exit(0);
}

await ensureBucket();

let generated = 0;
let skipped = 0;
let charsSpent = 0;

for (const [index, job] of jobs.entries()) {
  const label = `[${index + 1}/${jobs.length}] ${job.path}`;

  if (await alreadyUploaded(job.path)) {
    skipped++;
    continue;
  }

  try {
    const audio = await synthesize(job.text, job.voice);
    await upload(job.path, audio);
    generated++;
    charsSpent += job.text.length;
    console.log(`${label}  ${Math.round(audio.length / 1024)}KB  (${job.text.length} chars)`);
  } catch (error) {
    console.error(`${label}  FAILED: ${error.message}`);
    // A quota wall stops the run rather than hammering a dead endpoint. Re-running
    // resumes exactly where this left off.
    if (/quota|limit|401|402|429/i.test(error.message)) {
      console.error(
        `\nStopped early. ${generated} clip(s) uploaded, ${charsSpent} characters spent.\n` +
          `Re-run after your quota resets and it will resume from here.`,
      );
      process.exit(1);
    }
  }
}

console.log(
  `\ngenerated ${generated}, skipped ${skipped} already present, ${charsSpent} characters spent.`,
);
const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(jobs[0].path);
console.log(`example URL: ${pub.publicUrl}`);
