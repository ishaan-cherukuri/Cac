import { View, Text, Pressable, FlatList, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAudioPlayer } from "expo-audio";
import { useLanguage } from "@/lib/language";
import { useSpokenWords, type SpokenWordRow } from "@/lib/words";
import { vocabAudioUrl } from "@/lib/audio";

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric" });

/**
 * Words you've said — every vocabulary word the user has spoken out loud, newest first.
 *
 * Deliberately a list and not a score: no total, no goal, no "level". CLAUDE.md forbids
 * gamification, and the point is the opposite of a test. It is evidence, kept like a
 * diary: you said this, on this day. Each word plays back in her voice.
 */
export default function Words() {
  const router = useRouter();
  const language = useLanguage();
  const words = useSpokenWords();
  const player = useAudioPlayer();
  const persona = language.data?.personaName ?? "";

  function play(word: SpokenWordRow) {
    if (!word.topic_id) return;
    // A missing clip is silent, never an error: the word is on screen either way.
    try {
      player.replace({ uri: vocabAudioUrl(word.topic_id, word.turn_number, word.vocab_index) });
      player.play();
    } catch {
      /* text-only */
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-cream">
      <FlatList
        data={words.data ?? []}
        keyExtractor={(word) => word.word_native}
        contentContainerClassName="px-6 pb-10"
        ListHeaderComponent={
          <View className="pb-6 pt-4">
            <Pressable accessibilityRole="button" onPress={() => router.back()}>
              <Text className="text-base text-ink-faint">Back</Text>
            </Pressable>
            <Text className="mt-6 text-3xl text-ink">Words you've said</Text>
            <Text className="mt-2 text-base leading-6 text-ink-soft">
              Every word here came out of your mouth, in a conversation with {persona}.
            </Text>
          </View>
        }
        ListEmptyComponent={
          words.isPending ? (
            <ActivityIndicator color="#C86B4A" />
          ) : words.isError ? (
            <Text className="text-center text-base leading-6 text-ink-soft">
              Couldn't fetch your words just now. They're safe — try again in a moment.
            </Text>
          ) : (
            <Text className="text-center text-base leading-6 text-ink-soft">
              Nothing yet. The first word you say to {persona} will be waiting here.
            </Text>
          )
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Hear ${persona} say ${item.word_translit}`}
            onPress={() => play(item)}
            className="mb-3 flex-row items-center rounded-2xl border border-cream-deep bg-white/60 px-5 py-4 active:bg-cream-deep"
          >
            <View className="flex-1">
              <Text className="text-native-sm text-ink">{item.word_native}</Text>
              <Text className="text-base italic text-ink-soft">
                {item.word_translit} — {item.meaning}
              </Text>
            </View>
            <View className="items-end">
              <Text className="text-sm text-clay-dark">▶︎</Text>
              <Text className="mt-1 text-xs text-ink-faint">
                {DATE_FORMAT.format(new Date(item.first_spoken_at))}
              </Text>
            </View>
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}
