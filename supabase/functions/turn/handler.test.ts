import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  createTurnHandler,
  type ChatMessage,
  type SessionPatch,
  type SessionRow,
  type SpokenWordRow,
  type TurnAi,
  type TurnStore,
} from "./handler.ts";
import { verifySpeechToken } from "../_shared/speech-token.ts";
import { LANGUAGES } from "../../../packages/core/src/languages.ts";

const SECRET = "test-secret";
const STARTED = Date.UTC(2026, 9, 8, 12, 0, 0);

function turn(n: number, vocab: string[] = []) {
  return {
    turn_number: n,
    ai_prompt_native: `ప్రశ్న ${n}`,
    ai_prompt_translit: `prashna ${n}`,
    ai_prompt_english: `Question ${n}`,
    model_answer_native: `జవాబు ${n}`,
    model_answer_translit: `javaabu ${n}`,
    model_answer_english: `Answer ${n}`,
    key_vocab: vocab,
  };
}

function session(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: "session-1",
    user_id: "user-1",
    topic_id: "topic-1",
    difficulty: "easy",
    started_at: new Date(STARTED).toISOString(),
    completed_at: null,
    turns_completed: 0,
    current_turn: 1,
    topic: {
      target_language: "te",
      title: "Ask your grandmother about her childhood",
      scenario_description: "She is in a talking mood.",
      turns: [turn(1, ["అవును (avunu) — yes"]), turn(2), turn(3), turn(4), turn(5)],
    },
    ...overrides,
  };
}

/** An in-memory store that records what the handler wrote. */
function fakeStore(row: SessionRow | null) {
  const updates: SessionPatch[] = [];
  const words: SpokenWordRow[] = [];
  const store: TurnStore = {
    loadSession: async () => row,
    updateSession: async (_id, patch) => {
      updates.push(patch);
    },
    insertSpokenWords: async (rows) => {
      const fresh = rows.filter((r) => !words.some((w) => w.word_native === r.word_native));
      words.push(...fresh);
      return fresh.map((r) => r.word_native);
    },
  };
  return { store, updates, words };
}

function fakeAi(overrides: Partial<TurnAi> & { transcript?: string; reply?: string } = {}) {
  const calls = { transcribe: 0, judge: [] as ChatMessage[][] };
  const ai: TurnAi = {
    transcribe: async () => {
      calls.transcribe++;
      return overrides.transcript ?? "అవును అమ్మమ్మా";
    },
    isFlagged: async () => false,
    judge: async (messages) => {
      calls.judge.push(messages);
      return overrides.reply ?? '{"understood": true, "reply": "బాగుంది కన్నా."}';
    },
    ...overrides,
  };
  return { ai, calls };
}

function turnRequest(meta: unknown = { sessionId: "session-1", clientTurn: 1 }, auth = true) {
  const form = new FormData();
  form.append("meta", JSON.stringify(meta));
  form.append("audio", new File([new Uint8Array([1, 2, 3])], "turn.m4a", { type: "audio/m4a" }));
  return new Request("https://example.test/functions/v1/turn", {
    method: "POST",
    headers: auth ? { Authorization: "Bearer user-jwt" } : {},
    body: form,
  });
}

function handlerWith(store: TurnStore, ai: TurnAi, now = STARTED + 30_000) {
  return createTurnHandler({
    storeFor: () => store,
    ai,
    speechSecret: SECRET,
    functionsUrl: "https://example.test",
    now: () => now,
  });
}

