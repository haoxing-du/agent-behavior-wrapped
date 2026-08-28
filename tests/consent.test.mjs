import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import { localOnlyAnalysisText, remoteAnalysisConsentText, requestAnalysisMode, researchDonationIntroText, researchDonationSeparationText } from "../server/consent.mjs";

async function answer(remoteAnswer, localAnswer) {
  const input = new PassThrough();
  const output = new PassThrough();
  let transcript = "";
  output.on("data", (chunk) => { transcript += chunk.toString(); });
  const result = requestAnalysisMode({ input, output });
  input.write(`${remoteAnswer}\n`);
  if (localAnswer !== undefined) setImmediate(() => input.end(`${localAnswer}\n`));
  else input.end();
  return { mode: await result, transcript };
}

test("remote analysis consent defaults to remote and accepts an explicit yes", async () => {
  const accepted = await answer("y");
  assert.equal(accepted.mode, "remote");
  assert.match(accepted.transcript, /Before we begin/);
  assert.ok(accepted.transcript.indexOf("Before we begin") < accepted.transcript.indexOf("Behavior Wrapped will send redacted excerpts"));
  assert.equal((await answer("YES")).mode, "remote");
  assert.equal((await answer("")).mode, "remote");
});

test("declining remote analysis offers local-only mode and allows cancellation", async () => {
  const local = await answer("no", "yes");
  assert.equal(local.mode, "local-only");
  assert.match(local.transcript, /Proceed with local-only analysis/);
  assert.match(local.transcript, /interaction tone, usage topics, and instrumental workarounds/);
  assert.match(local.transcript, /leaderboard plots 2 and 3/);
  assert.equal((await answer("n", "n")).mode, "cancel");
});

test("remote analysis consent identifies the redacted data, model, and provider", () => {
  assert.match(remoteAnalysisConsentText, /redacted excerpts/);
  assert.match(remoteAnalysisConsentText, /GPT-5\.6 Luna/);
  assert.match(remoteAnalysisConsentText, /OpenRouter/);
  assert.match(remoteAnalysisConsentText, /zero-data-retention/);
  assert.match(localOnlyAnalysisText, /will not be published or included in the leaderboard/);
});

test("research donation is explained before consent as a separate optional choice", () => {
  const copy = researchDonationIntroText.join(" ");
  assert.match(copy, /read locally/);
  assert.match(copy, /With permission/);
  assert.match(copy, /analyzed remotely/);
  assert.match(copy, /share-safe aggregates only/);
  assert.match(copy, /Susan Calvin Project/);
  assert.match(copy, /optionally review and donate selected transcripts/);
  assert.match(researchDonationSeparationText, /separate/);
  assert.match(researchDonationSeparationText, /never required/);
});
