const SECRET_PATTERNS = [
  [/\b(?:password|passwd|pwd|secret|token|api[_ -]?key)\s*[:=]\s*[^\s,;]+/gi, "[REDACTED CREDENTIAL]"],
  [/(?:sk|pk|api|key|token|secret)[-_][a-z0-9_-]{12,}/gi, "[REDACTED SECRET]"],
  [/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "[REDACTED AWS KEY]"],
  [/\bgh[oprsu]_[A-Za-z0-9_]{20,}\b/g, "[REDACTED GITHUB TOKEN]"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED PRIVATE KEY]"],
  [/\b[A-Za-z0-9+/]{40,}={0,2}\b/g, "[REDACTED HIGH-ENTROPY STRING]"],
];

const PII_PATTERNS = [
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED EMAIL]"],
  [/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, "[REDACTED PHONE]"],
  [/\b\d{3}-\d{2}-\d{4}\b/g, "[REDACTED SSN]"],
  [/(?:\/Users\/|\/home\/)[^/\s]+/g, "/Users/[REDACTED USER]"],
  [/\b(?:\d[ -]*?){13,19}\b/g, "[REDACTED NUMBER]"],
];

export function redactText(input, manualTerms = []) {
  let text = String(input ?? "");
  const detections = [];
  for (const [pattern, replacement] of [...SECRET_PATTERNS, ...PII_PATTERNS]) {
    text = text.replace(pattern, (match, ...groups) => {
      detections.push({ kind: replacement.slice(1, -1), length: match.length });
      return replacement;
    });
  }
  for (const term of manualTerms.filter(Boolean)) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text.replace(new RegExp(escaped, "gi"), "[REMOVED BY USER]");
  }
  return { text, detections };
}

export function safeEvidenceText(input) {
  let text = String(input ?? "").replace(/```[\s\S]*?```/g, "[CODE OMITTED]");
  text = text.replace(/`[^`\n]{24,}`/g, "[INLINE CODE OMITTED]");
  return redactText(text).text.slice(0, 520);
}
