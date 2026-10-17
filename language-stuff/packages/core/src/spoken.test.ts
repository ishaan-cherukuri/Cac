import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseVocabEntry, findSpokenVocab } from "./spoken.ts";

const words = (found: { native: string }[]) => found.map((entry) => entry.native);

describe("parseVocabEntry", () => {
  test("reads the content format", () => {
    assert.deepEqual(parseVocabEntry("అవును (avunu) — yes"), {
      native: "అవును",
      translit: "avunu",
      meaning: "yes",
    });
  });

  test("keeps multi-word phrases and meanings intact", () => {
    assert.deepEqual(parseVocabEntry("कम से कम (kam se kam) — at least"), {
      native: "कम से कम",
      translit: "kam se kam",
      meaning: "at least",
    });
  });

  test("refuses anything not in the format instead of guessing", () => {
    assert.equal(parseVocabEntry("అవును — yes"), null);
    assert.equal(parseVocabEntry(""), null);
  });
});

describe("findSpokenVocab", () => {
  const telugu = ["అవును (avunu) — yes", "గురించి (gurinchi) — about"];

  test("finds a word said exactly as listed", () => {
    assert.deepEqual(words(findSpokenVocab("అవును అమ్మమ్మా.", telugu)), ["అవును"]);
  });

  test("finds Telugu words with a suffix attached", () => {
    // అవునండి is అవును + the respectful -అండి.
    assert.deepEqual(words(findSpokenVocab("అవునండి, నీ గురించి చెప్పు", telugu)), [
      "అవును",
      "గురించి",
    ]);
  });

  test("finds Hindi verbs inflected away from the dictionary form", () => {
    const hindi = ["मनाना (manaana) — to celebrate", "देखना (dekhna) — to watch"];
    assert.deepEqual(words(findSpokenVocab("हाँ, सबने राखी मनाई", hindi)), ["मनाना"]);
    assert.deepEqual(words(findSpokenVocab("मैंने फ़िल्म देखी थी", hindi)), ["देखना"]);
  });

  test("matches multi-word phrases only when the words are adjacent and in order", () => {
    const phrase = ["कम से कम (kam se kam) — at least"];
    assert.equal(findSpokenVocab("कम से कम तीन", phrase).length, 1);
    assert.equal(findSpokenVocab("कम खाओ, फिर से", phrase).length, 0);
  });

  test("finds the romanized form when the transcript came out in Latin letters", () => {
    assert.deepEqual(words(findSpokenVocab("Avunu, I want to know", telugu)), ["అవును"]);
  });

  test("does not count a word that was not said", () => {
    // Being understood is not the same as using the word — this is the whole rule.
    assert.deepEqual(findSpokenVocab("నాకు తెలీదు", telugu), []);
  });

  test("short words must match whole, not as a prefix of something else", () => {
    const short = ["रंग (rang) — colour"];
    assert.equal(findSpokenVocab("रंगीन", short).length, 1, "a longer word built on it still counts");
    assert.equal(findSpokenVocab("रं", short).length, 0, "a fragment does not");
  });

  test("reports each word's position so its audio can be found", () => {
    const [found] = findSpokenVocab("నీ గురించి", telugu);
    assert.equal(found?.index, 1);
  });

  test("skips malformed vocab instead of throwing mid-turn", () => {
    assert.deepEqual(words(findSpokenVocab("అవును", ["broken entry", ...telugu])), ["అవును"]);
  });

  test("an empty transcript says nothing", () => {
    assert.deepEqual(findSpokenVocab("   ", telugu), []);
  });
});
