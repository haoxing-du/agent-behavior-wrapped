const MAX_DONATION_BYTES = 20_000_000;
const MAX_SESSIONS = 250;
const MAX_MESSAGES = 50_000;
const MAX_MESSAGE_LENGTH = 20_000;

function safeText(value, maximum) {
  return typeof value === "string" ? value.normalize("NFKC").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, maximum) : "";
}

function normalizeClassifierFeedback(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (!new Set(["yelling", "thanking"]).has(value.originalLabel) || !new Set(["yelling", "thanking", "neither", "unsure"]).has(value.correctedLabel)) return null;
  const judgedText = safeText(value.judgedText, 240).trim();
  const candidateId = safeText(value.candidateId, 64).trim();
  const model = safeText(value.judge?.model, 120).trim();
  const promptVersion = Number(value.judge?.promptVersion);
  const occurrences = Number(value.occurrences);
  const confidence = Number(value.confidence);
  if (!judgedText || !candidateId || !model || !Number.isInteger(promptVersion) || promptVersion < 1 || promptVersion > 10_000) return null;
  if (!Number.isInteger(occurrences) || occurrences < 1 || occurrences > 1_000_000 || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
  const note = safeText(value.note, 1_000).trim();
  return {
    originalLabel: value.originalLabel,
    correctedLabel: value.correctedLabel,
    candidateId,
    judgedText,
    occurrences,
    confidence,
    judge: { model, promptVersion },
    ...(note ? { note } : {}),
  };
}

function normalizeResearchDonation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.consent?.researchDonation !== true) return null;
  if (!/^[A-Za-z0-9_-]{8,32}$/.test(value.reportId || "")) return null;
  if (value.purpose !== undefined && !new Set(["general_research", "classifier_feedback"]).has(value.purpose)) return null;
  const purpose = value.purpose === "classifier_feedback" ? "classifier_feedback" : "general_research";
  if (!new Set(["standard", "custom", "unredacted"]).has(value.redactionMode)) return null;
  const unredacted = value.redactionMode === "unredacted";
  if (unredacted && value.consent?.unredactedData !== true) return null;
  if (!Array.isArray(value.sessions) || !value.sessions.length || value.sessions.length > MAX_SESSIONS) return null;
  let messageCount = 0;
  const sessions = value.sessions.flatMap((session, sessionIndex) => {
    if (!session || typeof session !== "object" || !Array.isArray(session.messages)) return [];
    const messages = session.messages.flatMap((message) => {
      if (!message || !new Set(["user", "assistant"]).has(message.role)) return [];
      const text = safeText(message.text, MAX_MESSAGE_LENGTH).trim();
      if (!text) return [];
      messageCount++;
      const timestamp = typeof message.timestamp === "string" && /^\d{4}-\d{2}-\d{2}T/.test(message.timestamp) ? message.timestamp.slice(0, 32) : null;
      return [{ role: message.role, text, ...(timestamp ? { timestamp } : {}) }];
    });
    return messages.length ? [{ label: `Session ${sessionIndex + 1}`, messages }] : [];
  });
  if (!sessions.length || messageCount > MAX_MESSAGES) return null;
  const classifierFeedback = purpose === "classifier_feedback" ? normalizeClassifierFeedback(value.classifierFeedback) : null;
  if (purpose === "classifier_feedback" && (!classifierFeedback || value.consent?.classifierFeedback !== true || sessions.length !== 1)) return null;
  const donation = {
    format: "behavior-wrapped-research-donation-v1",
    reportId: value.reportId,
    purpose,
    redactionMode: value.redactionMode,
    createdAt: /^\d{4}-\d{2}-\d{2}T/.test(value.createdAt || "") ? value.createdAt : new Date().toISOString(),
    redactionSummary: {
      automatedDetections: unredacted ? 0 : Math.round(Math.max(0, Math.min(Number(value.redactionSummary?.automatedDetections) || 0, 1_000_000))),
      sessions: sessions.length,
      messages: messageCount,
    },
    ...(classifierFeedback ? { classifierFeedback } : {}),
    sessions,
    consent: {
      researchDonation: true,
      ...(classifierFeedback ? { classifierFeedback: true } : {}),
      ...(unredacted ? { unredactedData: true } : {}),
      statement: classifierFeedback
        ? "I consent for this reviewed session and classification correction to be transmitted to the Susan Calvin Project and used for research and to evaluate and improve Behavior Wrapped under the data policy."
        : unredacted
        ? "I understand this donation is not automatically redacted and may contain credentials, personal details, private code, URLs, and file paths. I consent to transmit it to the Susan Calvin Project for research under the data policy."
        : "I consent for this reviewed data to be transmitted to the Susan Calvin Project and used for research under the data policy.",
      consentedAt: /^\d{4}-\d{2}-\d{2}T/.test(value.consent.consentedAt || "") ? value.consent.consentedAt : new Date().toISOString(),
    },
  };
  return donation;
}

export function researchDonationByteLength(value) {
  const donation = normalizeResearchDonation(value);
  return donation ? new TextEncoder().encode(JSON.stringify(donation)).byteLength : null;
}

export function sanitizeResearchDonation(value) {
  const donation = normalizeResearchDonation(value);
  return donation && new TextEncoder().encode(JSON.stringify(donation)).byteLength <= MAX_DONATION_BYTES ? donation : null;
}

export { MAX_DONATION_BYTES };
