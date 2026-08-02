import { useState } from "react";
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { LEVEL_OPTIONS, markOnboarded, type SelfAssessedLevel } from "@/lib/onboarding";
import { supabase, ensureSignedIn } from "@/lib/supabase";

/**
 * Onboarding 2 of 3 — self-assessment.
 *
 * Screen 3 is not a screen: SPEC section 3.2 says the first topic starts immediately,
 * so choosing a level drops the user straight into a conversation. No signup wall,
 * no tour, no permission pre-prompt.
 */
export default function LevelSelection() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  async function choose(level: SelfAssessedLevel) {
    setSaving(true);
    setFailed(false);
    try {
      const userId = await ensureSignedIn();
      await supabase.from("users").update({ self_assessed_level: level }).eq("id", userId);
      await markOnboarded();
      router.replace("/home?firstRun=1");
    } catch {
      // Never strand the user on a failed write — the level is a nice-to-have, and
      // blocking the first session on it would trade the whole aha moment for a field.
      setFailed(true);
      await markOnboarded().catch(() => {});
      router.replace("/home?firstRun=1");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-cream">
      <View className="flex-1 justify-center px-8">
        <Text className="text-3xl leading-10 text-ink">Where are you right now?</Text>
        <Text className="mt-3 text-lg text-ink-soft">
          There's no wrong answer. Nobody sees this.
        </Text>

        <View className="mt-10">
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

        {saving ? (
          <View className="flex-row items-center justify-center">
            <ActivityIndicator color="#C86B4A" />
            <Text className="ml-3 text-ink-soft">Getting Ammamma…</Text>
          </View>
        ) : null}

        {failed ? (
          <Text className="text-center text-ink-faint">Carrying on — we'll save that later.</Text>
        ) : null}
      </View>
    </SafeAreaView>
  );
}
