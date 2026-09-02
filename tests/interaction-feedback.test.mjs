import assert from "node:assert/strict";
import test from "node:test";
import { publicInteractionFeedback, resolveInteractionFeedback, sanitizeInteractionFeedbackSubmission } from "../server/interaction-feedback.mjs";

function fixture() {
  return {
    id: "feedbackReport1",
    sessionIds: ["source-session"],
    interactionReview: {
      model: "openai/gpt-5.6-luna",
      promptVersion: 1,
      frustrated: [{
        candidateId: "interaction-3",
        judgedText: "This is worse than the previous version.",
        occurrences: 2,
        confidence: 1,
        location: { sessionId: "source-session", recordIndex: 0, timestamp: "2026-08-01T00:00:00.000Z" },
      }],
      grateful: [],
    },
  };
}

test("resolves only stored interaction occurrences and keeps the session ID local", () => {
  const trusted = resolveInteractionFeedback(fixture(), "yelling-1");
  assert.equal(trusted.sessionId, "source-session");
  assert.equal(trusted.originalLabel, "yelling");
  assert.equal(trusted.judgedText, "This is worse than the previous version.");
  assert.equal("sessionId" in publicInteractionFeedback(trusted), false);
  assert.equal(resolveInteractionFeedback(fixture(), "yelling-2"), null);
  assert.equal(resolveInteractionFeedback({ ...fixture(), sessionIds: ["different-session"] }, "yelling-1"), null);
});

test("reconstructs the judged excerpt for reports created before feedback metadata", () => {
  const report = fixture();
  delete report.interactionReview.frustrated[0].judgedText;
  const records = new Map([["source-session", [{ type: "user", timestamp: "2026-08-01T00:00:00.000Z", message: { content: "This is worse than the previous version." } }]]]);
  assert.equal(resolveInteractionFeedback(report, "yelling-1", records).judgedText, "This is worse than the previous version.");
});

test("accepts a correction while ignoring browser-supplied classifier provenance", () => {
  const trusted = resolveInteractionFeedback(fixture(), "yelling-1");
  const result = sanitizeInteractionFeedbackSubmission({ feedbackId: "yelling-1", correctedLabel: "neither", originalLabel: "thanking", note: " Ordinary technical feedback.\n" }, trusted);
  assert.deepEqual(result, {
    originalLabel: "yelling",
    correctedLabel: "neither",
    candidateId: "interaction-3",
    judgedText: "This is worse than the previous version.",
    occurrences: 2,
    confidence: 1,
    judge: { model: "openai/gpt-5.6-luna", promptVersion: 1 },
    note: "Ordinary technical feedback.",
  });
  assert.equal(sanitizeInteractionFeedbackSubmission({ feedbackId: "yelling-1", correctedLabel: "invalid" }, trusted), null);
  assert.equal(sanitizeInteractionFeedbackSubmission({ feedbackId: "thanking-1", correctedLabel: "neither" }, trusted), null);
});
