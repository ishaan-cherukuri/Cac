/**
 * SPEC step 1 — prove the tech loop before any app code exists.
 *
 *   Telugu audio in -> Whisper -> chat -> TTS -> audio out
 *
 * Success criterion (SPEC section 7): Whisper transcribes accented heritage-speaker
 * Telugu at >80% intelligibility AND the TTS output sounds like a person. If either
 * fails, the correct response is to change providers or change language — not to
 * start building the app anyway.
 *
 * Usage:
 *   npm run spike -- --audio path/to/recording.m4a
 *   npm run spike -- --audio recording.m4a --difficulty hard
 *   npm run spike -- --make-sample          # synthetic clip, plumbing check only
 */

import { mkdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { existsSync } from "node:fs";
import OpenAI from "openai";
import { loadConfig, resolveTtsProvider, TARGET_LANGUAGE_NAME } from "./config.ts";
import { transcribeAll, describeError, type TranscriptionResult } from "./stt.ts";
import { createOpenAiChatProvider } from "./chat.ts";
import { synthesize } from "./tts.ts";
import type { Difficulty } from "@shared/core";

const OUT_DIR = resolve(import.meta.dirname, "../out");
const SAMPLES_DIR = resolve(import.meta.dirname, "../samples");

/** A line an actual heritage speaker might attempt — used only for the synthetic sample. */
const SAMPLE_LINE = "అమ్మమ్మా, నేను ఈరోజు ఆఫీసుకి వెళ్ళాను. చాలా పని ఉంది.";

const TOPIC = {
  language: "te",
  topicTitle: "Tell your grandmother about your day",
  scenarioDescription:
    "Your grandmother has called to check in, the way she does most evenings. She wants to hear about your day.",
} as const;

interface Args {
  audioPath: string | null;
  difficulty: Difficulty;
  makeSample: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { audioPath: null, difficulty: "medium", makeSample: false };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === undefined) continue;

    // A bare path is accepted as well as --audio. Nested `npm run` is prone to eating
    // flags it mistakes for its own config, so the positional form is the reliable one.
    if (!flag.startsWith("--")) {
      args.audioPath ??= flag;
    } else if (flag === "--audio") {
      args.audioPath = argv[++i] ?? null;
    } else if (flag === "--difficulty") {
      const value = argv[++i];
      if (value !== "easy" && value !== "medium" && value !== "hard") {
        throw new Error(`--difficulty must be easy, medium, or hard (got: ${value ?? "nothing"})`);
      }
      args.difficulty = value;
    } else if (flag === "--make-sample") {
      args.makeSample = true;
    }
  }

  return args;
}

/**
 * Where a user-supplied audio path might actually live.
 *
 * `npm run -w spike` executes with cwd set to `spike/`, so a path typed at the repo root
 * ("spike/samples/x.m4a") would otherwise resolve to "spike/spike/samples/x.m4a". npm
 * exposes the directory the command was typed in as INIT_CWD, which is the one that
 * matches user intent.
 */
function candidateAudioPaths(audioPath: string): string[] {
  const repoRoot = resolve(import.meta.dirname, "../..");
  const bases = [process.env.INIT_CWD, process.cwd(), repoRoot].filter(
    (base): base is string => typeof base === "string",
  );
  return [...new Set(bases.map((base) => resolve(base, audioPath)))];
}

function resolveAudioPath(audioPath: string): string | null {
  return candidateAudioPaths(audioPath).find((candidate) => existsSync(candidate)) ?? null;
}

function heading(title: string): void {
  console.log(`\n${"─".repeat(64)}\n${title}\n${"─".repeat(64)}`);
}

/**
 * Generate a synthetic Telugu clip so the pipeline can be exercised end to end
 * without a real recording.
 *
 * This does NOT satisfy the SPEC step 1 success criterion. Synthetic speech is clean,
 * evenly paced, and natively accented — precisely the opposite of the halting,
 * English-inflected speech this app exists to handle. It proves the wiring works.
 * Only a real heritage speaker's recording proves the product works.
 */
async function makeSample(client: OpenAI, config: ReturnType<typeof loadConfig>): Promise<string> {
  heading("Generating synthetic sample (plumbing check only)");
  const { provider } = resolveTtsProvider(config);
  const { result } = await synthesize(SAMPLE_LINE, client, config, provider);

  await mkdir(SAMPLES_DIR, { recursive: true });
  const path = join(SAMPLES_DIR, "synthetic-te.mp3");
  await writeFile(path, result.audio);

  console.log(`  Text  : ${SAMPLE_LINE}`);
  console.log(`  Voice : ${result.provider} (${result.model})`);
  console.log(`  Saved : ${path}`);
  console.log(
    `\n  ⚠️  Synthetic audio cannot validate Whisper on heritage speech.\n` +
      `     Record a real speaker before trusting any result from this file.`,
  );
  return path;
}

