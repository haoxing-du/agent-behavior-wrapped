import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeResearchDonation } from "../server/research-donation-schema.mjs";
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

test("research donation schema requires consent and removes local identifiers", () => {
  assert.equal(sanitizeResearchDonation(fixture({ consent: { researchDonation: false } })), null);
  const donation = sanitizeResearchDonation(fixture());
  assert.ok(donation);
  assert.equal(donation.sessions[0].label, "Session 1");
  assert.equal("sessionId" in donation.sessions[0], false);
  assert.equal(donation.consent.statement, "I consent for this reviewed data to be transmitted and used for research.");
});

test("worker stores a research donation only after validated final consent", async () => {
  let stored = null;
  const database = {
    prepare() {
      return { bind(...values) { stored = values; return { async run() { return { success: true }; } }; } };
    },
  };
  const request = new Request("https://example.test/v1/research-donations", {
    method: "POST",
    headers: { "content-type": "application/json", "x-behavior-wrapped-protocol": "1", "x-behavior-wrapped-client": "a".repeat(32) },
    body: JSON.stringify({ donation: fixture() }),
  });
  const response = await handleRequest(request, { LEADERBOARD_DB: database });
  assert.equal(response.status, 201);
  assert.ok(stored);
  assert.equal(stored[2], "researchReport1");
  assert.equal(JSON.parse(stored[3]).consent.researchDonation, true);
});
