/**
 * DEV ONLY — flip topic visibility so the app has content to show.
 *
 * All 30 topics ship as verified:false, and RLS hides them from clients, so a fresh
 * database renders the empty state. That gate is correct and must stay: it is what
 * stops unreviewed Telugu reaching a real user.
 *
 * This toggles the flag in the DATABASE only. The JSON files under content/topics/ keep
 * verified:false, so reseeding resets everything and nothing ships by accident.
 *
 *   node --env-file=.env scripts/dev-verify-topics.mjs on    # show topics in the app
 *   node --env-file=.env scripts/dev-verify-topics.mjs off   # back to hidden
 */

const mode = process.argv[2];
if (mode !== "on" && mode !== "off") {
  console.error("Usage: node --env-file=.env scripts/dev-verify-topics.mjs <on|off>");
  process.exit(1);
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const verified = mode === "on";

const response = await fetch(url + "/rest/v1/topics?verified=eq." + String(!verified), {
  method: "PATCH",
  headers: {
    apikey: key,
    Authorization: "Bearer " + key,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  },
  body: JSON.stringify({ verified }),
});

if (!response.ok) {
  console.error("Failed: " + response.status + " " + (await response.text()).slice(0, 200));
  process.exit(1);
}

const changed = await response.json();
console.log(
  "Set verified=" + verified + " on " + changed.length + " topic(s).",
);
console.log(
  verified
    ? "The app will now show topics. Remember: this is unreviewed Telugu — dev only."
    : "Topics hidden from clients again.",
);