describe("POST /turn", () => {
  test("happy path: advances, replies with a signed speak URL, persists state", async () => {
    const { store, updates } = fakeStore(session());
    const { ai } = fakeAi();

    const response = await handlerWith(store, ai)(turnRequest());
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.status, "continue");
    assert.equal(body.outcome, "advance");
    assert.equal(body.reply.text, "బాగుంది కన్నా.");
    assert.equal(body.session.currentTurn, 2);
    assert.deepEqual(updates.at(-1), { current_turn: 2, turns_completed: 1, completed_at: null });

    const token = new URL(body.speakUrl).searchParams.get("token") ?? "";
    assert.deepEqual(await verifySpeechToken(SECRET, token, STARTED + 31_000), {
      text: "బాగుంది కన్నా.",
      language: "te",
    });
  });

  test("records only words that were actually in the transcript", async () => {
    const { store, words } = fakeStore(session());
    const { ai } = fakeAi({ transcript: "అవునండి" });

    const body = await (await handlerWith(store, ai)(turnRequest())).json();

    assert.deepEqual(body.newWords, ["అవును"]);
    assert.equal(words.length, 1);
    assert.equal(words[0]?.vocab_index, 0);
    assert.equal(words[0]?.turn_number, 1);
    // The transcript itself is never part of what is stored.
    assert.ok(!JSON.stringify(words).includes("అవునండి"));
  });

  test("a word said twice is new only the first time", async () => {
    const { store } = fakeStore(session());
    const handler = handlerWith(store, fakeAi().ai);

    const first = await (await handler(turnRequest())).json();
    const second = await (await handler(turnRequest())).json();

    assert.deepEqual(first.newWords, ["అవును"]);
    assert.deepEqual(second.newWords, []);
    assert.equal(second.spokenWords.length, 1, "still reported as said this turn");
  });

  test("a failed word write never costs the user the turn", async () => {
    const { store } = fakeStore(session());
    store.insertSpokenWords = async () => {
      throw new Error("database down");
    };
    const response = await handlerWith(store, fakeAi().ai)(turnRequest());
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).newWords, []);
  });

  test("moderation-flagged speech is re-asked, reaches the model empty, and records nothing", async () => {
    const { store, words } = fakeStore(session());
    const { ai, calls } = fakeAi({ isFlagged: async () => true });

    const body = await (await handlerWith(store, ai)(turnRequest())).json();

    assert.equal(body.understood, false);
    assert.equal(body.outcome, "retry");
    assert.equal(words.length, 0);
    const userMessage = calls.judge[0]?.find((message) => message.role === "user");
    assert.equal(userMessage?.content, "");
  });

  test("a cold or payment reply is replaced with the language's fallback line", async () => {
    const { store } = fakeStore(session());
    const { ai } = fakeAi({ reply: '{"understood": true, "reply": "Incorrect. Try again."}' });

    const body = await (await handlerWith(store, ai)(turnRequest())).json();

    assert.equal(body.reply.text, LANGUAGES.te.fallbackLine.native);
    assert.equal(body.reply.rejected, "cold_tone");
  });

  test("speaks Hindi to a Hindi topic", async () => {
    const hindi = session();
    hindi.topic = { ...hindi.topic!, target_language: "hi" };
    const { store } = fakeStore(hindi);
    let transcribedAs = "";
    const { ai, calls } = fakeAi({
      transcribe: async (_audio, language) => {
        transcribedAs = language;
        return "हाँ नानी";
      },
    });

    const body = await (await handlerWith(store, ai)(turnRequest())).json();

    assert.equal(transcribedAs, "hi");
    assert.match(calls.judge[0]?.[0]?.content ?? "", /You are Nani/);
    const token = new URL(body.speakUrl).searchParams.get("token") ?? "";
    assert.equal((await verifySpeechToken(SECRET, token, STARTED + 31_000))?.language, "hi");
  });

  test("past the 5-minute cap: ends without spending anything on AI", async () => {
    const { store, updates } = fakeStore(session());
    const { ai, calls } = fakeAi();

    const response = await handlerWith(store, ai, STARTED + 6 * 60 * 1000)(turnRequest());
    const body = await response.json();

    assert.equal(body.status, "ended");
    assert.equal(body.reason, "time_limit");
    assert.equal(calls.transcribe, 0);
    assert.equal(calls.judge.length, 0);
    assert.ok(updates.at(-1)?.completed_at);
  });

  test("someone else's (or a missing) session is a 404", async () => {
    const { store } = fakeStore(null);
    const response = await handlerWith(store, fakeAi().ai)(turnRequest());
    assert.equal(response.status, 404);
  });

  test("no Authorization header is a 401", async () => {
    const { store } = fakeStore(session());
    const response = await handlerWith(store, fakeAi().ai)(turnRequest(undefined, false));
    assert.equal(response.status, 401);
  });

  test("malformed meta is a 400, not a crash", async () => {
    const { store } = fakeStore(session());
    const response = await handlerWith(store, fakeAi().ai)(turnRequest({ sessionId: 42 }));
    assert.equal(response.status, 400);
  });

  test("an AI outage is a generic 500 that leaks nothing", async () => {
    const { store } = fakeStore(session());
    const { ai } = fakeAi({
      judge: async () => {
        throw new Error("upstream secret detail");
      },
    });
    const response = await handlerWith(store, ai)(turnRequest());
    assert.equal(response.status, 500);
    assert.doesNotMatch(await response.text(), /secret detail/);
  });
});
