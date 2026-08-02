/**
 * Smoke test for the client read path against the real database.
 *
 * Temporarily flips one topic to verified, confirms the anon role (what the app uses)
 * can now see it, then reverts. Proves RLS, the anon key, and the topic shape all work
 * without leaving unreviewed Telugu visible.
 *
 *   node --env-file=.env scripts/smoke-read-path.mjs
 */

const url = process.env.SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

const headers = (key) => ({
  apikey: key,
  Authorization: "Bearer " + key,
  "Content-Type": "application/json",
});

async function anonTopics() {
  const response = await fetch(url + "/rest/v1/topics?select=id,title,turns", {
    headers: headers(anon),
  });
  return response.json();
}

async function setVerified(id, verified) {
  await fetch(url + "/rest/v1/topics?id=eq." + id, {
    method: "PATCH",
    headers: { ...headers(service), Prefer: "return=minimal" },
    body: JSON.stringify({ verified }),
  });
}

const picked = await (
  await fetch(url + "/rest/v1/topics?select=id,title&limit=1", { headers: headers(service) })
).json();

const topic = picked[0];
console.log("before:            anon sees " + (await anonTopics()).length + " topic(s)");
console.log("temporarily verifying: " + topic.title);

await setVerified(topic.id, true);

const seen = await anonTopics();
console.log("after:             anon sees " + seen.length + " topic(s)");
if (seen[0]) {
  console.log("  title:      " + seen[0].title);
  console.log("  turns:      " + seen[0].turns.length);
  console.log("  first line: " + seen[0].turns[0].ai_prompt_native);
  console.log("  translit:   " + seen[0].turns[0].ai_prompt_translit);
}

await setVerified(topic.id, false);
console.log("reverted:          anon sees " + (await anonTopics()).length + " topic(s)");
