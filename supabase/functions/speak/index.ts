/**
 * GET /functions/v1/speak?token=... — streams Ammamma's voice.
 *
 * This exists so audio can start playing before it has finished generating. The old
 * design returned the whole clip base64-encoded inside the /turn JSON, which meant the
 * user heard nothing until the last syllable had been synthesized and encoded — about
 * 15 seconds. ElevenLabs emits its first bytes ~1s in (measured), and those bytes are
 * playable immediately, so piping the stream straight through turns a 15s wait into
 * roughly 1s of silence.
 *
 * Deliberately a GET with the credential in the query string: the phone hands this URL
 * to its audio player, and players do not reliably attach custom headers. See
 * _shared/speech-token.ts.
 */

import { verifySpeechToken } from "../_shared/speech-token.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, range",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Server misconfigured: ${name} is not set`);
  return value;
}

/**
 * Falls back to OpenAI TTS when ElevenLabs errors. OpenAI's response is also a stream, so
 * the fallback keeps the same start-early behaviour rather than silently reverting to a
 * buffered clip.
 */
async function openAiStream(text: string): Promise<Response> {
  return await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireEnv("OPENAI_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: Deno.env.get("OPENAI_TTS_MODEL") ?? "gpt-4o-mini-tts",
      voice: Deno.env.get("OPENAI_TTS_VOICE") ?? "shimmer",
      input: text,
      response_format: "mp3",
      instructions:
        "Speak as a warm, unhurried Telugu grandmother talking to a grandchild she loves.",
    }),
  });
}

async function elevenLabsStream(text: string): Promise<Response | null> {
  const key = Deno.env.get("ELEVENLABS_API_KEY");
  const voiceId = Deno.env.get("ELEVENLABS_VOICE_ID");
  if (!key || !voiceId) return null;

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`,
    {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({
        text,
        // Only eleven_v3 supports Telugu. It is the slowest model, but streaming makes
        // its time-to-first-byte competitive — see scripts/bench-tts.mjs.
        model_id: Deno.env.get("ELEVENLABS_MODEL_ID") ?? "eleven_v3",
        voice_settings: { stability: 0.6, similarity_boost: 0.8, style: 0.15 },
      }),
    },
  );

  return response.ok ? response : null;
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  try {
    const token = new URL(request.url).searchParams.get("token");
    if (!token) return new Response("Missing token", { status: 400, headers: CORS_HEADERS });

    const verified = await verifySpeechToken(requireEnv("SPEECH_SIGNING_SECRET"), token);
    if (!verified) {
      // Expired or tampered. Both are 403 — distinguishing them tells an attacker which.
      return new Response("Invalid or expired token", { status: 403, headers: CORS_HEADERS });
    }

    const upstream = (await elevenLabsStream(verified.text)) ?? (await openAiStream(verified.text));
    if (!upstream.ok || !upstream.body) {
      return new Response("Speech generation failed", { status: 502, headers: CORS_HEADERS });
    }

    // Pipe the body straight through — never await the full buffer, or the whole point
    // of this endpoint is lost.
    return new Response(upstream.body, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("speak failed:", error);
    return new Response("Something went wrong on our side.", {
      status: 500,
      headers: CORS_HEADERS,
    });
  }
});
