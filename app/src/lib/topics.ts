/**
 * Topic data access.
 *
 * Types are colocated here rather than imported from @ammamma/content: that package
 * depends on Node's filesystem to load JSON, which does not exist in React Native.
 * The shapes are enforced at seed time by the Zod schema; the app only reads.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";

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
  title: string;
  scenario_description: string;
  emotional_anchor: EmotionalAnchor;
  turns: TopicTurn[];
}

export const ANCHOR_LABELS: Record<EmotionalAnchor, string> = {
  grandparent: "With Ammamma",
  parent: "About your parents",
  cousin: "Family",
  cultural: "Out in the world",
};

export function useTopics() {
  return useQuery({
    queryKey: ["topics"],
    queryFn: async (): Promise<Topic[]> => {
      // RLS filters to verified = true, so unreviewed Telugu can never reach a user
      // even if it has been seeded. No client-side filter needed.
      const { data, error } = await supabase
        .from("topics")
        .select("id, title, scenario_description, emotional_anchor, turns")
        .order("emotional_anchor");

      if (error) throw new Error(error.message);
      return (data ?? []) as Topic[];
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
        .select("id, title, scenario_description, emotional_anchor, turns")
        .eq("id", topicId)
        .single();

      if (error) throw new Error(error.message);
      return data as Topic;
    },
  });
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
