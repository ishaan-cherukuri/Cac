/**
 * Loads and validates the topic corpus from `content/topics/*.json`.
 *
 * The loader is strict on purpose: bad content should fail at build time, not as a
 * confusing empty screen in front of a user who is already nervous about speaking.
 */

import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { topicFileSchema, type Topic } from "./schema.ts";

export * from "./schema.ts";

export const TOPICS_DIR = resolve(import.meta.dirname, "../../../content/topics");

export class TopicLoadError extends Error {
  constructor(file: string, detail: string) {
    super(`${file} is not valid topic content:\n${detail}`);
    this.name = "TopicLoadError";
  }
}

/**
 * Transliterations must be readable by someone who cannot read Telugu script — that is
 * the whole point of the field. Stray non-Latin characters (usually a Cyrillic or Greek
 * lookalike pasted in by accident) are invisible to review but break the one affordance
 * the target user depends on.
 */
const ALLOWED_TRANSLIT = /^[\p{Script=Latin}\p{Nd}\p{P}\p{Zs}\p{Sm}—…"'’]+$/u;

export interface TranslitProblem {
  topicTitle: string;
  turnNumber: number;
  field: "ai_prompt_translit" | "model_answer_translit";
  offending: string;
}

export function findTransliterationProblems(topics: Topic[]): TranslitProblem[] {
  const problems: TranslitProblem[] = [];

  for (const topic of topics) {
    for (const turn of topic.turns) {
      const fields = [
        ["ai_prompt_translit", turn.ai_prompt_translit],
        ["model_answer_translit", turn.model_answer_translit],
      ] as const;

      for (const [field, value] of fields) {
        if (ALLOWED_TRANSLIT.test(value)) continue;
        const offending = [...value]
          .filter((char) => !ALLOWED_TRANSLIT.test(char))
          .map((char) => `${char} (U+${char.codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0")})`)
          .join(", ");
        problems.push({ topicTitle: topic.title, turnNumber: turn.turn_number, field, offending });
      }
    }
  }

  return problems;
}

/** Duplicate ids would silently collide as primary keys once seeded into Postgres. */
export function findDuplicateIds(topics: Topic[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const topic of topics) {
    if (seen.has(topic.id)) duplicates.add(topic.id);
    seen.add(topic.id);
  }
  return [...duplicates];
}

export async function loadTopics(dir: string = TOPICS_DIR): Promise<Topic[]> {
  const entries = (await readdir(dir)).filter((name) => name.endsWith(".json")).sort();

  const topics: Topic[] = [];
  for (const entry of entries) {
    const raw = await readFile(join(dir, entry), "utf8");

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new TopicLoadError(entry, error instanceof Error ? error.message : String(error));
    }

    const result = topicFileSchema.safeParse(parsed);
    if (!result.success) {
      throw new TopicLoadError(
        entry,
        result.error.issues
          .map((issue) => `  at ${issue.path.join(".") || "<root>"}: ${issue.message}`)
          .join("\n"),
      );
    }

    topics.push(...result.data);
  }

  return topics;
}
