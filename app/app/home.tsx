import { useEffect, useState } from "react";
import { View, Text, Pressable, FlatList, ActivityIndicator } from "react-native";
import { Link, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { withPersona } from "@ammamma/core";
import {
  useTopics,
  useSessionCount,
  pickStarterTopic,
  ANCHOR_LABELS,
  type Topic,
} from "@/lib/topics";
import { useLanguage } from "@/lib/language";

function TopicCard({ topic }: { topic: Topic }) {
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(`/session/${topic.id}`)}
      className="mb-3 rounded-2xl border border-cream-deep bg-white/60 px-5 py-5 active:bg-cream-deep"
    >
      <Text className="text-xs uppercase tracking-wide text-ink-faint">
        {withPersona(ANCHOR_LABELS[topic.emotional_anchor], topic.target_language)}
      </Text>
      <Text className="mt-1 text-lg leading-7 text-ink">{topic.title}</Text>
      <Text className="mt-1 text-base leading-6 text-ink-soft" numberOfLines={2}>
        {topic.scenario_description}
      </Text>
    </Pressable>
  );
}

/**
 * Home. SPEC section 3.4 keeps this deliberately thin: a list of topics and a quiet
 * session count. No streaks, no progress bars, no calendar.
 *
 * On a first run (`firstRun=1`, set by onboarding) home does not show itself at all: it
 * opens the starter topic at the easiest level. SPEC section 3.2 — the first
 * conversation starts immediately, without a menu to choose from.
 */
export default function Home() {
  const router = useRouter();
  const { firstRun } = useLocalSearchParams<{ firstRun?: string }>();
  const language = useLanguage();
  const topics = useTopics();
  const sessionCount = useSessionCount();
  const persona = language.data?.personaName ?? "";

  // Once per mount: coming back from the session ("Not now") lands on the list, not in
  // a loop back into the conversation.
  const [openedStarter, setOpenedStarter] = useState(false);
  const starter = topics.data ? pickStarterTopic(topics.data) : undefined;
  const openingStarter = firstRun === "1" && !openedStarter && Boolean(starter);

  useEffect(() => {
    if (!openingStarter || !starter) return;
    setOpenedStarter(true);
    router.push(`/session/${starter.id}?difficulty=easy`);
  }, [openingStarter, starter, router]);

  if (topics.isPending || openingStarter) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-cream">
        <ActivityIndicator color="#C86B4A" />
        <Text className="mt-4 text-ink-soft">{persona} is putting the kettle on…</Text>
      </SafeAreaView>
    );
  }

  if (topics.isError) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-cream px-8">
        <Text className="text-center text-xl leading-8 text-ink">
          Couldn't reach {persona} just now.
        </Text>
        <Text className="mt-2 text-center text-base leading-6 text-ink-soft">
          Check your connection and try again — she'll wait.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => void topics.refetch()}
          className="mt-8 rounded-2xl bg-clay px-8 py-4 active:bg-clay-dark"
        >
          <Text className="font-semibold text-cream">Try again</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const count = sessionCount.data ?? 0;

  return (
    <SafeAreaView className="flex-1 bg-cream">
      <FlatList
        data={topics.data}
        keyExtractor={(topic) => topic.id}
        contentContainerClassName="px-6 pb-10"
        ListHeaderComponent={
          <View className="pb-6 pt-4">
            <View className="flex-row items-start justify-between">
              <Text className="text-3xl text-ink">What shall we talk about?</Text>
              <Link href="/settings" className="pl-4 pt-2 text-base text-ink-faint">
                Settings
              </Link>
            </View>
            {count > 0 ? (
              <Text className="mt-2 text-base text-ink-soft">
                {count === 1 ? "1 conversation so far" : `${count} conversations so far`}
              </Text>
            ) : null}
            <Link href="/words" className="mt-3 text-base text-clay-dark">
              Words you've said →
            </Link>
          </View>
        }
        ListEmptyComponent={
          // SPEC section 9: every screen needs a non-empty state. This one shows up
          // before the topics table has been seeded.
          <View className="items-center px-4 py-16">
            <Text className="text-center text-xl leading-8 text-ink">
              No conversations yet.
            </Text>
            <Text className="mt-2 text-center text-base leading-6 text-ink-soft">
              {persona}'s topics haven't arrived on this device. Pull to refresh, or check
              back in a moment.
            </Text>
          </View>
        }
        renderItem={({ item }) => <TopicCard topic={item} />}
        refreshing={topics.isFetching}
        onRefresh={() => void topics.refetch()}
      />
    </SafeAreaView>
  );
}
