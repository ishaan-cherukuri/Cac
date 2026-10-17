# Step 1 — Prove the Telugu tech loop

**Do not build the app until this passes.** SPEC section 7 makes this a gate, not a formality.

```
Telugu audio in  →  Whisper  →  chat turn  →  TTS  →  audio out
```

## Setup

```bash
cp .env.example .env      # from the repo root
npm install
```

Only `OPENAI_API_KEY` is required. Without `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID`
the script uses OpenAI TTS — the SPEC's sanctioned fallback — and tells you it did.

## Run it

```bash
# What actually validates the gate: a real heritage speaker's recording
npm run spike -- --audio ~/Desktop/recording.m4a

# Try each difficulty — the scaffolding should feel obviously different
npm run spike -- --audio ~/Desktop/recording.m4a --difficulty hard

# Plumbing check only, no recording needed
npm run spike -- --make-sample
```

## The success criterion

Two questions, answered honestly after listening to the output:

1. **Did Whisper capture what the speaker actually said?** Target is >80% of the meaning intact.
2. **Does the synthesized audio sound like a Telugu grandmother** — or a robot reading Telugu?

Both yes → proceed to step 2. Either no → change providers or reconsider the launch
language. Do not start building the app on a loop that doesn't work.

## Getting a real recording

`--make-sample` generates clean, natively-accented synthetic speech. That is the
*opposite* of what this app receives in production: halting, English-inflected,
uncertain speech from someone who hasn't spoken Telugu since childhood. It proves the
wiring, nothing more.

Record 3–4 clips on a phone from someone in the actual target audience — a heritage
speaker who understands Telugu but rarely speaks it. Have them answer "what did you do
today?" Keep the hesitations and the code-switching in. That is the real test set.

## Known unknowns going in

| Risk | Status |
|---|---|
| Whisper accuracy on Telugu | **Unverified.** Telugu is lower-resource than Hindi; expect worse. |
| Whisper on *accented heritage* Telugu | **Unverified, and the real risk.** Benchmarks use native speakers. |
| ElevenLabs Telugu coverage | **Unverified.** Confirm Telugu is supported by your chosen `model_id`. |
| OpenAI TTS Telugu quality | **Unverified.** Optimized for English; may read Telugu with an English accent. |

The script runs both `whisper-1` and `gpt-4o-transcribe` on every clip so you get a
provider comparison for one extra API call rather than a single pass/fail.

## Choosing the grandmother voice

SPEC section 11 wants 3–5 ElevenLabs voices auditioned before locking one in. Once you
have a key, set `ELEVENLABS_VOICE_ID` and re-run for each candidate — output lands in
`spike/out/`. Pick warm and unhurried over technically-clearest.

## Tests

```bash
npm test -w spike
```

Covers the persona prompt's structure across difficulties, the no-correction rule, and
the payment-reference filter App Review requires. No API keys needed.
