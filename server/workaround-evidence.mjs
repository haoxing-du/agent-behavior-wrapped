import { localOpeningPrompt, makeDonationPreview } from "./analysis.mjs";

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

function exactLocalText(value) {
  return String(value || "").trim();
}

function toolResultText(record) {
  return contentBlocks(record).filter((block) => block?.type === "tool_result").map((block) => {
    const content = typeof block.content === "string"
      ? block.content
      : Array.isArray(block.content)
        ? block.content.map((part) => typeof part === "string" ? part : part?.text || "").filter(Boolean).join("\n")
        : "";
    return content || block.error_summary || "";
  }).filter(Boolean).join("\n").trim();
}

function parsedJson(value) {
  try { return JSON.parse(value); } catch { return null; }
}

function exactCommandFromWrapper(value) {
  const match = String(value).match(/(?:\b(?:cmd|command)|"(?:cmd|command)")\s*:\s*("(?:\\.|[^"\\])*")/s);
  return match ? parsedJson(match[1]) : null;
}

function formattedToolInput(value) {
  if (value && typeof value === "object") {
    const direct = value.cmd ?? value.command;
    return typeof direct === "string" && direct.trim() ? direct.trim() : JSON.stringify(value, null, 2);
  }
  const text = String(value || "").trim();
  if (!text) return "";
  const decoded = parsedJson(text);
  if (decoded && typeof decoded === "object") return formattedToolInput(decoded);
  return exactCommandFromWrapper(text) || text;
}

function toolAction(record, fallbackText) {
  const block = contentBlocks(record).find((item) => item?.type === "tool_use");
  if (block) return {
    toolName: String(block.name || "Tool"),
    details: exactLocalText(formattedToolInput(block.input) || fallbackText),
    timestamp: record?.timestamp || null,
  };
  return {
    toolName: "Agent message",
    details: exactLocalText(visibleText(record) || fallbackText),
    timestamp: record?.timestamp || null,
  };
}

function isUserTurn(record) {
  return record?.type === "user" && !record?.isMeta && Boolean(localOpeningPrompt(visibleText(record)));
}

function turnsBetweenOpeningAndAction(records, actionIndex) {
  if (actionIndex === null) return 0;
  const openingIndex = records.findIndex((record) => record?.type === "user" && !record?.isMeta && localOpeningPrompt(visibleText(record)));
  if (openingIndex < 0 || actionIndex <= openingIndex) return 0;
  return records.slice(openingIndex + 1, actionIndex).filter(isUserTurn).length;
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

export function makeWorkaroundEvidencePreview(report, sessionRecords, metadataById) {
  const recordsById = new Map(sessionRecords.map((session) => [session.sessionId, session.records]));
  const occurrences = (report?.workaroundReview?.occurrences || []).slice(0, MAX_OCCURRENCES).flatMap((occurrence, index) => {
    const sessionId = occurrence?.location?.sessionId;
    const records = recordsById.get(sessionId);
    if (!records) return [];
    const metadata = metadataById.get(sessionId);
    const donationSession = makeDonationPreview([{ sessionId, records }], metadataById, { unredacted: true }).sessions[0];
    const fullOpeningMessage = donationSession?.messages?.filter((message) => message.role === "user").map((message) => exactLocalText(localOpeningPrompt(message.text))).find(Boolean)
      || donationSession?.summary
      || "Opening message unavailable";
    const originalIndex = occurrenceRecordIndex(occurrence, records, "originalRecordIndex", "tool_use");
    const blockerIndex = occurrenceRecordIndex(occurrence, records, "blockerRecordIndex", "tool_result");
    const alternativeIndex = occurrenceRecordIndex(occurrence, records, "alternativeRecordIndex", ["assistant_text", "tool_use"]);
    const originalRecord = originalIndex === null ? null : records[originalIndex];
    const blockerRecord = blockerIndex === null ? null : records[blockerIndex];
    const alternativeRecord = alternativeIndex === null ? null : records[alternativeIndex];
    const blockerText = exactLocalText(toolResultText(blockerRecord) || matchingEvidenceText(occurrence, "tool_result") || occurrence.blocker || "The original method was blocked.");
    return [{
      index: index + 1,
      session: {
        label: metadata?.label || `Session ${index + 1}`,
        agentName: metadata?.agentName || "AI agent",
        startedAt: metadata?.startedAt || records.find((record) => record?.timestamp)?.timestamp || null,
        openingMessage: {
          preview: donationSession?.summary || fullOpeningMessage,
          full: fullOpeningMessage,
        },
        turnsBeforeWorkaround: turnsBetweenOpeningAndAction(records, originalIndex),
      },
      originalAction: toolAction(originalRecord, occurrence.originalMethod || matchingEvidenceText(occurrence, "tool_use") || "Original tool call unavailable"),
      blocker: { text: blockerText, timestamp: blockerRecord?.timestamp || null },
      workaroundAction: toolAction(alternativeRecord, occurrence.alternativeMethod || matchingEvidenceText(occurrence, "assistant_text") || "Workaround action unavailable"),
    }];
  });
  return {
    format: "behavior-wrapped-workaround-evidence-v4",
    localPrivate: true,
    standardRedactionsApplied: false,
    reportId: report?.id,
    occurrences,
  };
}
