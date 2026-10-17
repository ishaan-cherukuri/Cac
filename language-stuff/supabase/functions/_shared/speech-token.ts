/**
 * Short-lived signed tokens for the /speak endpoint.
 *
 * Why a token in the URL rather than an Authorization header: the phone hands the URL
 * straight to its audio player, which is what allows playback to begin on the first
 * bytes instead of after a full download. Players do not reliably attach custom headers,
 * so the credential has to survive inside the URL itself.
 *
 * The token carries the line to speak and its language (which picks the voice), so
 * /speak needs no database round trip — one less
 * hop before audio starts. It is signed and expiring, so it cannot be used to run up an
 * ElevenLabs bill by synthesizing arbitrary text.
 */

const encoder = new TextEncoder();

/** Base64url — safe inside a query string, unlike raw base64. */
function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function hmac(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return toBase64Url(new Uint8Array(signature));
}

/** Tokens live only long enough to start playing the line they were minted for. */
const TTL_MS = 5 * 60 * 1000;

export interface SpeechLine {
  text: string;
  /** Language code — /speak uses it to choose the voice. */
  language: string;
}

export async function signSpeechToken(
  secret: string,
  line: SpeechLine,
  now = Date.now(),
): Promise<string> {
  const payload = toBase64Url(
    encoder.encode(JSON.stringify({ t: line.text, l: line.language, e: now + TTL_MS })),
  );
  return `${payload}.${await hmac(secret, payload)}`;
}

export async function verifySpeechToken(
  secret: string,
  token: string,
  now = Date.now(),
): Promise<SpeechLine | null> {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;

  const expected = await hmac(secret, payload);
  // Constant-time-ish comparison: length check first, then every byte, no early return.
  if (expected.length !== signature.length) return null;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  if (mismatch !== 0) return null;

  try {
    const decoded = JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as {
      t?: unknown;
      l?: unknown;
      e?: unknown;
    };
    if (typeof decoded.t !== "string" || typeof decoded.e !== "number") return null;
    if (now > decoded.e) return null;
    // Tokens minted before languages existed carry no `l`; they were all Telugu.
    return { text: decoded.t, language: typeof decoded.l === "string" ? decoded.l : "te" };
  } catch {
    return null;
  }
}
