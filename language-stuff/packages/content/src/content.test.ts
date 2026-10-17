import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  loadTopics,
  analyzeAnchorBalance,
  findTransliterationProblems,
  findDuplicateIds,
  findStarterConflicts,
  findHardcodedPersona,
  topicsInLanguage,
  assertShippable,
  UnverifiedContentError,
  FULL_CORPUS_LANGUAGES,
  MIN_TOPICS,
  MAX_TOPICS,
  type Topic,
} from "./index.ts";
import { LANGUAGE_CODES } from "../../core/src/languages.ts";

const topics = await loadTopics();

describe("the topic corpus", () => {
  for (const language of FULL_CORPUS_LANGUAGES) {
    const inLanguage = topicsInLanguage(topics, language);

    test(`${language}: has ${MIN_TOPICS}-${MAX_TOPICS} topics as SPEC section 3.1 requires`, () => {
      assert.ok(
        inLanguage.length >= MIN_TOPICS && inLanguage.length <= MAX_TOPICS,
        `found ${inLanguage.length}`,
      );
    });

    test(`${language}: meets the 40/30/30 emotional balance SPEC section 7 requires`, () => {
      const balance = analyzeAnchorBalance(inLanguage);
      assert.deepEqual(balance.problems, []);
      assert.ok(balance.meetsSpec);
    });
  }

  test("every language has exactly one starter topic", () => {
    assert.deepEqual(findStarterConflicts(topics), []);
    for (const language of LANGUAGE_CODES) {
      const starters = topicsInLanguage(topics, language).filter((topic) => topic.starter);
      assert.equal(starters.length, 1, `${language} has ${starters.length} starter topics`);
    }
  });

  test("English copy names the grandmother only through {persona}", () => {
    assert.deepEqual(findHardcodedPersona(topics), []);
  });

  test("parses against the schema — every turn has all six text fields", () => {
    // loadTopics() already throws on schema failure, so reaching here is the assertion.
    // This spot-checks that the corpus isn't accidentally empty.
    assert.ok(topics.length > 0);
    for (const topic of topics) {
      assert.ok(topic.turns.length >= 5 && topic.turns.length <= 8, topic.title);
    }
  });

  test("has no duplicate ids", () => {
    assert.deepEqual(findDuplicateIds(topics), []);
  });

  test("transliterations contain no non-Latin lookalike characters", () => {
    // Guards against Cyrillic/Greek homoglyphs, which are invisible in review but
    // unreadable for the user who cannot read Telugu script.
    assert.deepEqual(findTransliterationProblems(topics), []);
  });

  test("every turn offers vocab support where the user must produce language", () => {
    for (const topic of topics) {
      for (const turn of topic.turns) {
        assert.ok(
          turn.key_vocab.length > 0,
          `"${topic.title}" turn ${turn.turn_number} has no key_vocab — medium difficulty has nothing to hint with`,
        );
      }
    }
  });

  test("no topic contains punitive or correction language in its English copy", () => {
    // SPEC section 10: never "wrong", never "incorrect". Checked on the English fields
    // because that is what a reviewer reads and what could leak into UI.
    const banned = /\b(wrong|incorrect|mistake|error|failed)\b/i;
    for (const topic of topics) {
      assert.doesNotMatch(topic.scenario_description, banned, topic.title);
      for (const turn of topic.turns) {
        assert.doesNotMatch(turn.ai_prompt_english, banned, `${topic.title} turn ${turn.turn_number}`);
      }
    }
  });
});

describe("assertShippable", () => {
  test("blocks release while any topic is unverified", () => {
    const unverified = topics.filter((topic) => !topic.verified);
    if (unverified.length === 0) {
      assert.doesNotThrow(() => assertShippable(topics));
      return;
    }
    assert.throws(() => assertShippable(topics), UnverifiedContentError);
  });

  test("passes once everything is verified", () => {
    const allVerified: Topic[] = topics.map((topic) => ({ ...topic, verified: true }));
    assert.doesNotThrow(() => assertShippable(allVerified));
  });
});
