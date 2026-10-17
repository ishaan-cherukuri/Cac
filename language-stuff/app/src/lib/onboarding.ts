import AsyncStorage from "@react-native-async-storage/async-storage";

const ONBOARDED_KEY = "app.onboarded";

export type SelfAssessedLevel = "understand_only" | "some_speaking" | "improving";

export const LEVEL_OPTIONS: ReadonlyArray<{ value: SelfAssessedLevel; label: string }> = [
  { value: "understand_only", label: "I understand a lot but speak nothing" },
  { value: "some_speaking", label: "I can speak a little" },
  { value: "improving", label: "I want to get better" },
];

export async function hasOnboarded(): Promise<boolean> {
  return (await AsyncStorage.getItem(ONBOARDED_KEY)) === "true";
}

export async function markOnboarded(): Promise<void> {
  await AsyncStorage.setItem(ONBOARDED_KEY, "true");
}
