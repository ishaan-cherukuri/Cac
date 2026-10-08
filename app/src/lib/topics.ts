/**
 * Topic data access.
 *
 * Types are colocated here rather than imported from the content package: it
 * depends on Node's filesystem to load JSON, which does not exist in React Native.
 * The shapes are enforced at seed time by the Zod schema; the app only reads.
 */

import { useQuery } from "@tanstack/react-query";
import { withPersona, type LanguageCode } from "@shared/core";
import { supabase } from "./supabase";
import { useLanguage } from "./language";

export type Difficulty = "easy" | "medium" | "hard";
export type EmotionalAnchor = "grandparent" | "parent" | "cousin" | "cultural";

export interface TopicTurn {
  turn_number: number;
  ai_prompt_native: string;
  ai_prompt_translit: string;
  ai_prompt_english: string;
  model_answer_native: string;
  model_answer_translit: string;
  model_answer_english: string;
  key_vocab: string[];
}

export interface Topic {
  id: string;
  target_language: LanguageCode;
  starter: boolean;
  /** `{persona}` is already filled in — screens render these fields as-is. */
  title: string;
  scenario_description: string;
  emotional_anchor: EmotionalAnchor;
  turns: TopicTurn[];
}

/** English copy: `{persona}` is filled by `withPersona` at render time. */
export const ANCHOR_LABELS: Record<EmotionalAnchor, string> = {
  grandparent: "With {persona}",
  parent: "About your parents",
  cousin: "Family",
  cultural: "Out in the world",
};

const TOPIC_COLUMNS =
  "id, target_language, starter, title, scenario_description, emotional_anchor, turns";

/** Fills `{persona}` in every English field, so no screen has to remember to. */
function personalize(topic: Topic): Topic {
  const fill = (text: string) => withPersona(text, topic.target_language);
  return {
    ...topic,
    title: fill(topic.title),
    scenario_description: fill(topic.scenario_description),
    turns: topic.turns.map((turn) => ({
      ...turn,
      ai_prompt_english: fill(turn.ai_prompt_english),
      model_answer_english: fill(turn.model_answer_english),
    })),
  };
}

/** Topics in the user's language. */
export function useTopics() {
  const language = useLanguage();
  const code = language.data?.code;

  return useQuery({
    queryKey: ["topics", code],
    enabled: Boolean(code),
    queryFn: async (): Promise<Topic[]> => {
      // RLS filters to verified = true, so unreviewed content can never reach a user
      // even if it has been seeded. No client-side filter needed.
      const { data, error } = await supabase
        .from("topics")
        .select(TOPIC_COLUMNS)
        .eq("target_language", code)
        .order("emotional_anchor");

      if (error) throw new Error(error.message);
      return ((data ?? []) as Topic[]).map(personalize);
    },
  });
}

export function useTopic(topicId: string | undefined) {
  return useQuery({
    queryKey: ["topic", topicId],
    enabled: Boolean(topicId),
    queryFn: async (): Promise<Topic> => {
      const { data, error } = await supabase
        .from("topics")
        .select(TOPIC_COLUMNS)
        .eq("id", topicId)
        .single();

      if (error) throw new Error(error.message);
      return personalize(data as Topic);
    },
  });
}

/**
 * The conversation a brand-new user drops into. The content marks one starter per
 * language; if that one is still awaiting review (and so hidden), the first visible
 * grandparent topic stands in, then anything at all.
 */
export function pickStarterTopic(topics: readonly Topic[]): Topic | undefined {
  return (
    topics.find((topic) => topic.starter) ??
    topics.find((topic) => topic.emotional_anchor === "grandparent") ??
    topics[0]
  );
}

/** Session count for the home screen. SPEC section 3.4: a count, nothing more. */
export function useSessionCount() {
  return useQuery({
    queryKey: ["session-count"],
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from("sessions")
        .select("id", { count: "exact", head: true })
        .not("completed_at", "is", null);

      if (error) throw new Error(error.message);
      return count ?? 0;
    },
  });
}