function reportTranscriptions(
  results: Awaited<ReturnType<typeof transcribeAll>>,
): TranscriptionResult | null {
  heading("1. Transcription (Whisper) — the make-or-break step");

  let best: TranscriptionResult | null = null;
  for (const result of results) {
    if ("error" in result) {
      console.log(`  ✗ ${result.model.padEnd(20)} ${result.error}`);
      continue;
    }
    console.log(`  ✓ ${result.model.padEnd(20)} ${result.latencyMs}ms`);
    console.log(`      ${result.text || "<empty transcript>"}`);
    best ??= result;
  }

  if (best) {
    console.log(
      `\n  Judge this yourself against the recording: is >80% of the meaning intact?\n` +
        `  An empty or English-language transcript means Whisper failed on ${TARGET_LANGUAGE_NAME}.`,
    );
  }
  return best;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const client = new OpenAI({ apiKey: config.openaiApiKey });
  const chatModel = process.env.OPENAI_CHAT_MODEL?.trim() || "gpt-4o";

  await mkdir(OUT_DIR, { recursive: true });

  let audioPath = args.audioPath;
  if (args.makeSample) {
    audioPath = await makeSample(client, config);
  }

  if (!audioPath) {
    console.error(
      "\nNo input audio.\n\n" +
        "  Real validation (what SPEC step 1 actually requires):\n" +
        "    npm run spike -- --audio path/to/heritage-speaker-recording.m4a\n\n" +
        "  Plumbing check with synthetic audio (does not validate the criterion):\n" +
        "    npm run spike -- --make-sample\n",
    );
    process.exitCode = 1;
    return;
  }

  const inputPath = resolveAudioPath(audioPath);
  if (!inputPath) {
    console.error(
      `\nAudio file not found: ${audioPath}\n\n` +
        `  Looked in:\n` +
        candidateAudioPaths(audioPath)
          .map((candidate) => `    ${candidate}\n`)
          .join(""),
    );
    process.exitCode = 1;
    return;
  }

  console.log(`\nInput      : ${basename(inputPath)}`);
  console.log(`Difficulty : ${args.difficulty}`);
  console.log(`Topic      : ${TOPIC.topicTitle}`);

  // ---- 1. Transcribe --------------------------------------------------------
  const transcriptions = await transcribeAll(client, inputPath);
  const best = reportTranscriptions(transcriptions);
  if (!best) {
    console.error("\nEvery transcription model failed. Cannot continue.\n");
    process.exitCode = 1;
    return;
  }

  // ---- 2. The grandmother's next turn ----------------------------------------------
  heading("2. Conversation turn");
  const chat = createOpenAiChatProvider(client, chatModel);
  const reply = await chat.respond({
    ...TOPIC,
    difficulty: args.difficulty,
    history: [{ role: "user", content: best.text }],
  });

  console.log(`  Provider : ${chat.name} (${reply.latencyMs}ms)`);
  if (reply.rejected) {
    console.log(`  ⚠️  Outbound check "${reply.rejected}" tripped — response replaced. Investigate the prompt.`);
  }
  console.log(`\n  Grandmother: ${reply.text}`);

  // ---- 3. Speak it back -----------------------------------------------------
  heading("3. Synthesis");
  const { provider, reason } = resolveTtsProvider(config);
  console.log(`  Preferred: ${provider} (${reason})`);

  const { result: speech, fellBackBecause } = await synthesize(reply.text, client, config, provider);
  if (fellBackBecause) {
    console.log(`  ⚠️  ElevenLabs failed, fell back to OpenAI TTS:\n      ${fellBackBecause}`);
  }

  const outPath = join(OUT_DIR, `grandmother-${args.difficulty}.mp3`);
  await writeFile(outPath, speech.audio);
  console.log(`  Voice    : ${speech.provider} (${speech.model}) ${speech.latencyMs}ms`);
  console.log(`  Saved    : ${outPath}`);

  // ---- Verdict --------------------------------------------------------------
  const totalMs = best.latencyMs + reply.latencyMs + speech.latencyMs;
  heading("Verdict");
  console.log(`  Round-trip latency: ${(totalMs / 1000).toFixed(1)}s`);
  console.log(
    `  Over ~4s per turn will feel broken in a 5-minute session — check this before shipping.\n`,
  );
  console.log(`  Now listen to the output and answer honestly:`);
  console.log(`    1. Did Whisper capture what the speaker actually said?`);
  console.log(`    2. Does the audio sound like a Telugu grandmother, or a robot reading Telugu?`);
  console.log(`\n  Both yes -> proceed to SPEC step 2.`);
  console.log(`  Either no -> change provider or reconsider the launch language. Do not build on it.\n`);
}

main().catch((error: unknown) => {
  console.error(`\n${describeError(error)}\n`);
  process.exitCode = 1;
});
