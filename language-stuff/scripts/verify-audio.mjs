/**
 * Verifies pre-generated audio: every clip present, non-trivial, and distinct.
 *
 * The distinctness check matters. Identical bytes at two different paths would mean a
 * clip was uploaded under the wrong key — the grandmother saying the wrong sentence, which is
 * far worse than silence and completely invisible without hashing.
 *
 *   node --env-file=.env scripts/verify-audio.mjs
 */

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const url = process.env.SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

const files = (await readdir("content/topics")).filter((f) => f.endsWith(".json")).sort();
const topics = [];
for (const file of files) {
  topics.push(...JSON.parse(await readFile(join("content/topics", file), "utf8")));
}

const hashes = new Map();
let checked = 0;
let missing = 0;
let tiny = 0;
const duplicates = [];

for (const topic of topics) {
  for (const turn of topic.turns) {
    for (const kind of ["prompt", "answer"]) {
      const path = `${topic.id}/${turn.turn_number}-${kind}.mp3`;
      const response = await fetch(
        `${url}/storage/v1/object/public/topic-audio/${path}`,
        { headers: { apikey: service } },
      );

      if (!response.ok) {
        console.log(`MISSING  ${response.status}  ${path}`);
        missing++;
        continue;
      }

      const bytes = Buffer.from(await response.arrayBuffer());
      checked++;

      // Under ~4KB of mp3 is well below one spoken Telugu clause.
      if (bytes.length < 4000) {
        console.log(`TINY     ${bytes.length}b  ${path}`);
        tiny++;
      }

      const hash = createHash("md5").update(bytes).digest("hex");
      const seen = hashes.get(hash);
      if (seen) {
        duplicates.push({ path, collidesWith: seen });
      } else {
        hashes.set(hash, path);
      }
    }
  }
}

console.log(`\nchecked ${checked} clips`);
console.log(`missing:    ${missing}`);
console.log(`suspicious: ${tiny}`);
console.log(`duplicates: ${duplicates.length}`);

for (const duplicate of duplicates.slice(0, 10)) {
  console.log(`  ${duplicate.path}\n    identical to ${duplicate.collidesWith}`);
}

process.exitCode = missing > 0 || duplicates.length > 0 ? 1 : 0;
