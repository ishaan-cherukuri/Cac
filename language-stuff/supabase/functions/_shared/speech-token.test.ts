import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { signSpeechToken, verifySpeechToken } from "./speech-token.ts";

const SECRET = "test-secret";
const NOW = Date.UTC(2026, 9, 8, 12, 0, 0);

describe("speech tokens", () => {
  test("round-trip the line and its language", async () => {
    const token = await signSpeechToken(SECRET, { text: "होली है!", language: "hi" }, NOW);
    assert.deepEqual(await verifySpeechToken(SECRET, token, NOW + 1000), {
      text: "होली है!",
      language: "hi",
    });
  });

  test("expire after five minutes", async () => {
    const token = await signSpeechToken(SECRET, { text: "సరే", language: "te" }, NOW);
    assert.notEqual(await verifySpeechToken(SECRET, token, NOW + 4 * 60 * 1000), null);
    assert.equal(await verifySpeechToken(SECRET, token, NOW + 6 * 60 * 1000), null);
  });

  test("reject a token signed with a different secret", async () => {
    const token = await signSpeechToken("someone-else", { text: "సరే", language: "te" }, NOW);
    assert.equal(await verifySpeechToken(SECRET, token, NOW), null);
  });

  test("reject a token whose text was swapped after signing", async () => {
    // The whole point of signing: /speak must not synthesize text we did not approve.
    const token = await signSpeechToken(SECRET, { text: "సరే", language: "te" }, NOW);
    const [, signature] = token.split(".");
    const forged = btoa(JSON.stringify({ t: "anything at all", l: "te", e: NOW + 60_000 }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    assert.equal(await verifySpeechToken(SECRET, `${forged}.${signature}`, NOW), null);
  });

  test("reject garbage", async () => {
    assert.equal(await verifySpeechToken(SECRET, "not-a-token", NOW), null);
    assert.equal(await verifySpeechToken(SECRET, "", NOW), null);
  });
});
