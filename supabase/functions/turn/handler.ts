/**
 * POST /functions/v1/turn — SPEC step 5, the AI orchestration endpoint.
 *
 *   user audio -> transcribe -> moderation -> chat -> outbound vetting -> speak URL
 *
 * The handler takes its database and AI providers as arguments (`TurnDeps`) instead of
 * constructing them, so it runs unchanged under Deno in production (index.ts wires the
 * real Supabase and OpenAI clients) and under Node in tests (handler.test.ts passes
 * fakes). Nothing in this file imports a runtime-specific module.
 *
 * Every decision that can be wrong (the 5-minute cap, retry-vs-advance, whether a
 * generated line is shippable, which words were said) lives in `packages/core`.
 *
 * SPEC section 10 constraints honoured here:
 *   - the client never talks to OpenAI; keys exist only in this process
 *   - user audio is transcribed and DISCARDED, never written to storage or the database
 *   - session state is read from and written to the database, so an app kill loses nothing
 */

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
  type Difficulty,
  type LanguageCode,
  type SpokenVocab,
} from "../../../packages/core/src/index.ts";

export interface TopicTurn {
  turn_number: number;
  ai_prompt_native: string;
  ai_prompt_translit: string;
  ai_prompt_english: string;
  model_answer_native: string;
  model_answer_translit: string;
  model_answer_english: string;
  key_vocab: string[];
}

export interface SessionRow {
  id: string;
  user_id: string;
  topic_id: string;
  difficulty: Difficulty;
  started_at: string;
  completed_at: string | null;
  turns_completed: number;
  current_turn: number;
  topic: {
    target_language: string;
    title: string;
    scenario_description: string;
    turns: TopicTurn[];
  } | null;
}

export interface SessionPatch {
  current_turn?: number;
  turns_completed?: number;
  completed_at: string | null;
}

export interface SpokenWordRow {
  user_id: string;
  language: string;
  word_native: string;
  word_translit: string;
  meaning: string;
  topic_id: string;
  turn_number: number;
  vocab_index: number;
}

/** Database access, already scoped to the caller: RLS decides what each call can see. */
export interface TurnStore {
  /** Null when the session does not exist or belongs to someone else — RLS cannot tell them apart. */
  loadSession(sessionId: string): Promise<SessionRow | null>;
  updateSession(sessionId: string, patch: SessionPatch): Promise<void>;
  /** Insert-or-ignore. Returns the native forms of the rows that were new. */
  insertSpokenWords(rows: SpokenWordRow[]): Promise<string[]>;
}

export interface ChatMessage {
  role: "system" | "assistant" | "user";
  content: string;
}

export interface TurnAi {
  transcribe(audio: File, language: LanguageCode): Promise<string>;
  isFlagged(text: string): Promise<boolean>;
  /** Returns the raw JSON text of the model's {understood, reply}. */
  judge(messages: ChatMessage[]): Promise<string>;
}

export interface TurnDeps {
  /** Builds a store that acts as the caller, from their Authorization header. */
  storeFor(authorization: string): TurnStore;
  ai: TurnAi;
  speechSecret: string;
  /** Base URL the client will fetch /speak from. */
  functionsUrl: string;
  now?: () => number;
}

