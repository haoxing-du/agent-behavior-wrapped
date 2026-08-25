import assert from "node:assert/strict";
import test from "node:test";
import { makeInteractionEvidencePreview } from "../server/interaction-evidence.mjs";

test("rebuilds exact local yelling and thanking excerpts with adjacent context", () => {
  const sessionId = "private-tone-session";
  const records = [
    { type: "assistant", timestamp: "2026-08-01T00:00:00.000Z", message: { content: "I changed the deployment target." } },
    { type: "user", timestamp: "2026-08-01T00:00:01.000Z", message: { content: "No, that's not at all what I asked for, and my key is sk-test_12345678901234567890." } },
    { type: "assistant", timestamp: "2026-08-01T00:00:02.000Z", message: { content: "You're right. I'll restore it." } },
    { type: "user", timestamp: "2026-08-01T00:00:03.000Z", message: { content: "Perfect, thank you!" } },
  ];
  const report = {
    id: "report-tone",
    interactionReview: {
      frustrated: [{ candidateId: "interaction-1", location: { sessionId, recordIndex: 1, timestamp: records[1].timestamp } }],
      grateful: [{ candidateId: "interaction-2", location: { sessionId, recordIndex: 3, timestamp: records[3].timestamp } }],
    },
  };
  const metadata = new Map([[sessionId, { label: "Deployment feedback", agentName: "Codex", startedAt: records[0].timestamp }]]);
  const preview = makeInteractionEvidencePreview(report, [{ sessionId, records }], metadata);

  assert.equal(preview.format, "behavior-wrapped-interaction-evidence-v1");
  assert.equal(preview.localPrivate, true);
  assert.equal(preview.standardRedactionsApplied, false);
  assert.deepEqual(preview.frustrated[0].messages.map((message) => message.role), ["assistant", "user", "assistant"]);
  assert.equal(preview.frustrated[0].messages[1].highlighted, true);
  assert.match(preview.frustrated[0].messages[1].text, /sk-test_/);
  assert.equal(preview.grateful[0].messages.at(-1).text, "Perfect, thank you!");
});

test("falls back to timestamps when a stored record index no longer matches", () => {
  const timestamp = "2026-08-01T00:00:03.000Z";
  const records = [{ type: "user", timestamp, message: { content: "Thanks for fixing that." } }];
  const report = { id: "report-older", interactionReview: { frustrated: [], grateful: [{ candidateId: "interaction-1", location: { sessionId: "older", recordIndex: 99, timestamp } }] } };
  const preview = makeInteractionEvidencePreview(report, [{ sessionId: "older", records }], new Map());
  assert.equal(preview.grateful[0].messages[0].text, "Thanks for fixing that.");
});
