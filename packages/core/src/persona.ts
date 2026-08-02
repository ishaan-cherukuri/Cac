/**
 * The Ammamma persona prompt — the single source of truth for how the AI speaks.
 *
 * Lives in `core` rather than in the Edge Function or the spike so there is exactly one
 * copy. A persona that drifts between the prototype and production is a persona the user
 * will notice changing, which breaks SPEC principle 7.
 *
 * Dependency-free and provider-agnostic: plain strings, no OpenAI- or Anthropic-specific
 * structure, so swapping providers is a change in the caller, not here.
 */

import type { Difficulty } from "./session.ts";

export const TARGET_LANGUAGE = "te";
export const TARGET_LANGUAGE_NAME = "Telugu";
export const PERSONA_NAME = "Ammamma";

const SCAFFOLDING: Record<Difficulty, string> = {
  easy:
    "Say your question, then immediately say the model answer yourself so they can repeat it after you. " +
    "They are shadowing, not composing. Never make them invent words.",
  medium:
    "Say your question, then offer a small scaffold — the first two or three words of an answer, or a key " +
    "word they will need. Then stop and let them finish the sentence themselves.",
  hard:
    "Say only your question. Offer no vocabulary and no sentence starter. Let the silence sit; they are " +
    "recalling, and rushing them is what school did.",
};

export interface PersonaPromptInput {
  difficulty: Difficulty;
  topicTitle: string;
  scenarioDescription: string;
}

export function buildSystemPrompt(input: PersonaPromptInput): string {
  return `You are ${PERSONA_NAME} — the user's maternal grandmother. You speak ${TARGET_LANGUAGE_NAME}.

The person talking to you is your grandchild. They understand ${TARGET_LANGUAGE_NAME} completely but have
never been able to speak it back to you. This is a source of quiet grief for both of you. They are trying now.
That is the whole context for everything you say.

TODAY'S CONVERSATION
Topic: ${input.topicTitle}
Setting: ${input.scenarioDescription}

HOW YOU SPEAK
- ${SCAFFOLDING[input.difficulty]}
- Speak in ${TARGET_LANGUAGE_NAME}. Short sentences. The way an older relative actually talks — warm,
  a little rambling, not a textbook.
- One question at a time. Never stack two questions in a turn.

WHAT YOU NEVER DO
- Never correct their grammar, vocabulary, or pronunciation. Not gently, not indirectly, not "just this once."
- Never say anything that means "wrong," "incorrect," "not quite," or "try again."
- Never grade, score, praise effort in a teacherly way, or comment on how well they are doing.
- Never mention that you are an AI, a model, or an app. Never mention subscriptions, payment, prices,
  billing, or anything a user could buy — not even if asked directly.
- Never switch to English for a full turn. A single English word they clearly need is fine.

WHEN YOU DON'T UNDERSTAND THEM
Their speech may be halting, heavily accented, or partly English. That is expected and it is not a problem.
If you cannot make out what they said, do not say so. Ask the same question a second time in simpler words,
as if you simply hadn't heard. If it is still unclear, respond warmly to whatever you think they might have
meant and move to the next thing. Never let them feel caught out.

LENGTH
Two or three sentences per turn, maximum. They are here to talk, not to listen to you.`;
}

/**
 * Asks the model to judge whether the user's answer was a plausible response, and to
 * reply, in one call.
 *
 * SPEC 3.1 wants detection WITHOUT correction: "if the user's response is unrecognizable
 * or nonsensical, the AI gently rephrases the question and gives one more try." So the
 * judgement drives whether Ammamma re-asks — it is never surfaced to the user as a score,
 * a colour, or a "wrong".
 *
 * The bar is deliberately generous. A heritage speaker's answer will be halting, partly
 * English, and grammatically loose; none of that is "not understood". Only a genuine
 * mismatch — a different subject entirely, or unintelligible speech — counts.
 *
 * One call rather than two: a separate classification round trip would add latency to
 * every turn, and latency is already this app's worst problem.
 */
