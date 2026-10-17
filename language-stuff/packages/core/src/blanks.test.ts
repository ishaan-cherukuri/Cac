import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildFillInTheBlanks, extractVocabWords, type BlankToken } from "./blanks.ts";

function blankIndices(tokens: BlankToken[]): number[] {
  return tokens.flatMap((token, index) => (token.kind === "blank" ? [index] : []));
}

function render(tokens: BlankToken[]): string {
  return tokens.map((t) => (t.kind === "blank" ? "____" : t.text)).join(" ");
}

const SENTENCES = [
  "నేను ఆఫీసుకి వెళ్ళాను. చాలా పని ఉంది.",
  "Nenu aaphisuki vellaanu. Chaalaa pani undi.",
  "అవును అమ్మమ్మా. నీ గురించి తెలుసుకోవాలి.",
  "బాగుంది అమ్మమ్మా. నువ్వు ఎలా ఉన్నావు?",
  "సరే అమ్మమ్మా. మళ్ళీ మాట్లాడతాను.",
  "తెలుసు",
  "ఉంది అమ్మమ్మా.",
  "ఒక మజ్జిగ ఇవ్వండి.",
];

describe("the sandwiched-between-two-words rule", () => {
  test("no blank ever lands on the first or last word", () => {
    for (const sentence of SENTENCES) {
      const tokens = buildFillInTheBlanks(sentence);
      for (const index of blankIndices(tokens)) {
        assert.notEqual(index, 0, `leading blank in: ${render(tokens)}`);
        assert.notEqual(index, tokens.length - 1, `trailing blank in: ${render(tokens)}`);
      }
    }
  });

  test("no two blanks are adjacent, so each has a real word on both sides", () => {
    for (const sentence of SENTENCES) {
      const tokens = buildFillInTheBlanks(sentence, { maxBlanks: 4 });
      const indices = blankIndices(tokens);
      for (let i = 1; i < indices.length; i++) {
        const gap = (indices[i] ?? 0) - (indices[i - 1] ?? 0);
        assert.ok(gap > 1, `adjacent blanks in: ${render(tokens)}`);
      }
    }
  });

  test("every blank literally has a word token either side", () => {
    // The rule stated directly, rather than inferred from indices.
    for (const sentence of SENTENCES) {
      const tokens = buildFillInTheBlanks(sentence, { maxBlanks: 4 });
      for (const index of blankIndices(tokens)) {
        assert.equal(tokens[index - 1]?.kind, "word", `no word before: ${render(tokens)}`);
        assert.equal(tokens[index + 1]?.kind, "word", `no word after: ${render(tokens)}`);
      }
    }
  });
});

describe("buildFillInTheBlanks", () => {
  test("keeps every word, blanked or not, in order", () => {
    const sentence = "నేను ఆఫీసుకి వెళ్ళాను. చాలా పని ఉంది.";
    const tokens = buildFillInTheBlanks(sentence);
    const reconstructed = tokens
      .map((token) => (token.kind === "blank" ? token.answer : token.text))
      .join(" ");
    assert.equal(reconstructed, sentence);
  });

  test("blanks something in a normal-length sentence", () => {
    const tokens = buildFillInTheBlanks("నేను ఆఫీసుకి వెళ్ళాను. చాలా పని ఉంది.");
    assert.ok(blankIndices(tokens).length >= 1);
  });

  test("leaves one- and two-word answers intact — nothing can be sandwiched", () => {
    for (const sentence of ["తెలుసు", "ఉంది అమ్మమ్మా."]) {
      const tokens = buildFillInTheBlanks(sentence);
      assert.equal(blankIndices(tokens).length, 0, sentence);
    }
  });

  test("a three-word answer gets exactly one blank, in the middle", () => {
    const tokens = buildFillInTheBlanks("ఒక మజ్జిగ ఇవ్వండి.");
    assert.deepEqual(blankIndices(tokens), [1]);
  });

  test("prefers key vocabulary over incidental words", () => {
    const tokens = buildFillInTheBlanks("నేను ఆఫీసుకి వెళ్ళాను. చాలా పని ఉంది.", {
      preferredWords: ["పని"],
      maxBlanks: 1,
    });
    const blanked = tokens.find((token) => token.kind === "blank");
    assert.equal(blanked?.kind === "blank" ? blanked.answer : null, "పని");
  });

  test("matches vocabulary despite trailing punctuation", () => {
    const tokens = buildFillInTheBlanks("నేను ఆఫీసుకి వెళ్ళాను. చాలా పని ఉంది.", {
      preferredWords: ["వెళ్ళాను"],
      maxBlanks: 1,
    });
    const blanked = tokens.find((token) => token.kind === "blank");
    assert.equal(blanked?.kind === "blank" ? blanked.answer : null, "వెళ్ళాను.");
  });

  test("respects maxBlanks", () => {
    const tokens = buildFillInTheBlanks(
      "ఒకటి రెండు మూడు నాలుగు ఐదు ఆరు ఏడు ఎనిమిది",
      { maxBlanks: 1 },
    );
    assert.equal(blankIndices(tokens).length, 1);
  });

  test("handles an empty string without throwing", () => {
    assert.deepEqual(buildFillInTheBlanks("   "), []);
  });
});

describe("extractVocabWords", () => {
  test("pulls both the Telugu and the romanization out of a vocab entry", () => {
    const words = extractVocabWords(["అవును (avunu) — yes", "గురించి (gurinchi) — about"]);
    assert.ok(words.includes("అవును"));
    assert.ok(words.includes("avunu"));
    assert.ok(words.includes("గురించి"));
    assert.ok(words.includes("gurinchi"));
  });

  test("survives entries that do not follow the pattern", () => {
    assert.doesNotThrow(() => extractVocabWords(["", "no parens here", "(orphan)"]));
  });
});
