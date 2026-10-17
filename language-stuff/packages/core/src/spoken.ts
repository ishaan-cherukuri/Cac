/**
 * Which of a turn's key vocabulary the user actually said.
 *
 * Drives "Words you've said". The rule is evidence: a word counts only if it appears in
 * the transcript of the user's own speech. Being judged "understood" is not enough —
 * an answer can land without using the word the turn was teaching.
 *
 * Matching is deliberately forgiving about endings. Telugu and Hindi both inflect
 * heavily, and the vocab lists dictionary forms: the list says मनाना/"manaana" (to
 * celebrate) but the user says मनाई/"manaayi" (celebrated). So each vocab word is cut
 * back to a stem and matched as a prefix of a spoken word. The stem keeps enough of the
 * word that unrelated words rarely collide; tests pin the cases that matter.
 */

export interface VocabEntry {
  native: string;
  translit: string;
  meaning: string;
}

export interface SpokenVocab extends VocabEntry {
  /** Position in the turn's key_vocab — with topic and turn, it locates the word's audio clip. */
  index: number;
}

/** Parses `native (translit) — meaning`. Returns null for anything else rather than guessing. */
export function parseVocabEntry(entry: string): VocabEntry | null {
  const match = entry.match(/^\s*([^()]+?)\s*\(([^()]+)\)\s*—\s*(.+?)\s*$/u);
  if (!match) return null;
  const [, native, translit, meaning] = match;
  if (!native || !translit || !meaning) return null;
  return { native, translit, meaning };
}

/** Lowercase, NFC, punctuation and quotes removed, whitespace-split. */
function tokenize(text: string): string[] {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, " ")
    .split(/\s+/u)
    .filter(Boolean);
}

/**
 * A dictionary word cut back to the part that survives inflection.
 *
 * Counted in code points, so a Devanagari or Telugu vowel sign counts as one. Endings
 * in both languages are one or two code points (ా/ु, ना/ను), so dropping that many from
 * longer words leaves the root. Short words are matched whole: there is not enough of
 * them to cut without colliding with other words.
 */
function stem(word: string): string {
  const chars = [...word];
  if (chars.length >= 5) return chars.slice(0, -2).join("");
  if (chars.length === 4) return chars.slice(0, -1).join("");
  return word;
}

/** True if `phraseWords` appear, in order and adjacent, among `spoken`. */
function containsPhrase(spoken: readonly string[], phraseWords: readonly string[]): boolean {
  if (phraseWords.length === 0) return false;
  const stems = phraseWords.map(stem);
  for (let start = 0; start + stems.length <= spoken.length; start++) {
    if (stems.every((wordStem, offset) => spoken[start + offset]?.startsWith(wordStem))) {
      return true;
    }
  }
  return false;
}

/**
 * The key-vocab entries present in a transcript.
 *
 * Checks the native-script form (what speech-to-text normally returns) and the
 * romanized form (what it returns when the user's speech came out partly as English
 * letters). Malformed vocab entries are skipped, never thrown on — a content typo must
 * not break a live turn.
 */
export function findSpokenVocab(transcript: string, keyVocab: readonly string[]): SpokenVocab[] {
  const spoken = tokenize(transcript);
  if (spoken.length === 0) return [];

  const found: SpokenVocab[] = [];
  keyVocab.forEach((raw, index) => {
    const entry = parseVocabEntry(raw);
    if (!entry) return;
    if (
      containsPhrase(spoken, tokenize(entry.native)) ||
      containsPhrase(spoken, tokenize(entry.translit))
    ) {
      found.push({ ...entry, index });
    }
  });
  return found;
}
