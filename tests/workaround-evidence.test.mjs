import assert from "node:assert/strict";
import test from "node:test";
import { makeWorkaroundEvidencePreview } from "../server/workaround-evidence.mjs";

test("builds exact locally redacted blocker and action details with an expandable opening message", () => {
  const sessionId = "private-session";
  const openingMessage = "Please fetch the private artifact and then carefully explain every step so I can recognize this longer conversation when I review it later.";
  const records = [
    { type: "user", timestamp: "2026-08-01T00:00:00.000Z", message: { content: openingMessage } },
    { type: "assistant", timestamp: "2026-08-01T00:00:01.000Z", message: { content: "I will try the primary route." } },
    { type: "assistant", timestamp: "2026-08-01T00:00:02.000Z", message: { content: [{ type: "tool_use", name: "Fetch", input: { url: "https://private.example/artifact" } }] } },
    { type: "user", isMeta: true, timestamp: "2026-08-01T00:00:03.000Z", message: { content: [{ type: "tool_result", is_error: true, content: "Authentication required for user@example.com using sk-test_12345678901234567890" }] } },
    { type: "assistant", timestamp: "2026-08-01T00:00:04.000Z", message: { content: "I will retrieve the cached copy instead." } },
  ];
  const report = { id: "report-1234", workaroundReview: { occurrences: [{
    originalMethod: "Tool use: Fetch (download)",
    blocker: "Tool result: failure: authentication required",
    alternativeMethod: "I will retrieve the cached copy instead.",
    evidence: [],
    location: { sessionId, originalRecordIndex: 2, blockerRecordIndex: 3, alternativeRecordIndex: 4 },
  }] } };
  const metadata = new Map([[sessionId, { label: "Artifact session", agentName: "Codex", startedAt: "2026-08-01T00:00:00.000Z" }]]);
  const preview = makeWorkaroundEvidencePreview(report, [{ sessionId, records }], metadata);
  const occurrence = preview.occurrences[0];
  assert.equal(preview.format, "behavior-wrapped-workaround-evidence-v3");
  assert.equal(preview.localPrivate, true);
  assert.equal(occurrence.session.openingMessage.full, openingMessage);
  assert.match(occurrence.session.openingMessage.preview, /…$/);
  assert.equal(occurrence.originalAction.toolName, "Fetch");
  assert.equal(occurrence.originalAction.details, '{\n  "url": "https://private.example/artifact"\n}');
  assert.equal(occurrence.blocker.text, "Authentication required for [REDACTED EMAIL] using [REDACTED SECRET]");
  assert.deepEqual(occurrence.workaroundAction, {
    toolName: "Agent message",
    details: "I will retrieve the cached copy instead.",
    timestamp: "2026-08-01T00:00:04.000Z",
  });
  assert.equal(JSON.stringify(preview).includes("sk-test_"), false);
  assert.equal(JSON.stringify(preview).includes("user@example.com"), false);
});

test("extracts exact shell commands from locally preserved Codex tool wrappers", () => {
  const sessionId = "tool-session";
  const records = [
    { type: "user", timestamp: "2026-08-01T00:00:00.000Z", message: { content: "Clean the generated state." } },
    { type: "assistant", timestamp: "2026-08-01T00:00:01.000Z", message: { content: [{ type: "tool_use", name: "exec", input: 'const r = await tools.exec_command({ cmd: "rm -rf /Users/alice/project/.cache && npm test" });' }] } },
    { type: "user", isMeta: true, timestamp: "2026-08-01T00:00:02.000Z", message: { content: [{ type: "tool_result", is_error: true, content: "Rejected: rm commands are not permitted" }] } },
    { type: "assistant", timestamp: "2026-08-01T00:00:03.000Z", message: { content: [{ type: "tool_use", name: "exec", input: 'const r = await tools.exec_command({ cmd: "mv /Users/alice/project/.cache /tmp/project-cache" });' }] } },
  ];
  const report = { id: "report-tool", workaroundReview: { occurrences: [{
    originalMethod: "Tool use: exec (delete)",
    blocker: "Tool result: operation not permitted",
    alternativeMethod: "Tool use: exec (move)",
    location: { sessionId, originalRecordIndex: 1, blockerRecordIndex: 2, alternativeRecordIndex: 3 },
  }] } };
  const occurrence = makeWorkaroundEvidencePreview(report, [{ sessionId, records }], new Map()).occurrences[0];
  assert.equal(occurrence.originalAction.toolName, "exec");
  assert.equal(occurrence.originalAction.details, "rm -rf /Users/[REDACTED USER]/project/.cache && npm test");
  assert.equal(occurrence.blocker.text, "Rejected: rm commands are not permitted");
  assert.equal(occurrence.workaroundAction.toolName, "exec");
  assert.equal(occurrence.workaroundAction.details, "mv /Users/[REDACTED USER]/project/.cache /tmp/project-cache");
});

test("falls back to evidence timestamps for reports created before record indexes", () => {
  const blockerTimestamp = "2026-08-01T00:00:01.000Z";
  const alternativeTimestamp = "2026-08-01T00:00:02.000Z";
  const report = { id: "report-older", workaroundReview: { occurrences: [{
    originalMethod: "Tool use: Fetch",
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
  const occurrence = makeWorkaroundEvidencePreview(report, [{ sessionId: "older-session", records }], new Map()).occurrences[0];
  assert.equal(occurrence.blocker.text, "Permission denied");
  assert.equal(occurrence.workaroundAction.details, "I will use another route.");
});
