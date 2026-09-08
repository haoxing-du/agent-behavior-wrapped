import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { sanitizeEncryptedDonationEnvelope } from "../server/encrypted-donation-schema.mjs";
import { decryptResearchDonation, encryptResearchDonation } from "../server/research-donation-crypto.mjs";
import { sanitizeResearchDonation } from "../server/research-donation-schema.mjs";
import { handleRequest } from "../worker/phrase-judge-worker.mjs";

function fixture(overrides = {}) {
  return {
    reportId: "researchReport1",
    redactionMode: "standard",
    createdAt: "2026-08-06T12:00:00.000Z",
    redactionSummary: { automatedDetections: 4 },
    sessions: [{ sessionId: "must-be-dropped", label: "Private project", messages: [{ role: "user", sourceIndex: 2, text: "Reviewed text" }, { role: "assistant", sourceIndex: 4, text: "Reviewed answer", timestamp: "2026-08-01T00:00:00.000Z" }] }],
    consent: { researchDonation: true, consentedAt: "2026-08-06T12:01:00.000Z" },
    ...overrides,
  };
}

let testKeys;
function keys() {
  testKeys ||= crypto.generateKeyPairSync("rsa", {
    modulusLength: 3072,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return testKeys;
}

function encryptedFixture(overrides = {}) {
  return encryptResearchDonation(fixture(overrides), keys().publicKey);
}

test("research donation schema requires consent and removes local identifiers", () => {
  assert.equal(sanitizeResearchDonation(fixture({ consent: { researchDonation: false } })), null);
  const donation = sanitizeResearchDonation(fixture());
  assert.ok(donation);
  assert.equal(donation.sessions[0].label, "Session 1");
  assert.equal("sessionId" in donation.sessions[0], false);
  assert.equal("sourceIndex" in donation.sessions[0].messages[0], false);
  assert.equal(donation.purpose, "general_research");
  assert.equal(sanitizeResearchDonation(fixture({ purpose: "unexpected" })), null);
  assert.equal(donation.consent.statement, "I consent for this reviewed data to be transmitted to the Susan Calvin Project and used for research under the data policy.");
});

test("classifier feedback is a one-session research donation with purpose-specific consent", () => {
  const classifierFeedback = {
    originalLabel: "yelling",
    correctedLabel: "neither",
    candidateId: "interaction-3",
    judgedText: "This is worse than the previous version.",
    occurrences: 1,
    confidence: 1,
    judge: { model: "openai/gpt-5.6-luna", promptVersion: 1 },
    note: "This was ordinary technical feedback.",
  };
  const value = fixture({ purpose: "classifier_feedback", classifierFeedback, consent: { researchDonation: true, classifierFeedback: true, consentedAt: "2026-08-06T12:01:00.000Z" } });
  const donation = sanitizeResearchDonation(value);
  assert.equal(donation.purpose, "classifier_feedback");
  assert.deepEqual(donation.classifierFeedback, classifierFeedback);
  assert.match(donation.consent.statement, /evaluate and improve Behavior Wrapped/);
  assert.equal(sanitizeResearchDonation({ ...value, sessions: [...value.sessions, ...value.sessions] }), null);
  assert.equal(sanitizeResearchDonation({ ...value, consent: { researchDonation: true } }), null);
  const envelope = encryptResearchDonation(value, keys().publicKey);
  assert.equal(envelope.metadata.purpose, "classifier_feedback");
  assert.equal(envelope.metadata.sessions, 1);
  assert.equal(JSON.stringify(envelope).includes(classifierFeedback.judgedText), false);
  assert.deepEqual(decryptResearchDonation(envelope, keys().privateKey), donation);
});

test("unredacted donations require a separate explicit acknowledgement", () => {
  assert.equal(sanitizeResearchDonation(fixture({ redactionMode: "unredacted" })), null);
  const donation = sanitizeResearchDonation(fixture({
    redactionMode: "unredacted",
    consent: { researchDonation: true, unredactedData: true, consentedAt: "2026-08-06T12:01:00.000Z" },
  }));
  assert.ok(donation);
  assert.equal(donation.redactionMode, "unredacted");
  assert.equal(donation.redactionSummary.automatedDetections, 0);
  assert.equal(donation.consent.unredactedData, true);
});

test("reviewed transcript text is encrypted locally and authenticated", () => {
  const envelope = encryptedFixture();
  assert.ok(envelope);
  assert.equal(envelope.metadata.consentVersion, 2);
  assert.equal(JSON.stringify(envelope).includes("Reviewed text"), false);
  assert.equal(envelope.metadata.reportId, "researchReport1");
  assert.deepEqual(decryptResearchDonation(envelope, keys().privateKey), sanitizeResearchDonation(fixture()));
  const tampered = structuredClone(envelope);
  tampered.metadata.messages++;
  assert.throws(() => decryptResearchDonation(tampered, keys().privateKey), /authenticate data|unable to authenticate/i);
});

test("compresses reviewed donations that exceed the former transport limit", () => {
  const repeatedText = "Repeated research context with enough detail to preserve. ".repeat(330);
  const messages = Array.from({ length: 130 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", text: `${index}: ${repeatedText}` }));
  const value = fixture({ sessions: [{ label: "Large reviewed session", messages }] });
  const sanitized = sanitizeResearchDonation(value);
  assert.ok(Buffer.byteLength(JSON.stringify(sanitized)) > 1_800_000);
  const envelope = encryptResearchDonation(value, keys().publicKey);
  assert.equal(envelope.metadata.contentEncoding, "gzip");
  assert.ok(Buffer.byteLength(JSON.stringify({ encryptedDonation: envelope })) < 1_800_000);
  assert.deepEqual(decryptResearchDonation(envelope, keys().privateKey), sanitized);
});

test("continues to decrypt legacy uncompressed donation envelopes", () => {
  const envelope = encryptResearchDonation(fixture(), keys().publicKey, { compress: false });
  assert.equal("contentEncoding" in envelope.metadata, false);
  assert.deepEqual(decryptResearchDonation(envelope, keys().privateKey), sanitizeResearchDonation(fixture()));
});

test("explains how to recover when a reviewed donation is genuinely too large", () => {
  const maximumLengthText = "界".repeat(20_000);
  const messages = Array.from({ length: 340 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", text: maximumLengthText }));
  assert.throws(() => encryptResearchDonation(fixture({ sessions: [{ messages }] }), keys().publicKey), /larger than 20 MB.*Advanced mode/i);
});

test("old uploads return an upgrade instruction without storing anything", async () => {
  for (const protocol of ["1", "2"]) {
    const response = await handleRequest(new Request("https://example.test/v1/research-donations", {
      method: "POST", headers: { "x-behavior-wrapped-protocol": protocol }, body: "private old body",
    }), {});
    assert.equal(response.status, 410);
    assert.match((await response.json()).error, /Share with Susan Calvin/);
  }
});

test("legacy deletion forwards the original credential to Susan and preserves failures", async () => {
  const request = () => new Request("https://example.test/v1/research-donations/11111111-1111-4111-8111-111111111111", {
    method: "DELETE", headers: { "x-behavior-wrapped-protocol": "2", "x-behavior-wrapped-deletion-token": "e".repeat(43) },
  });
  for (const status of [200, 404, 503]) {
    const response = await handleRequest(request(), { SUSAN_DONATIONS: { async fetch(forwarded) {
      assert.equal(forwarded.headers.get("x-behavior-wrapped-deletion-token"), "e".repeat(43));
      assert.equal(forwarded.method, "DELETE");
      return Response.json({ deleted: status === 200 }, { status });
    } } });
    assert.equal(response.status, status);
  }
  assert.equal((await handleRequest(request(), {})).status, 503);
});
