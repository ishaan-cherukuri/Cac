/**
 * Topic content schema — SPEC section 6, with two additions.
 *
 * ADDITION 1: `*_translit` fields. The SPEC schema stores only Telugu script and
 * English. But the target user is a receptive bilingual: they understand spoken Telugu
 * and usually CANNOT read the script — script literacy and speech are separate skills,
 * and heritage speakers overwhelmingly have the second without the first. Showing only
 * Telugu script would make every on-screen hint unreadable to the people this app is
 * for. Transliteration is the hint that actually works.
 *
 * ADDITION 2: `verified`. SPEC section 7 requires native-speaker review before ship.
 * A boolean in the data makes that gate enforceable in code instead of a promise.
 */

import { z } from "zod";

export const EMOTIONAL_ANCHORS = ["grandparent", "parent", "cousin", "cultural"] as const;
export const DIFFICULTIES = ["easy", "medium", "hard"] as const;

export type EmotionalAnchor = (typeof EMOTIONAL_ANCHORS)[number];
export type Difficulty = (typeof DIFFICULTIES)[number];

export const turnSchema = z.object({
  turn_number: z.number().int().positive(),

  /** What Ammamma says, in Telugu script. */
  ai_prompt_native: z.string().min(1),
  /** Romanized, for users who speak Telugu but don't read it. */
  ai_prompt_translit: z.string().min(1),
  /** Shown only if the user taps for help. */
  ai_prompt_english: z.string().min(1),

  /** The ideal user response — spoken verbatim in easy mode, hinted at in medium. */
  model_answer_native: z.string().min(1),
  model_answer_translit: z.string().min(1),
  model_answer_english: z.string().min(1),

  /** Surfaced as the medium-difficulty hint. Empty is legal; a turn may need no vocab. */
  key_vocab: z.array(z.string().min(1)),
});

export type Turn = z.infer<typeof turnSchema>;

export const topicSchema = z.object({
  id: z.uuid(),
  target_language: z.literal("te"),
  title: z.string().min(1),
  scenario_description: z.string().min(1),
  emotional_anchor: z.enum(EMOTIONAL_ANCHORS),

  /**
   * False until a native Telugu speaker has read this topic end to end.
   * `assertShippable` refuses to let unverified content reach a build.
   */
  verified: z.boolean(),

  turns: z
    .array(turnSchema)
    .min(5, "SPEC requires 5-8 turns per topic")
    .max(8, "SPEC requires 5-8 turns per topic")
    .refine(
      (turns) => turns.every((turn, index) => turn.turn_number === index + 1),
      "turn_number must be sequential starting at 1",
    ),
});

export type Topic = z.infer<typeof topicSchema>;

export const topicFileSchema = z.array(topicSchema);

// --- Collection-level rules -------------------------------------------------

/** SPEC section 7: at least 40% grandparent, 30% parent, 30% general life. */
export const ANCHOR_TARGETS = { grandparent: 0.4, parent: 0.3, general: 0.3 } as const;

export interface AnchorBalance {
  counts: Record<EmotionalAnchor, number>;
  total: number;
  grandparentShare: number;
  parentShare: number;
  generalShare: number;
  meetsSpec: boolean;
  problems: string[];
}

export function analyzeAnchorBalance(topics: Topic[]): AnchorBalance {
  const counts: Record<EmotionalAnchor, number> = {
    grandparent: 0,
    parent: 0,
    cousin: 0,
    cultural: 0,
  };
  for (const topic of topics) counts[topic.emotional_anchor]++;

  const total = topics.length;
  // "General life" is cousin + cultural — the SPEC's third bucket has no single anchor value.
  const general = counts.cousin + counts.cultural;

  const grandparentShare = total === 0 ? 0 : counts.grandparent / total;
  const parentShare = total === 0 ? 0 : counts.parent / total;
  const generalShare = total === 0 ? 0 : general / total;

  const problems: string[] = [];
  if (grandparentShare < ANCHOR_TARGETS.grandparent) {
    problems.push(
      `grandparent is ${(grandparentShare * 100).toFixed(0)}%, SPEC requires at least 40%`,
    );
  }
  if (parentShare < ANCHOR_TARGETS.parent) {
    problems.push(`parent is ${(parentShare * 100).toFixed(0)}%, SPEC requires at least 30%`);
  }
  if (generalShare < ANCHOR_TARGETS.general) {
    problems.push(
      `general life (cousin + cultural) is ${(generalShare * 100).toFixed(0)}%, SPEC requires at least 30%`,
    );
  }

  return {
    counts,
    total,
    grandparentShare,
    parentShare,
    generalShare,
    meetsSpec: problems.length === 0,
    problems,
  };
}

/** SPEC section 3.1 calls for 20-30 hand-curated topics. */
export const MIN_TOPICS = 20;
export const MAX_TOPICS = 30;

export class UnverifiedContentError extends Error {
  constructor(unverified: Topic[]) {
    super(
      `${unverified.length} topic(s) have not been reviewed by a native Telugu speaker:\n` +
        unverified.map((topic) => `  - ${topic.title}`).join("\n") +
        `\n\nSee content/REVIEW.md. Flip "verified" to true only after a real review.`,
    );
    this.name = "UnverifiedContentError";
  }
}

/** Call before anything user-facing ships. Throws rather than warns — warnings get ignored. */
export function assertShippable(topics: Topic[]): void {
  const unverified = topics.filter((topic) => !topic.verified);
  if (unverified.length > 0) throw new UnverifiedContentError(unverified);
}
