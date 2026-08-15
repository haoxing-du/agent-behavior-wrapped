import { makeDonationPreview } from "./analysis.mjs";
import { redactText } from "./privacy.mjs";

const DEFAULT_CONTEXT_TURNS = 2;
const MAX_OCCURRENCES = 100;

function finiteRecordIndex(value, length) {
  return Number.isInteger(value) && value >= 0 && value < length ? value : null;
}

function contentBlocks(record) {
  const content = record?.message?.content ?? record?.content;
  if (Array.isArray(content)) return content;
  if (typeof content === "string") return [{ type: "text", text: content }];
  return [];
}

function visibleText(record) {
  return contentBlocks(record).filter((block) => block?.type === "text").map((block) => block.text || "").join("\n").trim();
}

function toolResultText(record) {
  return contentBlocks(record).filter((block) => block?.type === "tool_result").map((block) => {
    const content = typeof block.content === "string"
      ? block.content
      : Array.isArray(block.content)
        ? block.content.map((part) => typeof part === "string" ? part : part?.text || "").filter(Boolean).join("\n")
        : "";
    return [block.error_summary, content].filter(Boolean).join("\n");
  }).filter(Boolean).join("\n").trim();
}

function toolUseText(record) {
  return contentBlocks(record).filter((block) => block?.type === "tool_use").map((block) => {
    const input = block.input && typeof block.input === "object" ? JSON.stringify(block.input, null, 2) : String(block.input || "").trim();
    return [`${String(block.name || "Tool")} tool call`, input].filter(Boolean).join("\n");
  }).filter(Boolean).join("\n\n").trim();
}

function locallyRedacted(value) {
  return redactText(String(value || ""), [], { includeHeuristicSecrets: false }).text.trim();
}

function matchingEvidenceText(occurrence, kind) {
  return String((occurrence?.evidence || []).find((event) => event?.kind === kind)?.text || "").trim();
}

function fallbackRecordIndex(occurrence, records, kind) {
  const kinds = new Set(Array.isArray(kind) ? kind : kind ? [kind] : []);
  const timestamps = new Set((occurrence?.evidence || []).filter((event) => !kinds.size || kinds.has(event?.kind)).map((event) => event?.timestamp).filter(Boolean));
  const index = records.findIndex((record) => timestamps.has(record?.timestamp));
  return index >= 0 ? index : null;
}

function occurrenceRecordIndex(occurrence, records, field, kind) {
  return finiteRecordIndex(occurrence?.location?.[field], records.length) ?? fallbackRecordIndex(occurrence, records, kind);
}

function transcriptMessage(record, kind = "context") {
  const text = locallyRedacted(visibleText(record));
  if (!text) return null;
  return { role: record.type, timestamp: record.timestamp || null, text, kind };
}

function contextAroundBlocker(records, blockerIndex, alternativeIndex, contextTurns, blockerText) {
  if (blockerIndex === null) return [];
  const conversationIndexes = records.flatMap((record, index) => !record?.isMeta && (record?.type === "user" || record?.type === "assistant") && visibleText(record) ? [index] : []);
  const selectedIndexes = [
    ...conversationIndexes.filter((index) => index < blockerIndex).slice(-contextTurns),
    blockerIndex,
    ...conversationIndexes.filter((index) => index > blockerIndex).slice(0, contextTurns),
  ];
  return selectedIndexes.flatMap((recordIndex) => {
    if (recordIndex === blockerIndex) return [{ role: "tool", timestamp: records[recordIndex]?.timestamp || null, text: blockerText, kind: "blocker" }];
    const message = transcriptMessage(records[recordIndex], recordIndex === alternativeIndex ? "workaround" : "context");
    return message ? [message] : [];
  });
}

function safeFallbackMessages(occurrence) {
  return (occurrence?.evidence || []).flatMap((event) => {
    if (!["user", "assistant", "tool"].includes(event?.role)) return [];
    const text = locallyRedacted(event?.text);
    return text ? [{ role: event.role, timestamp: event.timestamp || null, text, kind: event.kind === "tool_result" ? "blocker" : "context" }] : [];
  });
}

export function makeWorkaroundEvidencePreview(report, sessionRecords, metadataById, { contextTurns = DEFAULT_CONTEXT_TURNS } = {}) {
  const boundedContext = Number.isInteger(contextTurns) ? Math.min(4, Math.max(1, contextTurns)) : DEFAULT_CONTEXT_TURNS;
  const recordsById = new Map(sessionRecords.map((session) => [session.sessionId, session.records]));
  const occurrences = (report?.workaroundReview?.occurrences || []).slice(0, MAX_OCCURRENCES).flatMap((occurrence, index) => {
    const sessionId = occurrence?.location?.sessionId;
    const records = recordsById.get(sessionId);
    if (!records) return [];
    const metadata = metadataById.get(sessionId);
    const donationSession = makeDonationPreview([{ sessionId, records }], metadataById).sessions[0];
    const blockerIndex = occurrenceRecordIndex(occurrence, records, "blockerRecordIndex", "tool_result");
    const alternativeIndex = occurrenceRecordIndex(occurrence, records, "alternativeRecordIndex", ["assistant_text", "tool_use"]);
    const blockerRecord = blockerIndex === null ? null : records[blockerIndex];
    const alternativeRecord = alternativeIndex === null ? null : records[alternativeIndex];
    const blockerText = locallyRedacted(toolResultText(blockerRecord) || matchingEvidenceText(occurrence, "tool_result") || occurrence.blocker || "The original method was blocked.");
    const workaroundText = locallyRedacted(visibleText(alternativeRecord) || occurrence.alternativeMethod || toolUseText(alternativeRecord) || matchingEvidenceText(occurrence, "assistant_text") || "The agent tried another method.");
    const context = contextAroundBlocker(records, blockerIndex, alternativeIndex, boundedContext, blockerText);
    return [{
      index: index + 1,
      session: {
        label: metadata?.label || `Session ${index + 1}`,
        agentName: metadata?.agentName || "AI agent",
        startedAt: metadata?.startedAt || records.find((record) => record?.timestamp)?.timestamp || null,
        openingMessage: donationSession?.summary || "Opening message unavailable",
      },
      workaroundAction: { text: workaroundText, timestamp: alternativeRecord?.timestamp || null },
      blocker: { text: blockerText, timestamp: blockerRecord?.timestamp || null },
      context: context.length ? context : safeFallbackMessages(occurrence),
      contextTurns: boundedContext,
    }];
  });
  return {
    format: "behavior-wrapped-workaround-evidence-v2",
    localPrivate: true,
    standardRedactionsApplied: true,
    reportId: report?.id,
    occurrences,
  };
}
