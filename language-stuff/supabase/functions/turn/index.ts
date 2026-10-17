/**
 * POST /functions/v1/turn — production wiring.
 *
 * The logic lives in handler.ts, which takes its database and AI providers as
 * arguments. This file supplies the real ones: Supabase acting as the caller (so RLS
 * applies) and OpenAI for transcription, moderation and the conversation.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import OpenAI from "npm:openai@6";
import {
  createTurnHandler,
  CORS_HEADERS,
  HttpError,
  type SessionRow,
  type TurnAi,
  type TurnStore,
} from "./handler.ts";

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new HttpError(500, `Server misconfigured: ${name} is not set`);
  return value;
}

function supabaseStore(authorization: string): TurnStore {
  const supabase = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });

  return {
    async loadSession(sessionId) {
      const { data, error } = await supabase
        .from("sessions")
        .select(
          "id, user_id, topic_id, difficulty, started_at, completed_at, turns_completed, current_turn, " +
            "topic:topics(target_language, title, scenario_description, turns)",
        )
        .eq("id", sessionId)
        .single();
      if (error || !data) return null;
      return data as unknown as SessionRow;
    },

    async updateSession(sessionId, patch) {
      await supabase.from("sessions").update(patch).eq("id", sessionId);
    },

    async insertSpokenWords(rows) {
      // ignoreDuplicates makes this ON CONFLICT DO NOTHING, so the first time a word
      // was said is kept, and `.select()` returns only the rows that were new.
      const { data, error } = await supabase
        .from("spoken_words")
        .upsert(rows, { onConflict: "user_id,language,word_native", ignoreDuplicates: true })
        .select("word_native");
      if (error) throw new Error(error.message);
      return (data ?? []).map((row) => row.word_native as string);
    },
  };
}

function openAiProvider(): TurnAi {
  const openai = new OpenAI({ apiKey: requireEnv("OPENAI_API_KEY") });

  return {
    async transcribe(audio, language) {
      const result = await openai.audio.transcriptions.create({
        file: audio,
        // NOT whisper-1: it rejects Telugu with "400 Language 'te' is not supported".
        model: Deno.env.get("OPENAI_STT_MODEL") ?? "gpt-4o-transcribe",
        language,
      });
      return result.text;
    },

    /**
     * SPEC section 9: user-submitted audio must be moderated before it reaches the
     * conversation model. We moderate the transcript, which is what the endpoint takes.
     *
     * Failing open is deliberate: a moderation outage should not break a grandmother
     * conversation for every user. The blast radius of a missed edge case is one AI
     * reply that the outbound `vetLine` check still has to clear.
     */
    async isFlagged(text) {
      if (text.trim().length === 0) return false;
      try {
        const result = await openai.moderations.create({
          model: "omni-moderation-latest",
          input: text,
        });
        return result.results[0]?.flagged ?? false;
      } catch {
        return false;
      }
    },

    async judge(messages) {
      const completion = await openai.chat.completions.create({
        model: Deno.env.get("OPENAI_CHAT_MODEL") ?? "gpt-4o",
        temperature: 0.8,
        // Every extra sentence costs TTS time on the critical path, and SPEC 3.1 caps a
        // turn at two or three sentences anyway. Keeping this tight is a latency lever,
        // not just a style choice. Raised from 120 to leave room for the JSON wrapper.
        max_tokens: 200,
        response_format: { type: "json_object" },
        messages,
      });
      return completion.choices[0]?.message?.content ?? "";
    },
  };
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  try {
    const handler = createTurnHandler({
      storeFor: supabaseStore,
      ai: openAiProvider(),
      speechSecret: requireEnv("SPEECH_SIGNING_SECRET"),
      functionsUrl: requireEnv("SUPABASE_URL"),
    });
    return await handler(request);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    console.error("turn wiring failed:", error);
    return new Response(JSON.stringify({ error: "Something went wrong on our side." }), {
      status,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
