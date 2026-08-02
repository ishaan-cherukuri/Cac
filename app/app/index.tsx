import { useEffect, useState } from "react";
import { View, ActivityIndicator, Text } from "react-native";
import { Redirect } from "expo-router";
import { hasOnboarded } from "@/lib/onboarding";

/**
 * Entry point. Decides between onboarding and home.
 *
 * SPEC section 9 requires no blank screens on cold open, so this renders a warm
 * loading state rather than nothing while the check runs.
 */
export default function Index() {
  const [onboarded, setOnboarded] = useState<boolean | null>(null);

  useEffect(() => {
    // Not data fetching — a one-shot local storage read for a routing decision.
    hasOnboarded()
      .then(setOnboarded)
      .catch(() => setOnboarded(false));
  }, []);

  if (onboarded === null) {
    return (
      <View className="flex-1 items-center justify-center bg-cream">
        <ActivityIndicator color="#C86B4A" />
        <Text className="mt-4 text-ink-soft">One moment…</Text>
      </View>
    );
  }

  return <Redirect href={onboarded ? "/home" : "/onboarding"} />;
}
