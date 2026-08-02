import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  useAudioRecorder,
  useAudioPlayer,
  useAudioPlayerStatus,
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
} from "expo-audio";
import {
  createSession,
  resolveTurn,
  applyOutcome,
  buildFillInTheBlanks,
  extractVocabWords,
  type BlankToken,
  type SessionState,
  type Difficulty,
} from "@ammamma/core";
import { useTopic, type TopicTurn } from "@/lib/topics";
// formatRemaining is intentionally not imported: the countdown was removed from the UI.
// useSessionClock stays — it is what enforces the 5-minute cap.
import { useSessionClock } from "@/lib/useSessionClock";
import { startSession, submitTurn } from "@/lib/turn";
// answerAudioUrl is intentionally not imported: Ammamma speaks only her questions now.
// The generated answer clips remain in storage, unused, in case that decision reverses.
import { promptAudioUrl } from "@/lib/audio";

type Phase = "choosing" | "listening" | "recording" | "thinking" | "ended";

const DIFFICULTY_COPY: Record<Difficulty, { label: string; blurb: string }> = {
  easy: {
    label: "Just repeat after her",
    blurb: "Ammamma says it first. You say it back. Nothing to work out.",
  },
  medium: {
    label: "Give me a nudge",
    blurb: "She'll start the sentence and hand you a word or two.",
  },
  hard: {
    label: "Let me try on my own",
    blurb: "She asks. You answer. Take as long as you need.",
  },
};

