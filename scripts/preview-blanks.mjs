/**
 * Prints the medium-difficulty fill-in-the-blanks for real topic content, and checks the
 * sandwiching rule against every turn in the corpus rather than a handful of fixtures.
 *
 *   node scripts/preview-blanks.mjs
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildFillInTheBlanks, extractVocabWords } from "../packages/core/src/blanks.ts";

const files = (await readdir("content/topics")).filter((f) => f.endsWith(".json")).sort();
const topics = [];
for (const file of files) {
  topics.push(...JSON.parse(await readFile(join("content/topics", file), "utf8")));
}

const render = (tokens) =>
  tokens.map((t) => (t.kind === "blank" ? "_".repeat(Math.max(4, t.answer.length)) : t.text)).join(" ");

let turns = 0;
let withBlanks = 0;
let violations = 0;

for (const topic of topics) {
  for (const turn of topic.turns) {
    turns++;
    const preferredWords = extractVocabWords(turn.key_vocab);
    const tokens = buildFillInTheBlanks(turn.model_answer_translit, { preferredWords });

    const blanks = tokens.flatMap((t, i) => (t.kind === "blank" ? [i] : []));
    if (blanks.length > 0) withBlanks++;

    for (const index of blanks) {
      if (tokens[index - 1]?.kind !== "word" || tokens[index + 1]?.kind !== "word") {
        console.log(`RULE VIOLATION: ${render(tokens)}`);
        violations++;
      }
    }
  }
}

console.log("=== samples ===\n");
for (const topic of topics.slice(0, 4)) {
  console.log(topic.title);
  for (const turn of topic.turns.slice(0, 2)) {
    const preferredWords = extractVocabWords(turn.key_vocab);
    console.log("  full:   " + turn.model_answer_translit);
    console.log(
      "  shown:  " +
        render(buildFillInTheBlanks(turn.model_answer_translit, { preferredWords })),
    );
  }
  console.log();
}

console.log("=== corpus check ===");
console.log(`turns:            ${turns}`);
console.log(`with >=1 blank:   ${withBlanks} (${Math.round((withBlanks / turns) * 100)}%)`);
console.log(`rule violations:  ${violations}`);
process.exitCode = violations > 0 ? 1 : 0;
