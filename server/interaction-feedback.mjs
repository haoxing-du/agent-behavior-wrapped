import { interactionToneCandidateText } from "./interaction-tone.mjs";

export const INTERACTION_FEEDBACK_LABELS = new Set(["yelling", "thanking", "neither", "unsure"]);

function contentBlocks(record) {
  const content = record?.message?.content ?? record?.content;
  if (Array.isArray(content)) return content;
  if (typeof content === "string") return [{ type: "text", text: content }];
  return [];
}

function visibleText(record) {
  return contentBlocks(record).filter((block) => block?.type === "text").map((block) => block.text || "").join("\n").trim();
}

export function interactionFeedbackId(kind, index) {
  const label = kind === "frustrated" ? "yelling" : kind === "grateful" ? "thanking" : null;
  return label && Number.isInteger(index) && index >= 0 ? `${label}-${index + 1}` : null;
}

function feedbackCoordinates(value) {
  const match = String(value || "").match(/^(yelling|thanking)-([1-9][0-9]{0,2})$/);
  return match ? { originalLabel: match[1], index: Number(match[2]) - 1 } : null;
}

function fallbackJudgedText(reference, records) {
  if (typeof reference?.judgedText === "string" && reference.judgedText) return reference.judgedText;
  const location = reference?.location || {};
  let record = Number.isInteger(location.recordIndex) ? records?.[location.recordIndex] : null;
  if (!record || record.type !== "user") record = records?.find((item) => item?.type === "user" && item?.timestamp === location.timestamp);
  return interactionToneCandidateText(visibleText(record)) || "";
}

export function resolveInteractionFeedback(report, feedbackId, recordsById = new Map()) {
  const coordinates = feedbackCoordinates(feedbackId);
  if (!coordinates) return null;
  const kind = coordinates.originalLabel === "yelling" ? "frustrated" : "grateful";
  const reference = report?.interactionReview?.[kind]?.[coordinates.index];
  const sessionId = reference?.location?.sessionId;
  if (!reference || typeof sessionId !== "string" || !(report?.sessionIds || []).includes(sessionId)) return null;
  const review = report.interactionReview || {};
  return {
    id: feedbackId,
    originalLabel: coordinates.originalLabel,
    sessionId,
    candidateId: typeof reference.candidateId === "string" ? reference.candidateId.slice(0, 64) : "unknown",
    judgedText: fallbackJudgedText(reference, recordsById.get(sessionId)).slice(0, 240),
    occurrences: Number.isInteger(reference.occurrences) && reference.occurrences > 0 ? Math.min(reference.occurrences, 1_000_000) : 1,
    confidence: Number.isFinite(reference.confidence) ? Math.max(0, Math.min(1, reference.confidence)) : 1,
    judge: {
      model: typeof review.model === "string" ? review.model.slice(0, 120) : "unknown",
      promptVersion: Number.isInteger(review.promptVersion) && review.promptVersion > 0 ? review.promptVersion : 1,
    },
  };
}

export function publicInteractionFeedback(value) {
  if (!value) return null;
  const { sessionId, ...safe } = value;
  return safe;
}

export function sanitizeInteractionFeedbackSubmission(value, trusted) {
  if (!trusted || value?.feedbackId !== trusted.id || !INTERACTION_FEEDBACK_LABELS.has(value?.correctedLabel)) return null;
  const note = typeof value.note === "string"
    ? value.note.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 1_000)
    : "";
  return {
    originalLabel: trusted.originalLabel,
    correctedLabel: value.correctedLabel,
    candidateId: trusted.candidateId,
    judgedText: trusted.judgedText,
    occurrences: trusted.occurrences,
    confidence: trusted.confidence,
    judge: trusted.judge,
    ...(note ? { note } : {}),
  };
}
