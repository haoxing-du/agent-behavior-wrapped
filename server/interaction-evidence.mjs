const MAX_OCCURRENCES_PER_KIND = 100;

function contentBlocks(record) {
  const content = record?.message?.content ?? record?.content;
  if (Array.isArray(content)) return content;
  if (typeof content === "string") return [{ type: "text", text: content }];
  return [];
}

function visibleText(record) {
  return contentBlocks(record).filter((block) => block?.type === "text").map((block) => block.text || "").join("\n").trim();
}

function transcriptRole(record) {
  return record?.type === "assistant" ? "assistant" : record?.type === "user" && !record?.isMeta ? "user" : null;
}

function matchingRecordIndex(reference, records, expectedRole) {
  const index = reference?.location?.recordIndex;
  if (Number.isInteger(index) && index >= 0 && index < records.length) return index;
  const timestamp = reference?.location?.timestamp;
  if (!timestamp) return null;
  const fallback = records.findIndex((record) => record?.timestamp === timestamp && transcriptRole(record) === expectedRole);
  return fallback >= 0 ? fallback : null;
}

function adjacentMessage(records, fromIndex, direction) {
  for (let index = fromIndex + direction; index >= 0 && index < records.length; index += direction) {
    const role = transcriptRole(records[index]);
    const text = visibleText(records[index]);
    if (role && text) return { role, text, timestamp: records[index]?.timestamp || null, highlighted: false };
  }
  return null;
}

function exactOccurrence(reference, index, records, metadata, expectedRole) {
  const recordIndex = matchingRecordIndex(reference, records, expectedRole);
  if (recordIndex === null) return null;
  const record = records[recordIndex];
  const text = visibleText(record);
  if (transcriptRole(record) !== expectedRole || !text) return null;
  const before = adjacentMessage(records, recordIndex, -1);
  const after = adjacentMessage(records, recordIndex, 1);
  return {
    index: index + 1,
    candidateId: reference.candidateId,
    session: {
      label: metadata?.label || `Session ${index + 1}`,
      agentName: metadata?.agentName || "AI agent",
      startedAt: metadata?.startedAt || records.find((item) => item?.timestamp)?.timestamp || null,
    },
    timestamp: record.timestamp || null,
    messages: [before, { role: expectedRole, text, timestamp: record.timestamp || null, highlighted: true }, after].filter(Boolean),
  };
}

function buildKind(review, kind, expectedRole, recordsById, metadataById) {
  return (review?.[kind] || []).slice(0, MAX_OCCURRENCES_PER_KIND).flatMap((reference, index) => {
    const sessionId = reference?.location?.sessionId;
    const records = recordsById.get(sessionId);
    if (!records) return [];
    const occurrence = exactOccurrence(reference, index, records, metadataById.get(sessionId), expectedRole);
    return occurrence ? [occurrence] : [];
  });
}

export function makeInteractionEvidencePreview(report, sessionRecords, metadataById) {
  const recordsById = new Map(sessionRecords.map((session) => [session.sessionId, session.records]));
  return {
    format: "behavior-wrapped-interaction-evidence-v2",
    localPrivate: true,
    standardRedactionsApplied: false,
    reportId: report?.id,
    frustrated: buildKind(report?.interactionReview, "frustrated", "user", recordsById, metadataById),
    grateful: buildKind(report?.interactionReview, "grateful", "user", recordsById, metadataById),
    userApologies: buildKind(report?.apologyReview, "user", "user", recordsById, metadataById),
    agentApologies: buildKind(report?.apologyReview, "agent", "assistant", recordsById, metadataById),
  };
}
