/**
 * Fill-in-the-blanks scaffolding for medium difficulty.
 *
 * Medium used to show the first few words of the answer plus a vocabulary list, which
 * left the rest of the sentence wide open — the user still had to compose, which is the
 * hard-mode job. Blanking words inside the full sentence keeps the shape of the answer
 * visible while still requiring production, and it removes the room for improvisation.
 *
 * The load-bearing rule: **every blank sits between two visible words.** A blank at
 * either end has nothing to anchor it, and two adjacent blanks leave the middle one
 * without a neighbouring word — both turn a targeted gap back into open composition.
 */

export type BlankToken =
  | { kind: "word"; text: string }
  | { kind: "blank"; answer: string };

export interface BlankOptions {
  /**
   * Words worth blanking — the turn's key vocabulary. These are what the topic is
   * actually teaching, so they are preferred over incidental words like "and".
   */
  preferredWords?: string[];
  /** Upper bound. Two is plenty for the 4-8 word sentences these topics use. */
  maxBlanks?: number;
}

/** Strips punctuation for comparison so "వెళ్ళాను." matches "వెళ్ళాను". */
function normalize(word: string): string {
  return word.replace(/[.,!?;:"'()]/gu, "").toLowerCase();
}

/**
 * Chooses non-adjacent interior positions, preferring key vocabulary.
 *
 * Adjacency is enforced across the whole selection, not just against the previous pick,
 * so the "sandwiched between two words" guarantee holds no matter what order candidates
 * are considered in.
 */
function chooseIndices(words: string[], preferred: Set<string>, maxBlanks: number): number[] {
  // Position 0 and the last position are never eligible: nothing on one side.
  const eligible: number[] = [];
  for (let i = 1; i < words.length - 1; i++) eligible.push(i);
  if (eligible.length === 0) return [];

  const chosen: number[] = [];
  const isFree = (index: number) =>
    !chosen.some((taken) => Math.abs(taken - index) <= 1);

  // Key vocabulary first — those are the words the turn is trying to teach.
  for (const index of eligible) {
    if (chosen.length >= maxBlanks) break;
    const word = words[index];
    if (word !== undefined && preferred.has(normalize(word)) && isFree(index)) {
      chosen.push(index);
    }
  }

  // Then fill remaining slots from the middle outward, so a single blank lands in the
  // centre of the sentence rather than hugging the first word.
  const byCentrality = [...eligible].sort(
    (a, b) =>
      Math.abs(a - (words.length - 1) / 2) - Math.abs(b - (words.length - 1) / 2),
  );
  for (const index of byCentrality) {
    if (chosen.length >= maxBlanks) break;
    if (isFree(index)) chosen.push(index);
  }

  return chosen.sort((a, b) => a - b);
}

/**
 * How many blanks a sentence can carry. Short sentences get one; there is no point
 * blanking half of a four-word answer.
 */
function blankBudget(wordCount: number, maxBlanks: number): number {
  const interior = wordCount - 2;
  if (interior <= 0) return 0;
  // Non-adjacent picks from `interior` consecutive slots cap at ceil(interior / 2).
  const structuralMax = Math.ceil(interior / 2);
  const lengthBased = wordCount >= 6 ? 2 : 1;
  return Math.max(0, Math.min(maxBlanks, structuralMax, lengthBased));
}

export function buildFillInTheBlanks(
  sentence: string,
  options: BlankOptions = {},
): BlankToken[] {
  const words = sentence.trim().split(/\s+/u).filter((word) => word.length > 0);
  if (words.length === 0) return [];

  const maxBlanks = options.maxBlanks ?? 2;
  const budget = blankBudget(words.length, maxBlanks);

  // Fewer than three words cannot sandwich anything — show the sentence intact rather
  // than breaking the rule.
  if (budget === 0) return words.map((text) => ({ kind: "word", text }));

  const preferred = new Set((options.preferredWords ?? []).map(normalize));
  const blanks = new Set(chooseIndices(words, preferred, budget));

  return words.map((text, index) =>
    blanks.has(index) ? { kind: "blank", answer: text } : { kind: "word", text },
  );
}

/**
 * Pulls the usable words out of a `key_vocab` entry.
 *
 * Entries look like "అవును (avunu) — yes": Telugu, romanization in parentheses, English
 * gloss after a dash. Both the Telugu and the romanization are returned so the same list
 * works for blanking either script.
 */
export function extractVocabWords(keyVocab: readonly string[]): string[] {
  const words: string[] = [];
  for (const entry of keyVocab) {
    const native = entry.split("(")[0]?.trim();
    if (native) words.push(...native.split(/\s+/u));

    const romanized = entry.match(/\(([^)]+)\)/u)?.[1]?.trim();
    if (romanized) words.push(...romanized.split(/\s+/u));
  }
  return words;
}