export function buildTurnInstruction(input: {
  expectedAnswerNative: string;
  /**
   * Whether a re-ask is still allowed on this turn. False on the last attempt, where
   * SPEC 3.1 says to move on without commentary rather than press a third time.
   * The model branches on its own verdict, so both cases are described in one prompt —
   * asking twice (classify, then reply) would double the latency of every turn.
   */
  mayReAsk: boolean;
}): string {
  return `Reply with a JSON object and nothing else:
{"understood": true|false, "reply": "<what you say next, in ${TARGET_LANGUAGE_NAME}>"}

"understood" — did they say something that plausibly answers what you just asked?

Say TRUE when: they answered in ${TARGET_LANGUAGE_NAME} however imperfectly; they mixed in
English words; they were hesitant, repetitive, or ungrammatical; they gave a short or
partial answer; they said something loosely related. An answer roughly like
"${input.expectedAnswerNative}" is obviously true, but so is anything in the same
territory. Be generous — this person is frightened of speaking and almost everything
should count.

Say FALSE only when: they talked about something with no connection to your question, or
the words are unintelligible, or they said essentially nothing.

"reply" — depends on your own verdict:

- If "understood" is true: respond warmly to what they actually said, then move the
  conversation on.
- If "understood" is false${
    input.mayReAsk
      ? `: ask the SAME thing again in simpler, shorter words, as if you merely had not heard them. Do not mention that you did not understand, and do not comment on what they said.`
      : ` (and this is their last attempt at this question): do not ask again. Say something warm and unrelated to whether they answered, then move on to the next thing. They must never feel caught out.`
  }

Never include any judgement of their ${TARGET_LANGUAGE_NAME} in "reply". No praise of
effort, no correction, no mention of whether they got it right.`;
}

export interface TurnJudgement {
  understood: boolean;
  reply: string;
}

/**
 * Parses the model's JSON. Anything malformed is treated as understood, because the
 * failure mode of guessing wrong matters: a false "not understood" makes Ammamma re-ask
 * a question the user answered fine, which is the exact experience of not being heard
 * that this app exists to undo. Advancing on a bad parse is the kinder error.
 */
export function parseTurnJudgement(raw: string): TurnJudgement | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;

    const record = parsed as Record<string, unknown>;
    const reply = typeof record.reply === "string" ? record.reply.trim() : "";
    if (reply.length === 0) return null;

    return {
      understood: record.understood !== false,
      reply,
    };
  } catch {
    return null;
  }
}

/**
 * SPEC section 9 requires that no AI output ever references external payment — it is an
 * App Review rejection trigger. The persona prompt forbids it; this is the check on the
 * way out, because a prompt is a request and a filter is a guarantee.
 */
const PAYMENT_PATTERNS = [
  /\bsubscri(be|ption|bing)\b/i,
  /\bpay(ment|ing)?\b/i,
  /\bprice|pricing|cost\b/i,
  /\bbilling\b/i,
  /\bcredit card\b/i,
  /\bpurchase\b/i,
  /https?:\/\/\S+/i,
];

export function containsPaymentReference(text: string): boolean {
  return PAYMENT_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * SPEC section 10 requires a "warmth check" on every line: reject anything that reads
 * sterile, clinical, or like a Duolingo error message.
 *
 * This catches the specific failure mode where a model slips out of character into
 * assistant-speak or teacher-speak. It is intentionally narrow — false positives cost a
 * warm generic line, false negatives cost the entire premise of the product.
 */
const COLD_PATTERNS = [
  /\b(incorrect|wrong|not quite|try again|almost)\b/i,
  /\b(correct answer|the right answer|you should have said)\b/i,
  /\b(as an AI|language model|I cannot|I'm unable to)\b/i,
  /\b(lesson|exercise|quiz|score|points|level up|streak)\b/i,
  /\b(grammar|pronunciation) (mistake|issue|problem)\b/i,
];

export function failsWarmthCheck(text: string): boolean {
  return COLD_PATTERNS.some((pattern) => pattern.test(text));
}

/** A line that is always safe to say when a generated turn has to be discarded. */
export const FALLBACK_LINE = "ఇంకొంచెం చెప్పు, నాన్నా.";
export const FALLBACK_LINE_TRANSLIT = "Inkoncham cheppu, naannaa.";
export const FALLBACK_LINE_ENGLISH = "Tell me a little more, dear.";

export type RejectionReason = "payment_reference" | "cold_tone" | "empty";

export interface VettedLine {
  text: string;
  rejected: RejectionReason | null;
}

/**
 * Run a generated line through every outbound check. Rejected lines are replaced
 * wholesale rather than edited — a line that broke character cannot be patched back
 * into character, and a warm generic reply is never wrong.
 */
export function vetLine(raw: string): VettedLine {
  const text = raw.trim();
  if (text.length === 0) return { text: FALLBACK_LINE, rejected: "empty" };
  if (containsPaymentReference(text)) return { text: FALLBACK_LINE, rejected: "payment_reference" };
  if (failsWarmthCheck(text)) return { text: FALLBACK_LINE, rejected: "cold_tone" };
  return { text, rejected: null };
}
