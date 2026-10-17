/**
 * Everything that differs between practice languages, in one place.
 *
 * Adding a language is: add a profile here, add topic files tagged with its code, and
 * pick a voice. No other file branches on language — the persona prompt, the speech
 * pipeline and the app all read from this table. See docs/adr/0001-multiple-languages.md.
 *
 * Dependency-free like the rest of `core`, so the app, the Edge Functions and the
 * scripts all read the same table.
 */

export const LANGUAGE_CODES = ["te", "hi"] as const;
export type LanguageCode = (typeof LANGUAGE_CODES)[number];

/** A line in all three forms the app shows: script, romanization, English. */
export interface ScriptedLine {
  native: string;
  translit: string;
  english: string;
}

export interface LanguageProfile {
  code: LanguageCode;
  /** English name, used in prompts and UI. */
  name: string;
  /**
   * What the user calls the grandmother in this language. It is a real word in the
   * language, not a brand, so it appears in that language's dialogue as-is. English UI
   * text never hardcodes it; it uses the `{persona}` token instead (see `withPersona`).
   */
  personaName: string;
  /** Tells the model which variety to speak. Heritage speakers learned it at home, not in school. */
  register: string;
  /** Said when a generated line has to be thrown away. Must always be safe. */
  fallbackLine: ScriptedLine;
  /** Closing lines. Picked by why the session ended. */
  closing: { topicComplete: ScriptedLine; timeLimit: ScriptedLine };
  /** Steers OpenAI TTS, the fallback voice. */
  ttsInstruction: string;
  /**
   * ElevenLabs voice and model. Null voice means "not chosen yet" — /speak then goes
   * straight to the OpenAI fallback rather than reading this language with a wrong voice.
   */
  elevenLabs: { voiceId: string | null; modelId: string };
}

export const LANGUAGES: Record<LanguageCode, LanguageProfile> = {
  te: {
    code: "te",
    name: "Telugu",
    personaName: "Ammamma",
    register:
      "Coastal Andhra Telugu, the way it is spoken at home — not the formal register of textbooks or news.",
    fallbackLine: {
      native: "ఇంకొంచెం చెప్పు, నాన్నా.",
      translit: "Inkoncham cheppu, naannaa.",
      english: "Tell me a little more, dear.",
    },
    closing: {
      topicComplete: {
        native: "సరే కన్నా. మళ్ళీ మాట్లాడు.",
        translit: "Sare kannaa. Malli maatlaadu.",
        english: "Alright, dear. Talk to me again.",
      },
      timeLimit: {
        native: "ఇంక చాలు కన్నా. రేపు మళ్ళీ మాట్లాడుకుందాం.",
        translit: "Inka chaalu kannaa. Repu malli maatlaadukundaam.",
        english: "That's enough, dear. Let's talk again tomorrow.",
      },
    },
    ttsInstruction:
      "Speak as a warm, unhurried Telugu grandmother talking to a grandchild she loves.",
    // eleven_v3 is the only ElevenLabs model that lists Telugu (verified against /v1/models).
    elevenLabs: { voiceId: "TLhTqATJ3nsbNZKRJQB3", modelId: "eleven_v3" },
  },
  hi: {
    code: "hi",
    name: "Hindi",
    personaName: "Nani",
    register:
      "Everyday spoken Hindi as used in a North Indian family — conversational Hindustani, not Sanskritised textbook Hindi.",
    fallbackLine: {
      native: "थोड़ा और बताओ, बेटा।",
      translit: "Thoda aur batao, beta.",
      english: "Tell me a little more, dear.",
    },
    closing: {
      topicComplete: {
        native: "अच्छा बेटा। फिर बात करना।",
        translit: "Accha beta. Phir baat karna.",
        english: "Alright, dear. Talk to me again.",
      },
      timeLimit: {
        native: "बस, आज इतना ही बेटा। कल फिर बात करेंगे।",
        translit: "Bas, aaj itna hi beta. Kal phir baat karenge.",
        english: "That's enough for today, dear. Let's talk again tomorrow.",
      },
    },
    ttsInstruction:
      "Speak as a warm, unhurried Hindi-speaking grandmother talking to a grandchild she loves.",
    // Voice not chosen yet — scripts/audition-voices.mjs generates candidates to pick from.
    elevenLabs: { voiceId: null, modelId: "eleven_v3" },
  },
};

export function isLanguageCode(value: unknown): value is LanguageCode {
  return typeof value === "string" && (LANGUAGE_CODES as readonly string[]).includes(value);
}

/** Unknown codes fall back to Telugu, the launch language, rather than throwing mid-session. */
export function languageProfile(code: unknown): LanguageProfile {
  return isLanguageCode(code) ? LANGUAGES[code] : LANGUAGES.te;
}

/**
 * Fills `{persona}` in English copy with this language's word for grandmother.
 * Content and UI strings use the token so the grandmother's name is never hardcoded.
 */
export function withPersona(text: string, code: unknown): string {
  return text.replaceAll("{persona}", languageProfile(code).personaName);
}
