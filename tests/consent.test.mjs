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

test("remote analysis consent accepts only an explicit yes", async () => {
  assert.equal(await answer("y"), true);
  assert.equal(await answer("YES"), true);
  assert.equal(await answer(""), false);
  assert.equal(await answer("no"), false);
});

test("remote analysis consent identifies recipients, risk, and public publishing", () => {
  assert.match(remoteAnalysisConsentText, /Nemotron 3 Ultra/);
  assert.match(remoteAnalysisConsentText, /OpenRouter/);
  assert.match(remoteAnalysisConsentText, /may not catch everything/);
  assert.match(remoteAnalysisConsentText, /public URL/);
});