/** SPEC 3.1: how much of the answer is shown depends entirely on difficulty. */
function Scaffolding({ turn, difficulty }: { turn: TopicTurn; difficulty: Difficulty }) {
  if (difficulty === "hard") return null;

  if (difficulty === "easy") {
    return (
      <View className="mt-8 rounded-2xl bg-cream-deep px-5 py-5">
        <Text className="text-xs uppercase tracking-wide text-ink-faint">Say this back</Text>
        <Text className="mt-2 text-telugu-sm text-ink">{turn.model_answer_native}</Text>
        <Text className="mt-1 text-base italic text-ink-soft">{turn.model_answer_translit}</Text>
        <Text className="mt-2 text-base text-ink-faint">{turn.model_answer_english}</Text>
      </View>
    );
  }

  // Medium is fill-in-the-blanks over the whole sentence. Showing the full shape of the
  // answer with gaps in it constrains the response far more than a sentence starter did —
  // there is no room left to improvise a different sentence.
  const preferredWords = extractVocabWords(turn.key_vocab);
  const translitTokens = buildFillInTheBlanks(turn.model_answer_translit, { preferredWords });

  // Blank the Telugu script at the same positions when the two line up word-for-word,
  // so script and romanization show the same gaps. If they tokenize differently, blank
  // the script independently — either way it must never display the missing word.
  const blankIndices = new Set(
    translitTokens.flatMap((token, index) => (token.kind === "blank" ? [index] : [])),
  );
  const nativeWords = turn.model_answer_native.trim().split(/\s+/u);
  const nativeTokens =
    nativeWords.length === translitTokens.length
      ? nativeWords.map((text, index) =>
          blankIndices.has(index)
            ? ({ kind: "blank", answer: text } as const)
            : ({ kind: "word", text } as const),
        )
      : buildFillInTheBlanks(turn.model_answer_native, { preferredWords });

  const renderTokens = (tokens: readonly BlankToken[], className: string) => (
    <Text className={className}>
      {tokens.map((token, index) => (
        <Text key={index}>
          {index > 0 ? " " : ""}
          {token.kind === "blank" ? (
            <Text className="text-clay-dark">{"_".repeat(Math.max(4, token.answer.length))}</Text>
          ) : (
            token.text
          )}
        </Text>
      ))}
    </Text>
  );

  return (
    <View className="mt-8 rounded-2xl bg-cream-deep px-5 py-5">
      <Text className="text-xs uppercase tracking-wide text-ink-faint">
        Say the whole sentence
      </Text>
      {renderTokens(nativeTokens, "mt-3 text-telugu-sm text-ink")}
      {renderTokens(translitTokens, "mt-2 text-lg italic text-ink-soft")}
      <Text className="mt-3 text-base leading-6 text-ink-faint">
        {turn.model_answer_english}
      </Text>
      {turn.key_vocab.length > 0 ? (
        <View className="mt-4 border-t border-cream pt-3">
          {turn.key_vocab.map((vocab) => (
            <Text key={vocab} className="text-base leading-6 text-ink-soft">
              {vocab}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export default function SessionScreen() {
  const router = useRouter();
  // `difficulty` is optional: a deep link may open a session straight at a level,
  // skipping the picker. Used by notifications ("your grandmother is waiting") and by
  // the simulator smoke checks.
  const { topicId, difficulty: difficultyParam } = useLocalSearchParams<{
    topicId: string;
    difficulty?: string;
  }>();
  const topic = useTopic(topicId);

  const [phase, setPhase] = useState<Phase>("choosing");
  const [difficulty, setDifficulty] = useState<Difficulty>("medium");
  const [state, setState] = useState<SessionState | null>(null);
  const [closing, setClosing] = useState<string | null>(null);
  const [micDenied, setMicDenied] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [spoken, setSpoken] = useState<string | null>(null);
  const [hiccup, setHiccup] = useState(false);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  // Three players rather than one: the scripted prompt, the easy-mode model answer, and
  // Ammamma's live reply are independent sources, and sharing a player means one
  // replace() call cutting another line off mid-word.
  const promptPlayer = useAudioPlayer();
  const replyPlayer = useAudioPlayer();
  const promptStatus = useAudioPlayerStatus(promptPlayer);
  const replyStatus = useAudioPlayerStatus(replyPlayer);

  // Never start recording over her. Cutting Ammamma off mid-sentence is the one thing
  // that most breaks the illusion of talking to a person, so Speak stays disabled until
  // she has actually finished.
  const ammammaSpeaking = promptStatus.playing || replyStatus.playing;
  const clock = useSessionClock(state?.startedAt ?? null);

  const currentTurn: TopicTurn | undefined = useMemo(() => {
    if (!topic.data || !state) return undefined;
    return topic.data.turns[state.currentTurn - 1];
  }, [topic.data, state]);

  const finish = useCallback((reason: "time_limit" | "topic_complete") => {
    setPhase("ended");
    setClosing(
      reason === "topic_complete"
        ? "సరే కన్నా. మళ్ళీ మాట్లాడు."
        : "ఇంక చాలు కన్నా. రేపు మళ్ళీ మాట్లాడుకుందాం.",
    );
  }, []);

  // SPEC 3.1: the loop is "AI speaks -> user records -> AI responds". Ammamma has to
  // open her mouth first. These lines are pre-generated (scripts/pregenerate-audio.mjs)
  // so there is no TTS wait here at all — the audio is a CDN fetch.
  const spokenForTurn = useRef<number | null>(null);
  useEffect(() => {
    if (phase !== "listening" || !state || !topicId) return;
    if (spokenForTurn.current === state.currentTurn) return;
    spokenForTurn.current = state.currentTurn;

    // A missing clip must never block the turn — the text is on screen regardless, and
    // silence is a smaller failure than a stuck session.
    try {
      promptPlayer.replace({ uri: promptAudioUrl(topicId, state.currentTurn) });
      promptPlayer.play();
    } catch {
      /* text-only fallback */
    }
  }, [phase, state, topicId, promptPlayer]);

  // NOTE: Ammamma speaks ONLY her questions. She used to also speak the easy-mode model
  // answer (SPEC 3.1 describes that as pure shadowing), but hearing the line you are
  // about to say read aloud to you turned out to feel patronising rather than helpful.
  // The answer stays on screen as a written prompt; the voice is reserved for her side
  // of the conversation.

  // Honour a difficulty supplied in the deep link, once, on first load.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoStarted.current || phase !== "choosing" || !topic.data) return;
    if (difficultyParam !== "easy" && difficultyParam !== "medium" && difficultyParam !== "hard") {
      return;
    }
    autoStarted.current = true;
    void begin(difficultyParam);
    // begin() is stable for this purpose; re-running on its identity would restart the
    // session on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [difficultyParam, phase, topic.data]);

  // The cap is enforced here as well as inside applyOutcome, so a user who simply sits
  // on the screen without speaking still gets a warm ending at five minutes rather than
  // an open-ended session.
  useEffect(() => {
    if (!clock.expired) return;
    if (phase === "listening" || phase === "recording") finish("time_limit");
  }, [clock.expired, phase, finish]);

  async function begin(chosen: Difficulty) {
    if (!topic.data) return;
    setDifficulty(chosen);

    const permission = await AudioModule.requestRecordingPermissionsAsync();
    if (!permission.granted) {
      setMicDenied(true);
      return;
    }
    await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });

    // The server row is the source of truth for elapsed time, so the cap survives an
    // app kill. If it cannot be created we still start locally rather than blocking the
    // user out of their session — SPEC section 4 puts the aha moment above bookkeeping.
    try {
      const opened = await startSession(topic.data.id, chosen);
      setSessionId(opened.sessionId);
      setState(createSession(opened.startedAt, topic.data.turns.length));
    } catch {
      setSessionId(null);
      setState(createSession(Date.now(), topic.data.turns.length));
    }
    setPhase("listening");
  }

  async function startRecording() {
    await recorder.prepareToRecordAsync();
    recorder.record();
    setPhase("recording");
  }

  async function stopRecording() {
    setPhase("thinking");
    setHiccup(false);
    await recorder.stop();

    if (!state) return;
    const recordingUri = recorder.uri;

    // Ask the server what Ammamma says next. If anything in that chain fails, the
    // session still advances warmly using the local state machine — SPEC section 10:
    // never leave the user stuck, and never let an outage read as a judgement about
    // their speaking.
    if (sessionId && recordingUri) {
      try {
        const result = await submitTurn({
          sessionId,
          clientTurn: state.currentTurn,
          recordingUri,
        });

        setSpoken(result.reply.text || null);
        if (result.audioUri) {
          replyPlayer.replace({ uri: result.audioUri });
          replyPlayer.play();
        }

        if (result.status === "ended") {
          finish(result.reason ?? "topic_complete");
          return;
        }

        const advanced = applyOutcome(
          state,
          { kind: result.outcome === "retry" ? "retry" : "advance" },
          Date.now(),
        );
        setState(advanced.state);
        if (advanced.ended) {
          finish(advanced.ended);
          return;
        }
        setPhase("listening");
        return;
      } catch {
        setHiccup(true);
      }
    }

    const outcome = resolveTurn(state, true);
    const progress = applyOutcome(state, outcome, Date.now());
    setState(progress.state);

    if (progress.ended) {
      finish(progress.ended);
      return;
    }
    setPhase("listening");
  }

  // --- Loading and error states (SPEC section 9: never a blank screen) --------

  if (topic.isPending) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-cream">
        <ActivityIndicator color="#C86B4A" />
        <Text className="mt-4 text-ink-soft">Ammamma is sitting down…</Text>
      </SafeAreaView>
    );
  }

  if (topic.isError || !topic.data) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-cream px-8">
        <Text className="text-center text-xl leading-8 text-ink">
          Couldn't open this conversation.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.back()}
          className="mt-8 rounded-2xl bg-clay px-8 py-4 active:bg-clay-dark"
        >
          <Text className="font-semibold text-cream">Go back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  if (micDenied) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-cream px-8">
        <Text className="text-center text-xl leading-8 text-ink">
          Ammamma can't hear you yet.
        </Text>
        <Text className="mt-3 text-center text-base leading-6 text-ink-soft">
          Turn on the microphone for this app in Settings, and she'll be waiting.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.back()}
          className="mt-8 rounded-2xl bg-clay px-8 py-4 active:bg-clay-dark"
        >
          <Text className="font-semibold text-cream">Go back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  // --- Difficulty selection (SPEC step 6) ------------------------------------

  if (phase === "choosing") {
    return (
      <SafeAreaView className="flex-1 bg-cream">
        <ScrollView contentContainerClassName="px-6 pb-10 pt-4">
          <Pressable accessibilityRole="button" onPress={() => router.back()}>
            <Text className="text-base text-ink-faint">Not now</Text>
          </Pressable>

          <Text className="mt-6 text-3xl leading-10 text-ink">{topic.data.title}</Text>
          <Text className="mt-3 text-lg leading-7 text-ink-soft">
            {topic.data.scenario_description}
          </Text>

          <Text className="mt-10 text-xs uppercase tracking-wide text-ink-faint">
            How much help today?
          </Text>

          {(["easy", "medium", "hard"] as const).map((level) => (
            <Pressable
              key={level}
              accessibilityRole="button"
              onPress={() => void begin(level)}
              className="mt-3 rounded-2xl border border-cream-deep bg-white/60 px-5 py-5 active:bg-cream-deep"
            >
              <Text className="text-lg text-ink">{DIFFICULTY_COPY[level].label}</Text>
              <Text className="mt-1 text-base leading-6 text-ink-soft">
                {DIFFICULTY_COPY[level].blurb}
              </Text>
            </Pressable>
          ))}

          <Text className="mt-8 text-center text-base text-ink-faint">
            You can change this any time. She won't mind.
          </Text>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // --- Closing (SPEC 3.1: always end warmly) ---------------------------------

  if (phase === "ended") {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-cream px-8">
        <Text className="text-center text-telugu-sm text-ink">{closing}</Text>
        <Text className="mt-6 text-center text-lg leading-7 text-ink-soft">
          You spoke Telugu today.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.replace("/home")}
          className="mt-10 rounded-2xl bg-clay px-10 py-5 active:bg-clay-dark"
        >
          <Text className="text-lg font-semibold text-cream">Done</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  // --- The conversation ------------------------------------------------------

  return (
    <SafeAreaView className="flex-1 bg-cream">
      {/* No countdown. The 5-minute cap is still enforced (see the effect above and
          applyOutcome), but a ticking clock in the corner reads as a test being timed —
          the opposite of the unhurried phone call this is meant to feel like. */}
      <View className="flex-row items-center justify-between px-6 pt-4">
        <Pressable accessibilityRole="button" onPress={() => finish("time_limit")}>
          <Text className="text-base text-ink-faint">End</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerClassName="px-6 pb-6 pt-8 grow">
        <Text className="text-xs uppercase tracking-wide text-ink-faint">Ammamma</Text>
        <Text className="mt-3 text-telugu text-ink">{currentTurn?.ai_prompt_native}</Text>
        <Text className="mt-2 text-lg italic text-ink-soft">
          {currentTurn?.ai_prompt_translit}
        </Text>
        <Text className="mt-3 text-base leading-6 text-ink-faint">
          {currentTurn?.ai_prompt_english}
        </Text>

        {spoken ? (
          <View className="mt-8 rounded-2xl border border-cream-deep bg-white/50 px-5 py-5">
            <Text className="text-xs uppercase tracking-wide text-ink-faint">
              She just said
            </Text>
            <Text className="mt-2 text-telugu-sm text-ink">{spoken}</Text>
          </View>
        ) : null}

        {currentTurn ? <Scaffolding turn={currentTurn} difficulty={difficulty} /> : null}

        {hiccup ? (
          // Never framed as the user's fault, and never blocking. SPEC section 10.
          <Text className="mt-6 text-base leading-6 text-ink-faint">
            Ammamma's line got lost on the way. Carrying on.
          </Text>
        ) : null}
      </ScrollView>

      <View className="items-center px-6 pb-10">
        {phase === "thinking" ? (
          <View className="items-center py-6">
            <ActivityIndicator color="#C86B4A" />
            <Text className="mt-3 text-ink-soft">Ammamma is listening…</Text>
          </View>
        ) : (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: ammammaSpeaking && phase !== "recording" }}
              accessibilityLabel={phase === "recording" ? "Stop speaking" : "Start speaking"}
              disabled={ammammaSpeaking && phase !== "recording"}
              onPress={() => void (phase === "recording" ? stopRecording() : startRecording())}
              className={`h-24 w-24 items-center justify-center rounded-full ${
                phase === "recording"
                  ? "bg-clay-dark"
                  : ammammaSpeaking
                    ? "bg-clay/40"
                    : "bg-clay"
              }`}
            >
              <Text className="text-center text-sm font-semibold text-cream">
                {phase === "recording" ? "Done" : "Speak"}
              </Text>
            </Pressable>
            <Text className="mt-4 text-center text-base text-ink-faint">
              {phase === "recording"
                ? "Take your time. Tap when you're finished."
                : ammammaSpeaking
                  ? "Ammamma is talking…"
                  : "Tap and say it out loud."}
            </Text>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}
