import { useState } from "react";
import { View, Text, Pressable } from "react-native";
import {
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  RecordingPresets,
} from "expo-audio";
import * as Sharing from "expo-sharing";

export interface VoiceNoteLine {
  native: string;
  translit: string;
  english: string;
}

type Step = "idle" | "recording" | "recorded";

/**
 * "Send it to your real grandmother."
 *
 * The practice exists so the user can talk to an actual person. This card closes that
 * loop: say one line from today's conversation and send it through the phone's own
 * share sheet (WhatsApp, iMessage, anything).
 *
 * Privacy: the clip is recorded to the app's cache and goes nowhere unless the user
 * shares it themselves. It is never uploaded, which keeps the rule that the app never
 * persists user audio on a server.
 */
export function VoiceNoteCard({ line, persona }: { line: VoiceNoteLine; persona: string }) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const player = useAudioPlayer();
  const playerStatus = useAudioPlayerStatus(player);
  const [step, setStep] = useState<Step>("idle");
  const [clipUri, setClipUri] = useState<string | null>(null);
  const [shareUnavailable, setShareUnavailable] = useState(false);

  async function startRecording() {
    player.pause();
    await recorder.prepareToRecordAsync();
    recorder.record();
    setStep("recording");
  }

  async function stopRecording() {
    await recorder.stop();
    setClipUri(recorder.uri);
    setStep(recorder.uri ? "recorded" : "idle");
  }

  function playBack() {
    if (!clipUri) return;
    player.replace({ uri: clipUri });
    player.play();
  }

  async function send() {
    if (!clipUri) return;
    if (!(await Sharing.isAvailableAsync())) {
      setShareUnavailable(true);
      return;
    }
    await Sharing.shareAsync(clipUri, {
      mimeType: "audio/m4a",
      UTI: "public.mpeg-4-audio",
      dialogTitle: `Send to ${persona}`,
    });
  }

  return (
    <View className="w-full rounded-2xl border border-cream-deep bg-white/60 px-5 py-5">
      <Text className="text-xs uppercase tracking-wide text-ink-faint">
        Send {persona} something you said today
      </Text>
      <Text className="mt-3 text-native-sm text-ink">{line.native}</Text>
      <Text className="mt-1 text-base italic text-ink-soft">{line.translit}</Text>
      <Text className="mt-1 text-base text-ink-faint">{line.english}</Text>

      <View className="mt-5 flex-row flex-wrap">
        {step === "recording" ? (
          <CardButton label="Done" onPress={() => void stopRecording()} primary />
        ) : (
          <CardButton
            label={step === "recorded" ? "Record again" : "Record it"}
            onPress={() => void startRecording()}
            primary={step === "idle"}
          />
        )}
        {step === "recorded" ? (
          <>
            <CardButton
              label={playerStatus.playing ? "Playing…" : "Listen"}
              onPress={playBack}
            />
            <CardButton label={`Send to ${persona}`} onPress={() => void send()} primary />
          </>
        ) : null}
      </View>

      <Text className="mt-4 text-sm leading-5 text-ink-faint">
        {step === "recording"
          ? "Say it the way you'd say it to her."
          : shareUnavailable
            ? "Sharing isn't available on this device."
            : "It stays on your phone unless you send it."}
      </Text>
    </View>
  );
}

function CardButton({
  label,
  onPress,
  primary = false,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      className={`mb-2 mr-2 rounded-2xl px-5 py-3 ${
        primary ? "bg-clay active:bg-clay-dark" : "border border-cream-deep active:bg-cream-deep"
      }`}
    >
      <Text className={`font-semibold ${primary ? "text-cream" : "text-ink"}`}>{label}</Text>
    </Pressable>
  );
}
