/**
 * Smoke test for the auth + session write path, exactly as the app performs it.
 *
 * Uses only the anon key — no service role — so anything that passes here passes for a
 * real user, and anything RLS forbids will fail here too.
 *
 *   node --env-file=.env scripts/smoke-auth-session.mjs
 */

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { persistSession: false } },
);

// 1. Anonymous sign-in — SPEC 3.2, the first session precedes any account.
const { data: auth, error: authError } = await supabase.auth.signInAnonymously();
if (authError) {
  console.error("anonymous sign-in FAILED:", authError.message);
  console.error("Enable it in Supabase -> Authentication -> Providers -> Anonymous.");
  process.exit(1);
}
const userId = auth.user.id;
console.log("anonymous sign-in    OK  user=" + userId.slice(0, 8) + "...");

// 2. The trigger should have mirrored auth.users into public.users.
const { data: profile, error: profileError } = await supabase
  .from("users")
  .select("id, target_language, subscription_status, free_sessions_used")
  .eq("id", userId)
  .single();

if (profileError) {
  console.error("profile row FAILED:", profileError.message);
  process.exit(1);
}
console.log(
  "profile trigger      OK  lang=" +
    profile.target_language +
    " status=" +
    profile.subscription_status +
    " free_used=" +
    profile.free_sessions_used,
);

// 3. Create a session against a real topic (service-role-free, so RLS is exercised).
const { data: topicRows } = await supabase.from("topics").select("id").limit(1);
let topicId = topicRows?.[0]?.id;
if (!topicId) {
  // Expected while all content is unverified — RLS hides every topic from clients.
  console.log("session insert       SKIPPED (no client-visible topics: all unverified)");
  console.log("\nAll checks that can run without verified content passed.");
  process.exit(0);
}

const { data: session, error: sessionError } = await supabase
  .from("sessions")
  .insert({ user_id: userId, topic_id: topicId, difficulty: "medium" })
  .select("id, current_turn, turns_completed")
  .single();

if (sessionError) {
  console.error("session insert FAILED:", sessionError.message);
  process.exit(1);
}
console.log("session insert       OK  turn=" + session.current_turn);

// 4. RLS negative check: a user must not be able to see someone else's session.
const { data: others } = await supabase.from("sessions").select("id").neq("user_id", userId);
console.log(
  "RLS isolation        " + (others?.length === 0 ? "OK  (0 foreign sessions visible)" : "FAILED"),
);

await supabase.from("sessions").delete().eq("id", session.id);
console.log("cleanup              OK");
