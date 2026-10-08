/**
 * POST /functions/v1/turn — SPEC step 5, the AI orchestration endpoint.
 *
 *   user audio -> Whisper -> moderation -> chat -> outbound vetting -> TTS -> audio
 *
 * This handler is deliberately thin. Every decision that can be wrong (the 5-minute cap,
 * retry-vs-advance, whether a generated line is shippable) lives in `packages/core`,
 * which is dependency-free and unit-tested under Node. Deno runs the same code.
 *
 * SPEC section 10 constraints honoured here:
 *   - the client never talks to OpenAI; keys exist only in this process
 *   - user audio is transcribed and DISCARDED, never written to storage or the database
 *   - session state is read from and written to the database, so an app kill loses nothing
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import OpenAI from "npm:openai@6";
import { signSpeechToken } from "../_shared/speech-token.ts";
import {
  buildSystemPrompt,
  buildTurnInstruction,
  parseTurnJudgement,
  vetLine,
  resolveTurn,
  applyOutcome,
  resumeSession,
  MAX_ATTEMPTS_PER_TURN,
  languageProfile,
  findSpokenVocab,
  type SpokenVocab,
  type Difficulty,
} from "../../../packages/core/src/index.ts";

interface TurnRequestMeta {
  sessionId: string;
  /** The user's turn as the client knows it — used to detect a stale retry. */
  clientTurn: number;
}

interface TopicTurn {
  turn_number: number;
  ai_prompt_native: string;
  ai_prompt_translit: string;
  ai_prompt_english: string;
  model_answer_native: string;
  model_answer_translit: string;
  model_answer_english: string;
  key_vocab: string[];
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new HttpError(500, `Server misconfigured: ${name} is not set`);
  return value;
}

/**
 * SPEC section 9: user-submitted audio must be moderated before it reaches the
 * conversation model. We moderate the transcript rather than the audio, which is what
 * the moderation endpoint accepts.
 *
 * Failing open here is deliberate: a moderation outage should not break a grandmother
 * conversation for every user. The blast radius of a missed edge case is one AI reply
 * that the outbound `vetLine` check still has to clear.
 */
async function isFlagged(client: OpenAI, text: string): Promise<boolean> {
  if (text.trim().length === 0) return false;
  try {
    const result = await client.moderations.create({
      model: "omni-moderation-latest",
      input: text,
    });
    return result.results[0]?.flagged ?? false;
  } catch {
    return false;
  }
}

async function parseRequest(request: Request): Promise<{ meta: TurnRequestMeta; audio: File }> {
  const form = await request.formData().catch(() => {
    throw new HttpError(400, "Expected multipart/form-data with `audio` and `meta` fields");
  });

  const rawMeta = form.get("meta");
  const audio = form.get("audio");

  if (typeof rawMeta !== "string") throw new HttpError(400, "Missing `meta` field");
  if (!(audio instanceof File)) throw new HttpError(400, "Missing `audio` file");

  let meta: TurnRequestMeta;
  try {
    meta = JSON.parse(rawMeta) as TurnRequestMeta;
  } catch {
    throw new HttpError(400, "`meta` is not valid JSON");
  }
  if (typeof meta.sessionId !== "string" || typeof meta.clientTurn !== "number") {
    throw new HttpError(400, "`meta` must contain sessionId (string) and clientTurn (number)");
  }

  return { meta, audio };
}

/** Loads the session and its topic, enforcing ownership via the caller's RLS context. */
async function loadSession(supabase: SupabaseClient, sessionId: string) {
  const { data, error } = await supabase
    .from("sessions")
    .select("id, user_id, topic_id, difficulty, started_at, completed_at, turns_completed, current_turn, topics(target_language, title, scenario_description, turns)")
    .eq("id", sessionId)
    .single();

  // RLS makes someone else's session indistinguishable from a missing one, which is
  // exactly what we want to leak.
  if (error || !data) throw new HttpError(404, "Session not found");
  return data;
}

/**
 * Records the vocab the user just said. Insert-or-ignore, so the first time a word was
 * said is kept; `.select()` then returns only the rows that were new.
 *
 * Never throws: "Words you've said" is a keepsake, and a failed write must not cost the
 * user the conversation turn.
 */
