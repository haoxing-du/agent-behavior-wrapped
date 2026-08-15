import { makeDonationPreview } from "./analysis.mjs";

const DEFAULT_CONTEXT_TURNS = 2;
const MAX_OCCURRENCES = 100;

function finiteRecordIndex(value, length) {
  return Number.isInteger(value) && value >= 0 && value < length ? value : null;
}

function evidenceRecordIndexes(occurrence, records) {
  const location = occurrence?.location || {};
  const direct = [location.originalRecordIndex, location.blockerRecordIndex, location.alternativeRecordIndex]
    .map((value) => finiteRecordIndex(value, records.length))
    .filter((value) => value !== null);
  if (direct.length) return direct;
  const timestamps = new Set((occurrence?.evidence || []).map((event) => event?.timestamp).filter(Boolean));
  return records.flatMap((record, index) => timestamps.has(record?.timestamp) ? [index] : []);
}

function excerptRecords(records, occurrence, contextTurns) {
  const anchors = evidenceRecordIndexes(occurrence, records);
  if (!anchors.length) return [];
  const coreStart = Math.min(...anchors);
  const coreEnd = Math.max(...anchors);
  const conversationIndexes = records.flatMap((record, index) => !record?.isMeta && (record?.type === "user" || record?.type === "assistant") ? [index] : []);
  const before = conversationIndexes.filter((index) => index < coreStart).slice(-contextTurns);
  const after = conversationIndexes.filter((index) => index > coreEnd).slice(0, contextTurns);
  const start = before[0] ?? coreStart;
  const end = after.at(-1) ?? coreEnd;
  return records.slice(start, end + 1);
}

function safeFallbackMessages(occurrence) {
  return (occurrence?.evidence || []).flatMap((event) => {
    if (event?.role !== "user" && event?.role !== "assistant") return [];
    const text = String(event?.text || "").trim();
    return text ? [{ role: event.role, timestamp: event.timestamp || null, text }] : [];
  });
}

export function makeWorkaroundEvidencePreview(report, sessionRecords, metadataById, { contextTurns = DEFAULT_CONTEXT_TURNS } = {}) {
  const boundedContext = Number.isInteger(contextTurns) ? Math.min(4, Math.max(1, contextTurns)) : DEFAULT_CONTEXT_TURNS;
  const recordsById = new Map(sessionRecords.map((session) => [session.sessionId, session.records]));
  const occurrences = (report?.workaroundReview?.occurrences || []).slice(0, MAX_OCCURRENCES).flatMap((occurrence, index) => {
    const sessionId = occurrence?.location?.sessionId;
    const records = recordsById.get(sessionId);
    if (!records) return [];
    const excerpt = excerptRecords(records, occurrence, boundedContext);
    const preview = excerpt.length ? makeDonationPreview([{ sessionId, records: excerpt }], metadataById).sessions[0] : null;
    const metadata = metadataById.get(sessionId);
    const messages = preview?.messages?.length ? preview.messages : safeFallbackMessages(occurrence);
    return [{
      index: index + 1,
      summary: String(occurrence.summary || "The agent used another method after encountering a blocker."),
      confidence: ["high", "medium", "low"].includes(occurrence.confidence) ? occurrence.confidence : "unknown",
      disclosure: String(occurrence.disclosure || "unclear"),
      originalMethod: String(occurrence.originalMethod || "Original method"),
      blocker: String(occurrence.blocker || "The original method was blocked"),
      alternativeMethod: String(occurrence.alternativeMethod || "Alternative method"),
      session: { label: metadata?.label || `Session ${index + 1}`, agentName: metadata?.agentName || "AI agent" },
      messages,
      contextTurns: boundedContext,
      reconstructedFromTranscript: Boolean(preview?.messages?.length),
    }];
  });
  return {
    format: "behavior-wrapped-workaround-evidence-v1",
    localPrivate: true,
    standardRedactionsApplied: true,
    reportId: report?.id,
    occurrences,
  };
}
