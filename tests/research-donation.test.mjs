import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { sanitizeEncryptedDonationEnvelope } from "../server/encrypted-donation-schema.mjs";
import { decryptResearchDonation, encryptResearchDonation } from "../server/research-donation-crypto.mjs";
import { sanitizeResearchDonation } from "../server/research-donation-schema.mjs";
import { submitResearchDonation } from "../server/research-donation.mjs";
import { handleRequest } from "../worker/phrase-judge-worker.mjs";

function fixture(overrides = {}) {
  return {
    reportId: "researchReport1",
    redactionMode: "standard",
    createdAt: "2026-08-06T12:00:00.000Z",
    redactionSummary: { automatedDetections: 4 },
    sessions: [{ sessionId: "must-be-dropped", label: "Private project", messages: [{ role: "user", text: "Reviewed text" }, { role: "assistant", text: "Reviewed answer", timestamp: "2026-08-01T00:00:00.000Z" }] }],
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
  assert.equal(donation.consent.statement, "I consent for this reviewed data to be transmitted to the Susan Calvin Project and used for research under the data policy.");
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

test("local submission sends only protocol-2 ciphertext", async () => {
  let transmitted;
  const result = await submitResearchDonation(fixture(), {
    clientId: "a".repeat(32),
    endpoint: "https://example.test/v1/research-donations",
    fetchImpl: async (_url, init) => {
      transmitted = init;
      return new Response(JSON.stringify({ accepted: true, donation_id: "encrypted-id" }), { status: 201 });
    },
  });
  assert.equal(result.donation_id, "encrypted-id");
  assert.equal(transmitted.headers["x-behavior-wrapped-protocol"], "2");
  assert.equal(transmitted.body.includes("Reviewed text"), false);
  assert.ok(sanitizeEncryptedDonationEnvelope(JSON.parse(transmitted.body).encryptedDonation));
});

test("worker stores ciphertext in R2 and consent metadata in a separate D1 database", async () => {
  let storedObject = null;
  let storedMetadata = null;
  const bucket = {
    async put(key, value, options) { storedObject = { key, value, options }; },
    async delete() { throw new Error("The successful path must not delete the object."); },
  };
  const database = {
    prepare() {
      return { bind(...values) { storedMetadata = values; return { async run() { return { success: true }; } }; } };
    },
  };
  const request = new Request("https://example.test/v1/research-donations", {
    method: "POST",
    headers: { "content-type": "application/json", "x-behavior-wrapped-protocol": "2", "x-behavior-wrapped-client": "b".repeat(32) },
    body: JSON.stringify({ encryptedDonation: encryptedFixture() }),
  });
  const response = await handleRequest(request, { RESEARCH_DB: database, RESEARCH_DONATIONS: bucket });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.encrypted, true);
  assert.equal("retention_days" in body, false);
  assert.match(body.deletion_token, /^[A-Za-z0-9_-]{43}$/);
  assert.match(storedObject.key, /^donations\/2026-08\//);
  assert.equal(storedObject.value.includes("Reviewed text"), false);
  assert.equal(storedMetadata[3], "researchReport1");
  assert.equal(storedMetadata[9], "standard");
  assert.equal(storedMetadata.includes(body.deletion_token), false);
  assert.equal(storedMetadata.some((value) => String(value).includes("Reviewed text")), false);
});

test("worker removes an R2 object if its metadata write fails", async () => {
  let deleted = null;
  const bucket = { async put() {}, async delete(key) { deleted = key; } };
  const database = { prepare() { return { bind() { return { async run() { throw new Error("database unavailable"); } }; } }; } };
  const request = new Request("https://example.test/v1/research-donations", {
    method: "POST",
    headers: { "content-type": "application/json", "x-behavior-wrapped-protocol": "2", "x-behavior-wrapped-client": "c".repeat(32) },
    body: JSON.stringify({ encryptedDonation: encryptedFixture() }),
  });
  const response = await handleRequest(request, { RESEARCH_DB: database, RESEARCH_DONATIONS: bucket });
  assert.equal(response.status, 503);
  assert.match(deleted, /^donations\//);
});

test("worker rejects plaintext and protocol-1 donations", async () => {
  const request = new Request("https://example.test/v1/research-donations", {
    method: "POST",
    headers: { "content-type": "application/json", "x-behavior-wrapped-protocol": "1", "x-behavior-wrapped-client": "d".repeat(32) },
    body: JSON.stringify({ donation: fixture() }),
  });
  const response = await handleRequest(request, {});
  assert.equal(response.status, 426);
});

test("a deletion token removes both encrypted content and metadata", async () => {
  const deleted = [];
  const database = {
    prepare(sql) {
      return { bind(...values) { return {
        async first() { assert.match(values[1], /^[a-f0-9]{64}$/); return { object_key: "donations/2026-08/example.json" }; },
        async run() { deleted.push({ sql, values }); return { success: true }; },
      }; } };
    },
  };
  const bucket = { async delete(key) { deleted.push({ key }); } };
  const response = await handleRequest(new Request("https://example.test/v1/research-donations/11111111-1111-4111-8111-111111111111", {
    method: "DELETE",
    headers: { "x-behavior-wrapped-protocol": "2", "x-behavior-wrapped-deletion-token": "e".repeat(43) },
  }), { RESEARCH_DB: database, RESEARCH_DONATIONS: bucket });
  assert.equal(response.status, 200);
  assert.equal(deleted[0].key, "donations/2026-08/example.json");
  assert.match(deleted[1].sql, /^DELETE FROM research_donations/);
});
