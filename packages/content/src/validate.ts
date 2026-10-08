/**
 * Content validation CLI. Run with `npm run content:validate`.
 *
 * Exits non-zero on anything that would break a build or ship bad content.
 * Unverified content is reported but does NOT fail the run — everything is unverified
 * until native review, and a permanently-red check gets ignored. `assertShippable`
 * is the gate that actually blocks release.
 */

import {
  loadTopics,
  analyzeAnchorBalance,
  findTransliterationProblems,
  findDuplicateIds,
  findStarterConflicts,
  findHardcodedPersona,
  topicsInLanguage,
  FULL_CORPUS_LANGUAGES,
  MIN_TOPICS,
  MAX_TOPICS,
} from "./index.ts";
import { LANGUAGE_CODES } from "../../core/src/languages.ts";

function line(): void {
  console.log("─".repeat(64));
}

async function main(): Promise<void> {
  const topics = await loadTopics();
  const failures: string[] = [];

  line();
  console.log(`Loaded ${topics.length} topics`);
  line();

  // --- Per-language counts --------------------------------------------------
  for (const language of LANGUAGE_CODES) {
    const count = topicsInLanguage(topics, language).length;
    const full = FULL_CORPUS_LANGUAGES.includes(language);
    console.log(`  ${language}: ${count} topics${full ? "" : " (pilot — structure checks only)"}`);
    if (full && (count < MIN_TOPICS || count > MAX_TOPICS)) {
      failures.push(`SPEC requires ${MIN_TOPICS}-${MAX_TOPICS} ${language} topics, found ${count}`);
    }
  }

  // --- Starters and the {persona} token --------------------------------------
  for (const language of findStarterConflicts(topics)) {
    failures.push(`${language} has more than one starter topic`);
  }
  for (const title of findHardcodedPersona(topics)) {
    failures.push(`"${title}" hardcodes the grandmother's name in English copy; use {persona}`);
  }

  // --- Unique ids -----------------------------------------------------------
  const duplicates = findDuplicateIds(topics);
  if (duplicates.length > 0) {
    failures.push(`Duplicate topic ids: ${duplicates.join(", ")}`);
  }

  // --- Emotional balance (full-corpus languages) -----------------------------
  for (const language of FULL_CORPUS_LANGUAGES) {
    const balance = analyzeAnchorBalance(topicsInLanguage(topics, language));
    console.log(`\nEmotional anchors (${language})`);
    console.log(`  grandparent  ${balance.counts.grandparent}  (${(balance.grandparentShare * 100).toFixed(0)}%, need 40%)`);
    console.log(`  parent       ${balance.counts.parent}  (${(balance.parentShare * 100).toFixed(0)}%, need 30%)`);
    console.log(
      `  general      ${balance.counts.cousin + balance.counts.cultural}  ` +
        `(${(balance.generalShare * 100).toFixed(0)}%, need 30%)  ` +
        `[cousin ${balance.counts.cousin}, cultural ${balance.counts.cultural}]`,
    );
    failures.push(...balance.problems.map((problem) => `${language}: ${problem}`));
  }

  // --- Transliteration hygiene ----------------------------------------------
  const translitProblems = findTransliterationProblems(topics);
  console.log(`\nTransliteration: ${translitProblems.length === 0 ? "clean" : `${translitProblems.length} problem(s)`}`);
  for (const problem of translitProblems) {
    console.log(`  ✗ "${problem.topicTitle}" turn ${problem.turnNumber} ${problem.field}`);
    console.log(`      non-Latin character(s): ${problem.offending}`);
    failures.push(
      `Non-Latin character in ${problem.field} — "${problem.topicTitle}" turn ${problem.turnNumber}`,
    );
  }

  // --- Native review status (reported, not enforced here) -------------------
  const unverified = topics.filter((topic) => !topic.verified);
  console.log(`\nNative review: ${topics.length - unverified.length}/${topics.length} verified`);
  if (unverified.length > 0) {
    console.log(`  ⚠️  ${unverified.length} topic(s) awaiting a native speaker.`);
    console.log(`     This does not fail validation, but assertShippable() will block release.`);
    console.log(`     See content/REVIEW.md.`);
  }

  // --- Verdict --------------------------------------------------------------
  line();
  if (failures.length > 0) {
    console.log(`FAILED — ${failures.length} problem(s):\n`);
    for (const failure of failures) console.log(`  ✗ ${failure}`);
    console.log();
    process.exitCode = 1;
    return;
  }

  console.log("PASSED — content is structurally valid.");
  if (unverified.length > 0) console.log("Still blocked from release pending native review.");
  console.log();
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
