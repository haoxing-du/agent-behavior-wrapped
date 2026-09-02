const INTEGRITY_ERROR = "Donated sessions must keep every original message in its original order. Exclude the whole session instead of individual messages.";

export function donationSessionIntegrityError(donatedSessions, sourceSessions) {
  if (!Array.isArray(donatedSessions) || !donatedSessions.length || !Array.isArray(sourceSessions)) return INTEGRITY_ERROR;
  const sourceById = new Map(sourceSessions.map((session) => [session?.sessionId, session]));
  const seen = new Set();
  for (const session of donatedSessions) {
    const source = sourceById.get(session?.sessionId);
    if (!source || seen.has(session.sessionId) || !Array.isArray(session.messages) || session.messages.length !== source.messages.length) return INTEGRITY_ERROR;
    seen.add(session.sessionId);
    for (let index = 0; index < source.messages.length; index++) {
      const message = session.messages[index];
      const original = source.messages[index];
      if (message?.role !== original.role || message?.sourceIndex !== original.sourceIndex || typeof message?.text !== "string" || !message.text.trim()) return INTEGRITY_ERROR;
    }
  }
  return null;
}

export { INTEGRITY_ERROR };
