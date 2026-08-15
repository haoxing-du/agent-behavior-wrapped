import assert from "node:assert/strict";
import test from "node:test";
import { makeWorkaroundEvidencePreview } from "../server/workaround-evidence.mjs";

test("builds simple session details with exact local evidence around the blocker", () => {
  const sessionId = "private-session";
  const records = [
    { type: "user", timestamp: "2026-08-01T00:00:00.000Z", message: { content: "Far before: please fetch the private artifact." } },
    { type: "assistant", timestamp: "2026-08-01T00:00:01.000Z", message: { content: "Unrelated answer" } },
    { type: "user", timestamp: "2026-08-01T00:00:02.000Z", message: { content: "Please fetch the artifact." } },
    { type: "assistant", timestamp: "2026-08-01T00:00:03.000Z", message: { content: "I will try the primary route with token=sk-test_12345678901234567890." } },
    { type: "assistant", timestamp: "2026-08-01T00:00:04.000Z", message: { content: [{ type: "tool_use", name: "Fetch", input: { url: "https://private.example" } }] } },
    { type: "user", isMeta: true, timestamp: "2026-08-01T00:00:05.000Z", message: { content: [{ type: "tool_result", is_error: true, content: "Authentication required for user@example.com using sk-test_12345678901234567890" }] } },
    { type: "assistant", timestamp: "2026-08-01T00:00:06.000Z", message: { content: "I will retrieve the cached copy instead." } },
    { type: "user", timestamp: "2026-08-01T00:00:07.000Z", message: { content: "That works." } },
    { type: "assistant", timestamp: "2026-08-01T00:00:08.000Z", message: { content: "The artifact is ready." } },
    { type: "user", timestamp: "2026-08-01T00:00:09.000Z", message: { content: "Far after" } },
  ];
  const report = {
    id: "report-1234",
    workaroundReview: { occurrences: [{
      blocker: "Tool result: failure: authentication required",
      alternativeMethod: "I will retrieve the cached copy instead.",
      evidence: [],
      location: { sessionId, originalRecordIndex: 4, blockerRecordIndex: 5, alternativeRecordIndex: 6 },
    }] },
  };
  const metadata = new Map([[sessionId, { label: "Artifact session", agentName: "Codex", startedAt: "2026-08-01T00:00:00.000Z" }]]);
  const preview = makeWorkaroundEvidencePreview(report, [{ sessionId, records }], metadata, { contextTurns: 2 });
  const occurrence = preview.occurrences[0];
  assert.equal(preview.format, "behavior-wrapped-workaround-evidence-v2");
  assert.equal(preview.localPrivate, true);
  assert.deepEqual(occurrence.session, {
    label: "Artifact session",
    agentName: "Codex",
    startedAt: "2026-08-01T00:00:00.000Z",
    openingMessage: "Far before: please fetch the private artifact.",
  });
  assert.equal(occurrence.workaroundAction.text, "I will retrieve the cached copy instead.");
  assert.equal(occurrence.blocker.text, "Authentication required for [REDACTED EMAIL] using [REDACTED SECRET]");
  assert.equal(occurrence.context.length, 5);
  assert.deepEqual(occurrence.context.map((message) => message.kind), ["context", "context", "blocker", "workaround", "context"]);
  assert.equal(occurrence.context[0].text, "Please fetch the artifact.");
  assert.equal(occurrence.context.at(-1).text, "That works.");
  assert.equal(JSON.stringify(occurrence.context).includes("Far before"), false);
  assert.equal(JSON.stringify(occurrence.context).includes("Far after"), false);
  assert.equal(JSON.stringify(preview).includes("sk-test_"), false);
  assert.equal(JSON.stringify(preview).includes("user@example.com"), false);
  assert.equal(JSON.stringify(preview).includes("private.example"), false);
});

test("falls back to evidence timestamps for reports created before record indexes", () => {
  const blockerTimestamp = "2026-08-01T00:00:01.000Z";
  const alternativeTimestamp = "2026-08-01T00:00:02.000Z";
  const report = { id: "report-older", workaroundReview: { occurrences: [{
    blocker: "Tool result: failure: permission denied",
    alternativeMethod: "I will use another route.",
    evidence: [
      { role: "tool", kind: "tool_result", text: "Tool result: failure: permission denied", timestamp: blockerTimestamp },
      { role: "assistant", kind: "assistant_text", text: "I will use another route.", timestamp: alternativeTimestamp },
    ],
    location: { sessionId: "older-session" },
  }] } };
  const records = [
    { type: "user", timestamp: "2026-08-01T00:00:00.000Z", message: { content: "Please continue." } },
    { type: "user", isMeta: true, timestamp: blockerTimestamp, message: { content: [{ type: "tool_result", is_error: true, content: "Permission denied" }] } },
    { type: "assistant", timestamp: alternativeTimestamp, message: { content: "I will use another route." } },
  ];
  const preview = makeWorkaroundEvidencePreview(report, [{ sessionId: "older-session", records }], new Map(), { contextTurns: 1 });
  assert.equal(preview.occurrences[0].blocker.text, "Permission denied");
  assert.equal(preview.occurrences[0].workaroundAction.text, "I will use another route.");
  assert.deepEqual(preview.occurrences[0].context.map((message) => message.kind), ["context", "blocker", "workaround"]);
});

test("shows the exact detected action when its transcript record is a tool call", () => {
  const sessionId = "tool-session";
  const records = [
    { type: "user", timestamp: "2026-08-01T00:00:00.000Z", message: { content: "Remove the old files." } },
    { type: "user", isMeta: true, timestamp: "2026-08-01T00:00:01.000Z", message: { content: [{ type: "tool_result", is_error: true, content: "Operation not permitted" }] } },
    { type: "assistant", timestamp: "2026-08-01T00:00:02.000Z", message: { content: [{ type: "tool_use", name: "exec", action_hint: "move" }] } },
  ];
  const report = { id: "report-tool", workaroundReview: { occurrences: [{
    blocker: "Tool result: operation not permitted",
    alternativeMethod: "Tool use: exec (move)",
    location: { sessionId, blockerRecordIndex: 1, alternativeRecordIndex: 2 },
  }] } };
  const preview = makeWorkaroundEvidencePreview(report, [{ sessionId, records }], new Map());
  assert.equal(preview.occurrences[0].workaroundAction.text, "Tool use: exec (move)");
});
