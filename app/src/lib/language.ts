/**
 * The language this user practises.
 *
 * Stored on the device so the very first screen after onboarding can use it without a
 * network round trip, and mirrored to `users.target_language` so the server agrees.
 * The device copy wins on read; the server copy is best-effort.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  isLanguageCode,
  languageProfile,
  LANGUAGE_CODES,
  type LanguageCode,
  type LanguageProfile,
} from "@ammamma/core";
import { supabase } from "./supabase";

const LANGUAGE_KEY = "app.language";

/** Telugu is the launch language and the default for anyone who onboarded before the choice existed. */
const DEFAULT_LANGUAGE: LanguageCode = "te";

export const LANGUAGE_OPTIONS: ReadonlyArray<LanguageProfile> = LANGUAGE_CODES.map((code) =>
  languageProfile(code),
);

export async function readLanguage(): Promise<LanguageCode> {
  const stored = await AsyncStorage.getItem(LANGUAGE_KEY);
  return isLanguageCode(stored) ? stored : DEFAULT_LANGUAGE;
}

export async function saveLanguage(code: LanguageCode): Promise<void> {
  await AsyncStorage.setItem(LANGUAGE_KEY, code);

  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  if (userId) {
    // Best-effort: the device copy already decided what the user sees.
    await supabase.from("users").update({ target_language: code }).eq("id", userId);
  }
}

/** The current language's full profile — name, grandmother, closing lines. */
export function useLanguage() {
  return useQuery({
    queryKey: ["language"],
    queryFn: async () => languageProfile(await readLanguage()),
    staleTime: Infinity,
  });
}

export function useChangeLanguage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: saveLanguage,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["language"] });
      await queryClient.invalidateQueries({ queryKey: ["topics"] });
      await queryClient.invalidateQueries({ queryKey: ["spoken-words"] });
    },
  });
}
