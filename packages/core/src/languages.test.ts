import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  LANGUAGE_CODES,
  LANGUAGES,
  isLanguageCode,
  languageProfile,
  withPersona,
} from "./languages.ts";
import { failsWarmthCheck, containsPaymentReference } from "./persona.ts";

describe("LANGUAGES", () => {
  test("every code has a profile keyed by itself", () => {
    for (const code of LANGUAGE_CODES) assert.equal(LANGUAGES[code].code, code);
  });

  test("every scripted line is complete in all three forms", () => {
    for (const code of LANGUAGE_CODES) {
      const { fallbackLine, closing } = LANGUAGES[code];
      for (const line of [fallbackLine, closing.topicComplete, closing.timeLimit]) {
        assert.ok(line.native && line.translit && line.english, `${code} has an incomplete line`);
      }
    }
  });

  test("no scripted line trips the outbound checks", () => {
    // These lines bypass the model; if one failed vetting it would mean the app's own
    // copy is colder than what it forbids the model from saying.
    for (const code of LANGUAGE_CODES) {
      const { fallbackLine, closing } = LANGUAGES[code];
      for (const line of [fallbackLine, closing.topicComplete, closing.timeLimit]) {
        assert.equal(failsWarmthCheck(line.english), false, line.english);
        assert.equal(containsPaymentReference(line.english), false, line.english);
      }
    }
  });
});

describe("languageProfile", () => {
  test("recognises known codes only", () => {
    assert.equal(isLanguageCode("hi"), true);
    assert.equal(isLanguageCode("fr"), false);
    assert.equal(isLanguageCode(undefined), false);
  });

  test("falls back to Telugu instead of throwing mid-session", () => {
    assert.equal(languageProfile("xx").code, "te");
    assert.equal(languageProfile(null).code, "te");
  });
});

describe("withPersona", () => {
  test("fills every token with that language's grandmother", () => {
    assert.equal(withPersona("Ask {persona} — {persona} knows", "hi"), "Ask Nani — Nani knows");
    assert.equal(withPersona("Tell {persona}", "te"), "Tell Ammamma");
  });

  test("leaves text without a token alone", () => {
    assert.equal(withPersona("About your parents", "te"), "About your parents");
  });
});
