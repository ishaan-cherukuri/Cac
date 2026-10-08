/**
 * URLs for pre-generated scripted audio.
 *
 * Paths are derived, not stored: `pregenerate-audio.mjs` writes to a deterministic
 * layout, so the client can build a URL without a database round trip. One fewer query
 * before the grandmother opens her mouth.
 *
 * The bucket is public because this is static app content containing no user data, which
 * makes it CDN-cacheable — the whole point of generating ahead of time.
 */

const BUCKET = "topic-audio";

function publicUrl(path: string): string {
  return `${process.env.EXPO_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
}

/** What the grandmother asks. Exists for every turn at every difficulty. */
export function promptAudioUrl(topicId: string, turnNumber: number): string {
  return publicUrl(`${topicId}/${turnNumber}-prompt.mp3`);
}

/** The model answer. Only spoken at easy difficulty, where the user repeats it back. */
export function answerAudioUrl(topicId: string, turnNumber: number): string {
  return publicUrl(`${topicId}/${turnNumber}-answer.mp3`);
}

/** One key-vocab word in her voice, for "Words you've said". */
export function vocabAudioUrl(topicId: string, turnNumber: number, vocabIndex: number): string {
  return publicUrl(`${topicId}/${turnNumber}-vocab-${vocabIndex}.mp3`);
}