export class HttpError extends Error {
  // A plain field, not a `readonly status` parameter property: Node's type stripping
  // (which runs the tests) does not support parameter properties.
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const CORS_HEADERS = {
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

interface TurnRequestMeta {
  sessionId: string;
  /** The user's turn as the client knows it — used to detect a stale retry. */
  clientTurn: number;
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

/**
 * Records the vocab the user just said. Never throws: "Words you've said" is a keepsake,
 * and a failed write must not cost the user the conversation turn.
 */
async function recordSpokenWords(
  store: TurnStore,
  row: { userId: string; language: string; topicId: string; turnNumber: number },
  words: SpokenVocab[],
): Promise<SpokenVocab[]> {
  if (words.length === 0) return [];
  try {
    const inserted = new Set(
      await store.insertSpokenWords(
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
      ),
    );
    return words.filter((word) => inserted.has(word.native));
  } catch (error) {
    console.error("spoken_words write failed:", error);
    return [];
  }
}

async function handle(deps: TurnDeps, request: Request): Promise<Response> {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (request.method !== "POST") throw new HttpError(405, "Use POST");

  const authorization = request.headers.get("Authorization");
  if (!authorization) throw new HttpError(401, "Missing Authorization header");

  const store = deps.storeFor(authorization);
  const { ai } = deps;
  const { meta, audio } = await parseRequest(request);

  // RLS makes someone else's session indistinguishable from a missing one, which is
  // exactly what we want to leak.
  const session = await store.loadSession(meta.sessionId);
  if (!session) throw new HttpError(404, "Session not found");

  const topic = session.topic;
  if (!topic) throw new HttpError(500, "Session has no topic");
  const language = languageProfile(topic.target_language);

  const now = (deps.now ?? Date.now)();

  // --- The 5-minute cap, before we spend a cent on inference --------------------
  const resumed = resumeSession(
    {
      startedAt: new Date(session.started_at).getTime(),
      currentTurn: session.current_turn,
      turnsCompleted: session.turns_completed,
      totalTurns: topic.turns.length,
      completedAt: session.completed_at ? new Date(session.completed_at).getTime() : null,
    },
    now,
  );

  if (resumed.ended || resumed.state.completedAt !== null) {
    await store.updateSession(meta.sessionId, {
      completed_at: new Date(resumed.state.completedAt ?? now).toISOString(),
    });
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
  const transcript = (await time("stt", () => ai.transcribe(audio, language.code))).trim();

  // --- 2. Moderate BEFORE the transcript reaches the conversation model -----------
  // These stay sequential on purpose. Running them concurrently would save ~1s, but it
  // would also send unmoderated user speech to the chat model, and SPEC section 9 makes
  // "filtered for harmful content before the model processes it" an App Review
  // requirement. The latency that mattered was the ~8s of TTS, which is gone entirely.
  const flagged = await time("moderation", () => ai.isFlagged(transcript));

  const currentTopicTurn =
    topic.turns[Math.min(resumed.state.currentTurn - 1, topic.turns.length - 1)];

  // --- 3a. Words they actually said ---------------------------------------------
  // Runs alongside the chat call rather than before it: it is off the critical path.
  // Flagged speech records nothing. Only the dictionary entry is stored, never the
  // transcript around it.
  const spokenWords = flagged
    ? []
    : findSpokenVocab(transcript, currentTopicTurn?.key_vocab ?? []);
  const newWordsPromise = time("words", () =>
    recordSpokenWords(
      store,
      {
        userId: session.user_id,
        language: language.code,
        topicId: session.topic_id,
        turnNumber: currentTopicTurn?.turn_number ?? resumed.state.currentTurn,
      },
      spokenWords,
    ));

  // --- 3b. The grandmother judges the answer AND replies, in one call --------------
  // The reply depends on whether the answer landed, so the model must judge first.
  // Two calls would double per-turn latency, so it returns both in one JSON object.
  const mayReAsk = resumed.state.attemptsOnCurrentTurn + 1 < MAX_ATTEMPTS_PER_TURN;

  const rawJudgement = await time("chat", () =>
    ai.judge([
      {
        role: "system",
        content: buildSystemPrompt({
          language: language.code,
          difficulty: session.difficulty,
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
    ]));

  const judgement = parseTurnJudgement(rawJudgement);
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
  // No TTS here. Synthesizing the whole clip before responding was ~8s of the old ~15s
  // round trip, and none of it could be heard until it was completely finished. The
  // client points its player at this URL and audio begins in about a second.
  const speakToken = await signSpeechToken(
    deps.speechSecret,
    { text: vetted.text, language: language.code },
    now,
  );
  const speakUrl = `${deps.functionsUrl}/functions/v1/speak?token=${encodeURIComponent(speakToken)}`;

  // --- 7. Persist state so an app kill loses nothing ----------------------------
  await store.updateSession(meta.sessionId, {
    current_turn: progress.state.currentTurn,
    turns_completed: progress.state.turnsCompleted,
    completed_at: progress.state.completedAt
      ? new Date(progress.state.completedAt).toISOString()
      : null,
  });

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

export function createTurnHandler(deps: TurnDeps): (request: Request) => Promise<Response> {
  return async (request) => {
    try {
      return await handle(deps, request);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      console.error("Unhandled error in /turn:", error);
      // Never leak internals to a client; the persona should never surface a stack trace.
      return json({ error: "Something went wrong on our side." }, 500);
    }
  };
}
