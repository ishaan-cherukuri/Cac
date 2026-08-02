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
import {
  buildSystemPrompt,
  buildTurnInstruction,
  parseTurnJudgement,
  vetLine,
  resolveTurn,
  applyOutcome,
  resumeSession,
  MAX_ATTEMPTS_PER_TURN,
  type Difficulty,
  type SessionState,
} from "../../../packages/core/src/index.ts";

const TARGET_LANGUAGE = "te";

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

/**
 * Chunked base64. Spreading a whole audio buffer into String.fromCharCode overflows the
 * call stack somewhere around 100-200KB depending on runtime — which is well inside the
 * size of a single spoken sentence, so the naive version fails in production, not in test.
 */
function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
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

async function synthesize(text: string, openai: OpenAI): Promise<Uint8Array> {
  const elevenLabsKey = Deno.env.get("ELEVENLABS_API_KEY");
  const voiceId = Deno.env.get("ELEVENLABS_VOICE_ID");

  if (elevenLabsKey && voiceId) {
    try {
      // The /stream endpoint, not the plain one. Benchmarked 2026-07-30 on Telugu:
      //   plain:  5.45s to first byte, 6.24s total
      //   stream: 1.00s to first byte, 3.83s total
      // We still buffer the whole clip here, so we bank the 2.4s total improvement but
      // not the 4.5s first-byte win. Capturing that too means streaming the response
      // through to the client instead of returning base64 — worth doing for free-form
      // replies, where time-to-first-audio is what the user actually feels.
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`, {
        method: "POST",
        headers: {
          "xi-api-key": elevenLabsKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          // Only eleven_v3 supports Telugu — see packages/core notes and spike/README.md.
          model_id: Deno.env.get("ELEVENLABS_MODEL_ID") ?? "eleven_v3",
          voice_settings: { stability: 0.6, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true },
        }),
      });
      if (response.ok) return new Uint8Array(await response.arrayBuffer());
      // Fall through to OpenAI rather than failing the turn.
    } catch {
      // Same — a TTS provider outage must not end the conversation.
    }
  }

  const speech = await openai.audio.speech.create({
    model: Deno.env.get("OPENAI_TTS_MODEL") ?? "gpt-4o-mini-tts",
    voice: Deno.env.get("OPENAI_TTS_VOICE") ?? "shimmer",
    input: text,
    instructions:
      "Speak as a warm, unhurried Telugu grandmother talking to a grandchild she loves. " +
      "Gentle pace, natural pauses. Not a narrator, not a teacher.",
  });
  return new Uint8Array(await speech.arrayBuffer());
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
    .select("id, user_id, difficulty, started_at, completed_at, turns_completed, current_turn, topics(title, scenario_description, turns)")
    .eq("id", sessionId)
    .single();

  // RLS makes someone else's session indistinguishable from a missing one, which is
  // exactly what we want to leak.
  if (error || !data) throw new HttpError(404, "Session not found");
  return data;
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
    title: string;
    scenario_description: string;
    turns: TopicTurn[];
  } | null;
  if (!topic) throw new HttpError(500, "Session has no topic");

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
    language: TARGET_LANGUAGE,
  }));
  const transcript = transcription.text.trim();

  // --- 2. Moderate before the transcript reaches the conversation model ----------
  const flagged = await time("moderation", () => isFlagged(openai, transcript));

  // --- 3. Ammamma judges the answer AND replies, in one call --------------------
  // Ordering matters: the reply depends on whether the answer landed, so the model has
  // to judge first. Doing it as two calls would double per-turn latency, which is
  // already this app's worst problem, so it returns both in one JSON object.
  const currentTopicTurn = topic.turns[Math.min(resumed.state.currentTurn - 1, topic.turns.length - 1)];
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
          expectedAnswerNative: currentTopicTurn?.model_answer_native ?? "",
          mayReAsk,
        }),
      },
    ],
  }));

  const judgement = parseTurnJudgement(completion.choices[0]?.message?.content ?? "");

  // Moderation-flagged speech is treated as not understood so Ammamma simply re-asks
  // rather than engaging with it. A malformed judgement counts as understood — see
  // parseTurnJudgement for why advancing is the kinder failure.
  const understood = flagged ? false : (judgement?.understood ?? true);

  // --- 4. Decide advance / retry -------------------------------------------------
  const outcome = resolveTurn(resumed.state, understood);
  const progress = applyOutcome(resumed.state, outcome, now);

  // --- 5. Outbound vetting: payment references, cold tone, empty generations -----
  const vetted = vetLine(judgement?.reply ?? "");

  // --- 6. Speak it --------------------------------------------------------------
  const speech = await time("tts", () => synthesize(vetted.text, openai));

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
    audioBase64: toBase64(speech),
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
