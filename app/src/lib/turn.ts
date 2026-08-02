/**
 * Client for the `turn` Edge Function.
 *
 * The app never calls OpenAI or ElevenLabs directly — SPEC section 10 forbids it, and
 * no provider key exists in this bundle to make it possible.
 */

import { File, Paths } from "expo-file-system";
import { supabase } from "./supabase";
import type { Difficulty } from "./topics";

export interface TurnResult {
  status: "continue" | "ended";
  reason: "time_limit" | "topic_complete" | null;
  outcome: "advance" | "retry" | "advance_without_comment";
  transcript: string;
  reply: { text: string; rejected: string | null };
  /** Local file URI for the synthesized audio, ready to hand to a player. */
  audioUri: string | null;
  session: { currentTurn: number; turnsCompleted: number; totalTurns: number };
  timings?: Record<string, number>;
}

export class TurnError extends Error {}

/** Opens a session row. State lives server-side so an app kill mid-flow loses nothing. */
export async function startSession(
  topicId: string,
  difficulty: Difficulty,
): Promise<{ sessionId: string; startedAt: number }> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new TurnError("Not signed in.");

  // At most one open session per user is enforced by a partial unique index, so a
  // leftover session from a previous run has to be closed rather than duplicated.
  await supabase
    .from("sessions")
    .update({ completed_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("completed_at", null);

  const { data, error } = await supabase
    .from("sessions")
    .insert({ user_id: userId, topic_id: topicId, difficulty })
    .select("id, started_at")
    .single();

  if (error) throw new TurnError(error.message);
  return { sessionId: data.id as string, startedAt: new Date(data.started_at as string).getTime() };
}

/**
 * Uploads the user's recording and returns Ammamma's next line plus its audio.
 *
 * The recording is sent and forgotten — it is never written to storage, which is what
 * lets the privacy manifest say so honestly.
 */
export async function submitTurn(args: {
  sessionId: string;
  clientTurn: number;
  recordingUri: string;
}): Promise<TurnResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new TurnError("Not signed in.");

  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

  const form = new FormData();
  form.append(
    "meta",
    JSON.stringify({ sessionId: args.sessionId, clientTurn: args.clientTurn }),
  );
  // React Native's FormData takes this shape rather than a Blob.
  form.append("audio", {
    uri: args.recordingUri,
    name: "turn.m4a",
    type: "audio/m4a",
  } as unknown as Blob);

  const response = await fetch(`${supabaseUrl}/functions/v1/turn`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, apikey: anonKey ?? "" },
    body: form,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new TurnError(`Ammamma couldn't hear that (${response.status}). ${detail.slice(0, 200)}`);
  }

  const payload = (await response.json()) as {
    status: TurnResult["status"];
    reason: TurnResult["reason"];
    outcome: TurnResult["outcome"];
    transcript?: string;
    reply?: { text: string; rejected: string | null };
    audioBase64?: string;
    session?: TurnResult["session"];
    timings?: Record<string, number>;
  };

  // A session that ended on the server returns no reply to speak.
  if (payload.status === "ended" && !payload.reply) {
    return {
      status: "ended",
      reason: payload.reason ?? "topic_complete",
      outcome: "advance",
      transcript: "",
      reply: { text: "", rejected: null },
      audioUri: null,
      session: payload.session ?? { currentTurn: 0, turnsCompleted: 0, totalTurns: 0 },
    };
  }

  let audioUri: string | null = null;
  if (payload.audioBase64) {
    // Overwrite a single file rather than accumulating one per turn — a five-minute
    // session would otherwise leave a dozen orphaned mp3s in the cache directory.
    const file = new File(Paths.cache, "ammamma-turn.mp3");
    if (file.exists) file.delete();
    file.create();
    file.write(Uint8Array.from(atob(payload.audioBase64), (c) => c.charCodeAt(0)));
    audioUri = file.uri;
  }

  return {
    status: payload.status,
    reason: payload.reason ?? null,
    outcome: payload.outcome,
    transcript: payload.transcript ?? "",
    reply: payload.reply ?? { text: "", rejected: null },
    audioUri,
    session: payload.session ?? { currentTurn: 1, turnsCompleted: 0, totalTurns: 0 },
    ...(payload.timings ? { timings: payload.timings } : {}),
  };
}