async function recordSpokenWords(
  supabase: SupabaseClient,
  row: { userId: string; language: string; topicId: string; turnNumber: number },
  words: SpokenVocab[],
): Promise<SpokenVocab[]> {
  if (words.length === 0) return [];
  const { data, error } = await supabase
    .from("spoken_words")
    .upsert(
      words.map((word) => ({
        user_id: row.userId,
        language: row.language,
        word_native: word.native,
        word_translit: word.translit,
        meaning: word.meaning,
        topic_id: row.topicId,
        turn_number: row.turnNumber,
        vocab_index: word.index,
      })),
      { onConflict: "user_id,language,word_native", ignoreDuplicates: true },
    )
    .select("word_native");

  if (error) {
    console.error("spoken_words write failed:", error.message);
    return [];
  }
  const inserted = new Set((data ?? []).map((saved) => saved.word_native as string));
  return words.filter((word) => inserted.has(word.native));
}

async function handle(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (request.method !== "POST") throw new HttpError(405, "Use POST");

  const authorization = request.headers.get("Authorization");
  if (!authorization) throw new HttpError(401, "Missing Authorization header");

  const supabase = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });

  const openai = new OpenAI({ apiKey: requireEnv("OPENAI_API_KEY") });
  const { meta, audio } = await parseRequest(request);
  const session = await loadSession(supabase, meta.sessionId);

  // deno-lint-ignore no-explicit-any
  const topic = (session as any).topics as {
    target_language: string;
    title: string;
    scenario_description: string;
    turns: TopicTurn[];
  } | null;
  if (!topic) throw new HttpError(500, "Session has no topic");
  const language = languageProfile(topic.target_language);

  const now = Date.now();

  // --- The 5-minute cap, before we spend a cent on inference --------------------
  const resumed = resumeSession(
    {
      startedAt: new Date(session.started_at as string).getTime(),
      currentTurn: session.current_turn as number,
      turnsCompleted: session.turns_completed as number,
      totalTurns: topic.turns.length,
      completedAt: session.completed_at ? new Date(session.completed_at as string).getTime() : null,
    },
    now,
  );

  if (resumed.ended || resumed.state.completedAt !== null) {
    await supabase
      .from("sessions")
      .update({ completed_at: new Date(resumed.state.completedAt ?? now).toISOString() })
      .eq("id", meta.sessionId);

    return json({ status: "ended", reason: resumed.ended ?? "topic_complete" });
  }

  // Per-stage timing. Round-trip latency is a product constraint (SPEC step 1 warns
  // anything over ~4s feels broken), and "it's slow" is not actionable without knowing
  // which of the three provider calls is responsible.
  const timings: Record<string, number> = {};
  const time = async <T>(stage: string, work: () => Promise<T>): Promise<T> => {
    const startedAt = Date.now();
    try {
      return await work();
    } finally {
      timings[stage] = Date.now() - startedAt;
    }
  };

  // --- 1. Transcribe. The audio is never persisted. -----------------------------
  const transcription = await time("stt", () => openai.audio.transcriptions.create({
    file: audio,
    // NOT whisper-1: it rejects Telugu with "400 Language 'te' is not supported".
    model: Deno.env.get("OPENAI_STT_MODEL") ?? "gpt-4o-transcribe",
    language: language.code,
  }));
  const transcript = transcription.text.trim();

  // --- 2. Moderate BEFORE the transcript reaches the conversation model -----------
  // These stay sequential on purpose. Running them concurrently would save ~1s, but it
  // would also send unmoderated user speech to the chat model, and SPEC section 9 makes
  // "filtered for harmful content before the model processes it" an App Review
  // requirement. The latency that mattered was the ~8s of TTS, which is gone entirely.
  const flagged = await time("moderation", () => isFlagged(openai, transcript));

  const currentTopicTurn = topic.turns[Math.min(resumed.state.currentTurn - 1, topic.turns.length - 1)];

  // --- 3a. Words they actually said ---------------------------------------------
  // Runs alongside the chat call rather than before it: it is off the critical path.
  // Flagged speech records nothing. Only the dictionary entry is stored, never the
  // transcript around it.
  const spokenWords = flagged ? [] : findSpokenVocab(transcript, currentTopicTurn?.key_vocab ?? []);
  const newWordsPromise = time("words", () =>
    recordSpokenWords(
      supabase,
      {
        userId: session.user_id as string,
        language: language.code,
        topicId: session.topic_id as string,
        turnNumber: currentTopicTurn?.turn_number ?? resumed.state.currentTurn,
      },
      spokenWords,
    ));

  // --- 3b. The grandmother judges the answer AND replies, in one call --------------
  // The reply depends on whether the answer landed, so the model must judge first.
  // Two calls would double per-turn latency, so it returns both in one JSON object.
  const difficulty = session.difficulty as Difficulty;
  const mayReAsk = resumed.state.attemptsOnCurrentTurn + 1 < MAX_ATTEMPTS_PER_TURN;

  const completion = await time("chat", () => openai.chat.completions.create({
    model: Deno.env.get("OPENAI_CHAT_MODEL") ?? "gpt-4o",
    temperature: 0.8,
    // Every extra sentence costs TTS time on the critical path, and SPEC 3.1 caps a turn
    // at two or three sentences anyway. Keeping this tight is a latency lever, not just
    // a style choice. Raised slightly from 120 to leave room for the JSON wrapper.
    max_tokens: 200,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: buildSystemPrompt({
          language: language.code,
          difficulty,
          topicTitle: topic.title,
          scenarioDescription: topic.scenario_description,
        }),
      },
      { role: "assistant", content: currentTopicTurn?.ai_prompt_native ?? "" },
      { role: "user", content: flagged ? "" : transcript },
      {
        role: "system",
        content: buildTurnInstruction({
          language: language.code,
          expectedAnswerNative: currentTopicTurn?.model_answer_native ?? "",
          mayReAsk,
        }),
      },
    ],
  }));

  const judgement = parseTurnJudgement(completion.choices[0]?.message?.content ?? "");
  const newWords = await newWordsPromise;

  // Moderation-flagged speech is treated as not understood so she simply re-asks
  // rather than engaging with it. A malformed judgement counts as understood — see
  // parseTurnJudgement for why advancing is the kinder failure.
  const understood = flagged ? false : (judgement?.understood ?? true);

  // --- 4. Decide advance / retry -------------------------------------------------
  const outcome = resolveTurn(resumed.state, understood);
  const progress = applyOutcome(resumed.state, outcome, now);

  // --- 5. Outbound vetting: payment references, cold tone, empty generations -----
  const vetted = vetLine(judgement?.reply ?? "", language.code);

  // --- 6. Hand back a URL instead of audio ---------------------------------------
  // No TTS here any more. Synthesizing the whole clip before responding was ~8s of the
  // old ~15s round trip, and none of it could be heard until it was completely finished.
  // The client points its player at this URL and audio begins in about a second.
  const speakToken = await signSpeechToken(requireEnv("SPEECH_SIGNING_SECRET"), {
    text: vetted.text,
    language: language.code,
  });
  const speakUrl = `${requireEnv("SUPABASE_URL")}/functions/v1/speak?token=${encodeURIComponent(speakToken)}`;

  // --- 7. Persist state so an app kill loses nothing ----------------------------
  await supabase
    .from("sessions")
    .update({
      current_turn: progress.state.currentTurn,
      turns_completed: progress.state.turnsCompleted,
      completed_at: progress.state.completedAt ? new Date(progress.state.completedAt).toISOString() : null,
    })
    .eq("id", meta.sessionId);

  return json({
    status: progress.ended ? "ended" : "continue",
    reason: progress.ended,
    outcome: outcome.kind,
    understood,
    transcript,
    reply: { text: vetted.text, rejected: vetted.rejected },
    speakUrl,
    // Everything said this turn, and the subset said for the first time ever.
    spokenWords: spokenWords.map(({ native, translit, meaning }) => ({ native, translit, meaning })),
    newWords: newWords.map(({ native }) => native),
    timings,
    session: {
      currentTurn: progress.state.currentTurn,
      turnsCompleted: progress.state.turnsCompleted,
      totalTurns: progress.state.totalTurns,
    },
  });
}

Deno.serve(async (request: Request) => {
  try {
    return await handle(request);
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    console.error("Unhandled error in /turn:", error);
    // Never leak internals to a client; the persona should never surface a stack trace.
    return json({ error: "Something went wrong on our side." }, 500);
  }
});
