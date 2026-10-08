import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createSpeakHandler } from "./handler.ts";
import { signSpeechToken } from "../_shared/speech-token.ts";

const SECRET = "test-secret";
const NOW = Date.UTC(2026, 9, 8, 12, 0, 0);

interface Call {
  url: string;
  body: Record<string, unknown>;
}

function setup(env: Record<string, string>, upstream: (url: string) => Response) {
  const calls: Call[] = [];
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
    return upstream(url);
  }) as typeof fetch;

  const handler = createSpeakHandler({
    env: (name) => ({ SPEECH_SIGNING_SECRET: SECRET, OPENAI_API_KEY: "sk-test", ...env })[name],
    fetch: fakeFetch,
    now: () => NOW,
  });
  return { handler, calls };
}

const audio = () => new Response(new Uint8Array([0xff, 0xfb]), { status: 200 });

async function speakRequest(text: string, language: string) {
  const token = await signSpeechToken(SECRET, { text, language }, NOW);
  return new Request(`https://example.test/functions/v1/speak?token=${encodeURIComponent(token)}`);
}

describe("GET /speak", () => {
  test("happy path: streams ElevenLabs audio in the Telugu voice", async () => {
    const { handler, calls } = setup({ ELEVENLABS_API_KEY: "el-test" }, audio);

    const response = await handler(await speakRequest("సరే కన్నా", "te"));

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Type"), "audio/mpeg");
    assert.match(calls[0]?.url ?? "", /elevenlabs.*TLhTqATJ3nsbNZKRJQB3\/stream/);
    assert.equal(calls[0]?.body.text, "సరే కన్నా");
  });

  test("a language with no chosen voice goes to the OpenAI fallback, never a wrong voice", async () => {
    const { handler, calls } = setup({ ELEVENLABS_API_KEY: "el-test" }, audio);

    const response = await handler(await speakRequest("होली है!", "hi"));

    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
    assert.match(calls[0]?.url ?? "", /api\.openai\.com/);
    assert.match(String(calls[0]?.body.instructions), /Hindi-speaking grandmother/);
  });

  test("a per-language env voice overrides the profile", async () => {
    const { handler, calls } = setup(
      { ELEVENLABS_API_KEY: "el-test", ELEVENLABS_VOICE_ID_HI: "hindi-voice" },
      audio,
    );
    await handler(await speakRequest("होली है!", "hi"));
    assert.match(calls[0]?.url ?? "", /hindi-voice\/stream/);
  });

  test("falls back to OpenAI when ElevenLabs errors", async () => {
    const { handler, calls } = setup({ ELEVENLABS_API_KEY: "el-test" }, (url) =>
      url.includes("elevenlabs") ? new Response("quota", { status: 429 }) : audio(),
    );
    const response = await handler(await speakRequest("సరే", "te"));
    assert.equal(response.status, 200);
    assert.equal(calls.length, 2);
  });

  test("a missing token is a 400, a bad one a 403, and neither calls a provider", async () => {
    const { handler, calls } = setup({}, audio);
    assert.equal((await handler(new Request("https://example.test/speak"))).status, 400);
    assert.equal((await handler(new Request("https://example.test/speak?token=x.y"))).status, 403);
    assert.equal(calls.length, 0);
  });

  test("both providers failing is a 502", async () => {
    const { handler } = setup({}, () => new Response("down", { status: 503 }));
    assert.equal((await handler(await speakRequest("సరే", "te"))).status, 502);
  });
});
