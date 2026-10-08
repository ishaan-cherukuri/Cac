import { View, Text, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { APP_NAME } from "@ammamma/core";

/**
 * Onboarding 1 of 3 — SPEC section 3.2: the premise, nothing else. The language itself
 * is chosen on the next screen, so this copy speaks to every family's language.
 */
export default function Welcome() {
  const router = useRouter();

  return (
    <SafeAreaView className="flex-1 bg-cream">
      <View className="flex-1 justify-center px-8">
        <Text className="text-native text-ink">{APP_NAME}</Text>

        <Text className="mt-6 text-3xl leading-10 text-ink">
          You understand your family's language.{"\n"}You just haven't spoken it.
        </Text>

        <Text className="mt-5 text-lg leading-7 text-ink-soft">
          That's not a gap in you. Nobody ever gave you a place to practise where it
          didn't matter if you got it wrong.
        </Text>

        <Text className="mt-3 text-lg leading-7 text-ink-soft">
          This is that place.
        </Text>
      </View>

      <View className="px-8 pb-10">
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/onboarding/level")}
          className="items-center rounded-2xl bg-clay py-5 active:bg-clay-dark"
        >
          <Text className="text-lg font-semibold text-cream">Start</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
