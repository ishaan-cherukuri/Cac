import { useState } from "react";
import { View, Text, Pressable, ActivityIndicator, ScrollView } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import type { LanguageCode } from "@shared/core";
import { LEVEL_OPTIONS, markOnboarded, type SelfAssessedLevel } from "@/lib/onboarding";
import { LANGUAGE_OPTIONS, saveLanguage } from "@/lib/language";
import { supabase, ensureSignedIn } from "@/lib/supabase";

/**
 * Onboarding 2 of 3 — which language, and where the user is with it.
 *
 * Screen 3 is not a screen: SPEC section 3.2 says the first topic starts immediately,
 * so choosing a level drops the user straight into a conversation (home reads
 * `firstRun=1` and opens the starter topic). No signup wall, no tour.
 */
export default function LevelSelection() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [language, setLanguage] = useState<LanguageCode | null>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const persona = LANGUAGE_OPTIONS.find((option) => option.code === language)?.personaName;

  async function choose(level: SelfAssessedLevel) {
    if (!language) return;
    setSaving(true);
    setFailed(false);
    try {
      const userId = await ensureSignedIn();
      await saveLanguage(language);
      await supabase.from("users").update({ self_assessed_level: level }).eq("id", userId);
    } catch {
      // Never strand the user on a failed write — the level is a nice-to-have, and
      // blocking the first session on it would trade the whole aha moment for a field.
      // The language is what matters, and it is on the device either way.
      setFailed(true);
      await saveLanguage(language).catch(() => {});
    }
    await markOnboarded().catch(() => {});
    await queryClient.invalidateQueries({ queryKey: ["language"] });
    setSaving(false);
    router.replace("/home?firstRun=1");
  }

  return (
    <SafeAreaView className="flex-1 bg-cream">
      <ScrollView contentContainerClassName="grow justify-center px-8 py-10">
        <Text className="text-3xl leading-10 text-ink">Which language does your family speak?</Text>

        <View className="mt-6 flex-row">
          {LANGUAGE_OPTIONS.map((option) => {
            const selected = option.code === language;
            return (
              <Pressable
                key={option.code}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                disabled={saving}
                onPress={() => setLanguage(option.code)}
                className={`mr-3 flex-1 items-center rounded-2xl border px-4 py-5 ${
                  selected ? "border-clay bg-clay" : "border-cream-deep bg-white/60"
                }`}
              >
                <Text className={`text-lg ${selected ? "text-cream" : "text-ink"}`}>
                  {option.name}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {language ? (
          <>
            <Text className="mt-12 text-3xl leading-10 text-ink">Where are you right now?</Text>
            <Text className="mt-3 text-lg text-ink-soft">
              There's no wrong answer. Nobody sees this.
            </Text>

            <View className="mt-8">
              {LEVEL_OPTIONS.map((option) => (
                <Pressable
                  key={option.value}
                  accessibilityRole="button"
                  disabled={saving}
                  onPress={() => void choose(option.value)}
                  className="mb-4 rounded-2xl border border-cream-deep bg-white/60 px-6 py-6 active:bg-cream-deep"
                >
                  <Text className="text-lg leading-7 text-ink">{option.label}</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}

        {saving ? (
          <View className="flex-row items-center justify-center">
            <ActivityIndicator color="#C86B4A" />
            <Text className="ml-3 text-ink-soft">Getting {persona}…</Text>
          </View>
        ) : null}

        {failed ? (
          <Text className="text-center text-ink-faint">Carrying on — we'll save that later.</Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
