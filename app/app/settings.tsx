import { View, Text, Pressable, Switch, ScrollView, Linking } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useState } from "react";

/**
 * Settings. SPEC section 9 requires a user-reporting mechanism for App Review, and
 * section 3.6 requires the daily notification to be disableable.
 */
export default function Settings() {
  const router = useRouter();
  const [notifications, setNotifications] = useState(true);

  return (
    <SafeAreaView className="flex-1 bg-cream">
      <ScrollView contentContainerClassName="px-6 pb-12">
        <View className="flex-row items-center justify-between pt-4">
          <Text className="text-3xl text-ink">Settings</Text>
          <Pressable accessibilityRole="button" onPress={() => router.back()}>
            <Text className="text-base text-ink-faint">Done</Text>
          </Pressable>
        </View>

        <View className="mt-8 rounded-2xl border border-cream-deep bg-white/60 px-5 py-5">
          <View className="flex-row items-center justify-between">
            <View className="flex-1 pr-4">
              <Text className="text-lg text-ink">A note from Ammamma</Text>
              <Text className="mt-1 text-base leading-6 text-ink-soft">
                Once a day, no more. Turn it off whenever you like.
              </Text>
            </View>
            <Switch
              value={notifications}
              onValueChange={setNotifications}
              trackColor={{ true: "#C86B4A", false: "#D9CBBB" }}
            />
          </View>
        </View>

        <Text className="mt-10 text-xs uppercase tracking-wide text-ink-faint">Support</Text>

        <Pressable
          accessibilityRole="button"
          onPress={() => void Linking.openURL("mailto:support@ammamma.app?subject=Reporting%20a%20problem")}
          className="mt-3 rounded-2xl border border-cream-deep bg-white/60 px-5 py-5 active:bg-cream-deep"
        >
          <Text className="text-lg text-ink">Report a problem</Text>
          <Text className="mt-1 text-base leading-6 text-ink-soft">
            Something Ammamma said that felt wrong? Tell us and we'll look at it.
          </Text>
        </Pressable>

        <View className="mt-10">
          <Text className="text-base leading-6 text-ink-faint">
            Ammamma speaks Coastal Andhra Telugu. She never corrects you, and she never
            keeps score.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
