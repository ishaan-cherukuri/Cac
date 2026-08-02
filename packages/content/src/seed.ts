/**
 * Seeds validated topic content into Supabase.
 *
 *   node --env-file=.env packages/content/src/seed.ts
 *   node --env-file=.env packages/content/src/seed.ts --allow-unverified   # dev only
 *
 * Refuses to seed unverified Telugu by default. RLS also hides unverified rows from
 * clients, so even a forced dev seed cannot surface bad content to a real user.
 */

import { createClient } from "@supabase/supabase-js";
import { loadTopics, assertShippable, type Topic } from "./index.ts";

interface TopicRow {
  id: string;
  target_language: string;
  title: string;
  scenario_description: string;
  emotional_anchor: Topic["emotional_anchor"];
  turns: Topic["turns"];
  verified: boolean;
}

function toRow(topic: Topic): TopicRow {
  return {
    id: topic.id,
    target_language: topic.target_language,
    title: topic.title,
    scenario_description: topic.scenario_description,
    emotional_anchor: topic.emotional_anchor,
    turns: topic.turns,
    verified: topic.verified,
  };
}

async function main(): Promise<void> {
  const allowUnverified = process.argv.includes("--allow-unverified");

  const url = process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n\n" +
        "  Both live in .env at the repo root (copy from .env.example).\n" +
        "  The service role key bypasses RLS — server-side only, never in the app.",
    );
  }

  const topics = await loadTopics();
  console.log(`Loaded ${topics.length} topics.`);

  if (allowUnverified) {
    const unverified = topics.filter((topic) => !topic.verified).length;
    console.warn(
      `\n⚠️  --allow-unverified: seeding ${unverified} unreviewed topic(s).\n` +
        `   RLS hides verified=false rows from clients, so users will see nothing.\n` +
        `   Never use this flag against production.\n`,
    );
  } else {
    // Throws with the full list of offending titles.
    assertShippable(topics);
  }

  const supabase = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Upsert so re-seeding after content edits is safe and idempotent.
  const { error } = await supabase
    .from("topics")
    .upsert(topics.map(toRow), { onConflict: "id" });

  if (error) {
    throw new Error(`Seed failed: ${error.message}`);
  }

  const visible = topics.filter((topic) => topic.verified).length;
  console.log(`Seeded ${topics.length} topics.`);
  console.log(`${visible} visible to clients, ${topics.length - visible} hidden by RLS pending review.`);
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
