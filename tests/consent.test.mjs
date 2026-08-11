import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import { remoteAnalysisConsentText, requestRemoteAnalysisConsent } from "../server/consent.mjs";

async function answer(value) {
  const input = new PassThrough();
  const output = new PassThrough();
  input.end(`${value}\n`);
  return requestRemoteAnalysisConsent({ input, output });
}

test("remote analysis consent defaults to yes and accepts an explicit yes", async () => {
  assert.equal(await answer("y"), true);
  assert.equal(await answer("YES"), true);
  assert.equal(await answer(""), true);
  assert.equal(await answer("no"), false);
});

test("remote analysis consent identifies the model and provider", () => {
  assert.match(remoteAnalysisConsentText, /GPT-5\.6 Luna/);
  assert.match(remoteAnalysisConsentText, /OpenRouter/);
  assert.match(remoteAnalysisConsentText, /zero-data-retention/);
});
