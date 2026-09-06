/**
 * End-to-end smoke test of the deployed `turn` Edge Function.
 *
 * Signs in anonymously, temporarily verifies one topic, opens a session, POSTs a real
 * recording, and reports what came back. Reverts the topic afterwards so unreviewed
 * Telugu never stays visible.
 *
 *   node --env-file=.env scripts/smoke-turn-function.mjs spike/samples/speaker1-clip2.m4a
 */

import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const audioPath = process.argv[2] ?? "spike/samples/speaker1-clip2.m4a";
const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const admin = (path, init = {}) =>
  fetch(url + "/rest/v1/" + path, {
    ...init,
    headers: {
      apikey: serviceKey,
      Authorization: "Bearer " + serviceKey,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

const supabase = createClient(url, anonKey, { auth: { persistSession: false } });

// --- setup ------------------------------------------------------------------
const picked = await (await admin("topics?select=id,title,turns,verified&limit=1")).json();
const topic = picked[0];

// Remember the prior state and restore exactly that. An earlier version forced every
// topic back to verified=false on exit, which silently undid `dev-verify-topics.mjs on`
// and left the app showing its empty state for no visible reason.
const wasVerified = topic.verified === true;

if (!wasVerified) {
  await admin("topics?id=eq." + topic.id, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ verified: true }),
  });
}

let exitCode = 0;
try {
  const { data: auth, error: authError } = await supabase.auth.signInAnonymously();
  if (authError) throw new Error("sign-in: " + authError.message);
  const token = auth.session.access_token;

  const { data: session, error: sessionError } = await supabase
    .from("sessions")
    .insert({ user_id: auth.user.id, topic_id: topic.id, difficulty: "medium" })
    .select("id")
    .single();
  if (sessionError) throw new Error("session insert: " + sessionError.message);

  console.log("topic:   " + topic.title);
  console.log("turns:   " + topic.turns.length);
  console.log("audio:   " + audioPath);
  console.log("posting to /functions/v1/turn ...\n");

  // --- the actual call ------------------------------------------------------
  const form = new FormData();
  form.append("meta", JSON.stringify({ sessionId: session.id, clientTurn: 1 }));
  // Send the real extension — OpenAI infers the container from the filename, so calling
  // an mp3 "audio.m4a" makes transcription fail before anything interesting happens.
  const ext = audioPath.split(".").pop() ?? "m4a";
  form.append("audio", new Blob([await readFile(audioPath)]), `audio.${ext}`);

  const startedAt = Date.now();
  const response = await fetch(url + "/functions/v1/turn", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, apikey: anonKey },
    body: form,
  });
  const elapsed = Date.now() - startedAt;
  const body = await response.text();

  console.log("HTTP " + response.status + "  (" + (elapsed / 1000).toFixed(1) + "s round trip)\n");

  if (!response.ok) {
    console.log(body.slice(0, 600));
    exitCode = 1;
  } else {
    const result = JSON.parse(body);
    console.log("status:      " + result.status);
    console.log("outcome:     " + result.outcome);
    console.log("understood:  " + result.understood);
    console.log("transcript:  " + result.transcript);
    console.log("Ammamma:     " + result.reply.text);
    console.log("vetting:     " + (result.reply.rejected ?? "passed"));
    // Measure what the user actually feels: how long until sound starts, not how long
    // until the whole clip exists.
    if (result.speakUrl) {
      const speakStart = Date.now();
      const audio = await fetch(result.speakUrl);
      let firstByteAt = null;
      let bytes = 0;
      for await (const chunk of audio.body) {
        if (firstByteAt === null) firstByteAt = Date.now();
        bytes += chunk.length;
      }
      console.log(
        "speak:       HTTP " +
          audio.status +
          "  first byte " +
          ((firstByteAt - speakStart) / 1000).toFixed(2) +
          "s  full " +
          ((Date.now() - speakStart) / 1000).toFixed(2) +
          "s  " +
          Math.round(bytes / 1024) +
          "KB",
      );
      console.log(
        "TIME TO FIRST SOUND: " +
          ((elapsed + (firstByteAt - speakStart)) / 1000).toFixed(1) +
          "s",
      );
    }
    console.log("session:     turn " + result.session.currentTurn + " of " + result.session.totalTurns);
    if (result.timings) console.log("timings:     " + Object.entries(result.timings).map(([k,v])=>k+"="+(v/1000).toFixed(1)+"s").join("  "));
  }

  await supabase.from("sessions").delete().eq("id", session.id);
} finally {
  if (!wasVerified) {
    await admin("topics?id=eq." + topic.id, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ verified: false }),
    });
    console.log("\n(this topic reverted to unverified; others untouched)");
  } else {
    console.log("\n(topic was already verified; left as-is)");
  }
}

process.exit(exitCode);
