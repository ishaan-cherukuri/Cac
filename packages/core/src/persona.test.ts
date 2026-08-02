import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  buildSystemPrompt,
  buildTurnInstruction,
  parseTurnJudgement,
  containsPaymentReference,
  failsWarmthCheck,
  vetLine,
  FALLBACK_LINE,
  PERSONA_NAME,
} from "./persona.ts";

const TOPIC = {
  topicTitle: "Tell Ammamma about your day",
  scenarioDescription: "Ammamma has called to check in.",
} as const;

describe("buildSystemPrompt", () => {
  test("carries the persona, language, and topic into every difficulty", () => {
    for (const difficulty of ["easy", "medium", "hard"] as const) {
      const prompt = buildSystemPrompt({ ...TOPIC, difficulty });
      assert.match(prompt, new RegExp(PERSONA_NAME));
      assert.match(prompt, /Telugu/);
      assert.ok(prompt.includes(TOPIC.topicTitle), `${difficulty} lost the topic title`);
    }
  });

  test("the three difficulties scaffold distinguishably differently", () => {
    // SPEC section 12 definition-of-done: "all three difficulty levels work
    // distinguishably differently". Structural assertions, not exact strings.
    const easy = buildSystemPrompt({ ...TOPIC, difficulty: "easy" });
    const medium = buildSystemPrompt({ ...TOPIC, difficulty: "medium" });
    const hard = buildSystemPrompt({ ...TOPIC, difficulty: "hard" });

    assert.notEqual(easy, medium);
    assert.notEqual(medium, hard);
    assert.match(easy, /shadowing/i);
    assert.match(medium, /scaffold|first two or three words/i);
    assert.match(hard, /only your question/i);
  });

  test("forbids correction at every difficulty", () => {
    for (const difficulty of ["easy", "medium", "hard"] as const) {
      assert.match(buildSystemPrompt({ ...TOPIC, difficulty }), /[Nn]ever correct their grammar/);
    }
  });
});

describe("containsPaymentReference", () => {
  test("flags payment language that would fail App Review", () => {
    for (const text of [
      "You can subscribe on our website.",
      "The price is ten dollars.",
      "Visit https://example.com to pay",
      "Update your billing details.",
      "Use a credit card to continue.",
    ]) {
      assert.equal(containsPaymentReference(text), true, `missed: ${text}`);
    }
  });

  test("leaves ordinary warm conversation alone", () => {
    for (const text of [
      "అమ్మమ్మా, నేను ఈరోజు ఆఫీసుకి వెళ్ళాను.",
      "ఇంకొంచెం చెప్పు, నాన్నా.",
      "How was your day, kanna?",
    ]) {
      assert.equal(containsPaymentReference(text), false, `false positive: ${text}`);
    }
  });
});

describe("failsWarmthCheck", () => {
  test("catches the model slipping into teacher or assistant voice", () => {
    for (const text of [
      "That's not quite right, try again.",
      "The correct answer is వెళ్ళాను.",
      "As an AI, I cannot help with that.",
      "You have earned 20 points this lesson!",
      "There is a grammar mistake in your sentence.",
    ]) {
      assert.equal(failsWarmthCheck(text), true, `missed: ${text}`);
    }
  });

  test("passes lines a grandmother would actually say", () => {
    for (const text of [
      "అయ్యో, ఎక్కువ పని చేయకు. భోజనం చేశావా?",
      "Tell me more, kanna. I'm listening.",
      "మళ్ళీ చెప్పు, నాకు వినపడలేదు.",
    ]) {
      assert.equal(failsWarmthCheck(text), false, `false positive: ${text}`);
    }
  });
});

describe("buildTurnInstruction", () => {
  test("asks for JSON with both fields", () => {
    const instruction = buildTurnInstruction({
      expectedAnswerNative: "నేను ఆఫీసుకి వెళ్ళాను.",
      mayReAsk: true,
    });
    assert.match(instruction, /"understood"/);
    assert.match(instruction, /"reply"/);
  });

  test("biases generously toward understood", () => {
    // A false "not understood" makes Ammamma re-ask a question the user answered fine —
    // exactly the not-being-heard experience the app exists to undo.
    const instruction = buildTurnInstruction({
      expectedAnswerNative: "సరే",
      mayReAsk: true,
    });
    assert.match(instruction, /generous/i);
    assert.match(instruction, /hesitant|imperfectly|partial/i);
  });

  test("branches on its own verdict, and stops re-asking on the last attempt", () => {
    const retry = buildTurnInstruction({ expectedAnswerNative: "సరే", mayReAsk: true });
    assert.match(retry, /SAME thing again/i);
    assert.match(retry, /[Dd]o not mention that you did not understand/);

    const lastAttempt = buildTurnInstruction({ expectedAnswerNative: "సరే", mayReAsk: false });
    assert.notEqual(retry, lastAttempt);
    assert.match(lastAttempt, /do not ask again/i);
  });

  test("forbids surfacing the judgement to the user", () => {
    for (const mayReAsk of [true, false]) {
      const instruction = buildTurnInstruction({ expectedAnswerNative: "సరే", mayReAsk });
      assert.match(instruction, /[Nn]o correction/);
    }
  });
});

describe("parseTurnJudgement", () => {
  test("reads a well-formed judgement", () => {
    assert.deepEqual(parseTurnJudgement('{"understood":true,"reply":"బాగుంది కన్నా."}'), {
      understood: true,
      reply: "బాగుంది కన్నా.",
    });
  });

  test("reads a negative judgement", () => {
    const result = parseTurnJudgement('{"understood":false,"reply":"మళ్ళీ చెప్పు."}');
    assert.equal(result?.understood, false);
  });

  test("defaults to understood when the flag is missing", () => {
    // Advancing is the kinder error: a wrong re-ask feels like not being heard.
    assert.equal(parseTurnJudgement('{"reply":"సరే"}')?.understood, true);
  });

  test("returns null on malformed output so the caller can fall back", () => {
    assert.equal(parseTurnJudgement("not json"), null);
    assert.equal(parseTurnJudgement('{"understood":true}'), null);
    assert.equal(parseTurnJudgement('{"understood":true,"reply":"   "}'), null);
  });
});

describe("vetLine", () => {
  test("passes a good line through untouched", () => {
    const line = "ఏం చేశావు ఈరోజు?";
    assert.deepEqual(vetLine(line), { text: line, rejected: null });
  });

  test("replaces rather than edits a rejected line", () => {
    // Editing a line that broke character cannot restore character; substitution can.
    const payment = vetLine("You can subscribe at our website for more lessons.");
    assert.equal(payment.text, FALLBACK_LINE);
    assert.equal(payment.rejected, "payment_reference");

    const cold = vetLine("Incorrect. The right answer is వెళ్ళాను.");
    assert.equal(cold.text, FALLBACK_LINE);
    assert.equal(cold.rejected, "cold_tone");
  });

  test("substitutes for an empty generation", () => {
    assert.equal(vetLine("   ").rejected, "empty");
    assert.equal(vetLine("   ").text, FALLBACK_LINE);
  });

  test("the fallback line itself survives every check", () => {
    // A fallback that trips its own filters would loop forever.
    assert.deepEqual(vetLine(FALLBACK_LINE), { text: FALLBACK_LINE, rejected: null });
  });
});
