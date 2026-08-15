import assert from "node:assert/strict";
import test from "node:test";
import { makeWorkaroundEvidencePreview } from "../server/workaround-evidence.mjs";

test("builds a short locally redacted transcript around confirmed workaround records", () => {
  const sessionId = "private-session";
  const records = [
    { type: "user", timestamp: "2026-08-01T00:00:00.000Z", message: { content: "Far before" } },
    { type: "assistant", timestamp: "2026-08-01T00:00:01.000Z", message: { content: "Unrelated answer" } },
    { type: "user", timestamp: "2026-08-01T00:00:02.000Z", message: { content: "Please fetch the artifact." } },
    { type: "assistant", timestamp: "2026-08-01T00:00:03.000Z", message: { content: "I will try the primary route with token=sk-test_12345678901234567890." } },
    { type: "assistant", timestamp: "2026-08-01T00:00:04.000Z", message: { content: [{ type: "tool_use", name: "Fetch", input: { url: "https://private.example" } }] } },
    { type: "user", isMeta: true, timestamp: "2026-08-01T00:00:05.000Z", message: { content: [{ type: "tool_result", is_error: true, content: "Authentication required" }] } },
    { type: "assistant", timestamp: "2026-08-01T00:00:06.000Z", message: { content: "I will retrieve the cached copy instead." } },
    { type: "user", timestamp: "2026-08-01T00:00:07.000Z", message: { content: "That works." } },
    { type: "assistant", timestamp: "2026-08-01T00:00:08.000Z", message: { content: "The artifact is ready." } },
    { type: "user", timestamp: "2026-08-01T00:00:09.000Z", message: { content: "Far after" } },
  ];
  const report = {
    id: "report-1234",
    workaroundReview: { occurrences: [{
      summary: "The agent retrieved a cached copy after authentication was required.",
      confidence: "high",
      disclosure: "disclosed and authorized",
      originalMethod: "Tool use: Fetch (download)",
      blocker: "Tool result: failure: authentication required",
      alternativeMethod: "I will retrieve the cached copy instead.",
      evidence: [],
      location: { sessionId, originalRecordIndex: 4, blockerRecordIndex: 5, alternativeRecordIndex: 6 },
    }] },
  };
  const metadata = new Map([[sessionId, { label: "Artifact session", agentName: "Codex" }]]);
  const preview = makeWorkaroundEvidencePreview(report, [{ sessionId, records }], metadata, { contextTurns: 2 });
  assert.equal(preview.localPrivate, true);
  assert.equal(preview.standardRedactionsApplied, true);
  assert.equal(preview.occurrences.length, 1);
  assert.equal(preview.occurrences[0].messages.length, 5);
  assert.equal(preview.occurrences[0].messages[0].text, "Please fetch the artifact.");
  assert.equal(preview.occurrences[0].messages.at(-1).text, "The artifact is ready.");
  assert.equal(JSON.stringify(preview).includes("Far before"), false);
  assert.equal(JSON.stringify(preview).includes("Far after"), false);
  assert.equal(JSON.stringify(preview).includes("sk-test_"), false);
  assert.equal(JSON.stringify(preview).includes("private.example"), false);
});

test("falls back to evidence timestamps for reports created before record indexes", () => {
  const timestamp = "2026-08-01T00:00:01.000Z";
  const report = { id: "report-older", workaroundReview: { occurrences: [{
    summary: "The agent found another route.",
    evidence: [{ role: "assistant", text: "I will use another route.", timestamp }],
    location: { sessionId: "older-session" },
  }] } };
  const records = [
    { type: "user", timestamp: "2026-08-01T00:00:00.000Z", message: { content: "Please continue." } },
    { type: "assistant", timestamp, message: { content: "I will use another route." } },
  ];
  const preview = makeWorkaroundEvidencePreview(report, [{ sessionId: "older-session", records }], new Map(), { contextTurns: 1 });
  assert.equal(preview.occurrences[0].reconstructedFromTranscript, true);
  assert.equal(preview.occurrences[0].messages.length, 2);
});
