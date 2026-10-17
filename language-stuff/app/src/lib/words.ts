/**
 * "Words you've said" — vocabulary the user has spoken out loud, newest first.
 *
 * Read-only from the app. Rows are written by the `turn` function, and only when the
 * word was actually in the transcript of the user's speech (see packages/core/src/spoken.ts).
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { useLanguage } from "./language";

export interface SpokenWordRow {
  word_native: string;
  word_translit: string;
  meaning: string;
  topic_id: string | null;
  turn_number: number;
  vocab_index: number;
  first_spoken_at: string;
}

export function useSpokenWords() {
  const language = useLanguage();
  const code = language.data?.code;

  return useQuery({
    queryKey: ["spoken-words", code],
    enabled: Boolean(code),
    queryFn: async (): Promise<SpokenWordRow[]> => {
      // RLS limits this to the signed-in user's own rows.
      const { data, error } = await supabase
        .from("spoken_words")
        .select("word_native, word_translit, meaning, topic_id, turn_number, vocab_index, first_spoken_at")
        .eq("language", code)
        .order("first_spoken_at", { ascending: false });

      if (error) throw new Error(error.message);
      return (data ?? []) as SpokenWordRow[];
    },
  });
}
