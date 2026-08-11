const SECRET_PATTERNS = [
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
  [/\b(?:\d[ -]*?){13,19}\b/g, "[REDACTED NUMBER]"],
];

const LABELED_CREDENTIAL_PATTERN = /\b(?:password|passwd|pwd|secret|token|api[_ -]?key)\s*[:=]\s*(?:"[^"\n]{1,256}"|'[^'\n]{1,256}'|`[^`\n]{1,256}`|[^\s,;]{1,256})/gi;
const HOME_DIRECTORY_USER_PATTERN = /(\/Users\/|\/home\/)([^/\s]+)/g;
const NON_SECRET_VALUES = new Set("a an the this that my our your their none null undefined true false yes no not password passwd pwd secret token api key removed omitted redacted".split(" "));

function labeledCredentialValue(match) {
  const raw = match.replace(/^[^:=]+[:=]\s*/, "").trim();
  if (!raw || /^\[(?:code|inline code|url|path|redacted|removed|omitted)\b/i.test(raw)) return null;
  const quoted = /^(["'`]).*\1$/.test(raw);
  const value = raw.replace(/^["'`*_([{<]+|["'`*_\])}>.!?]+$/g, "");
  if (!value || NON_SECRET_VALUES.has(value.toLowerCase()) || /\b(?:removed|omitted|redacted)\b/i.test(value)) return null;
  if (/^(?:sk|pk|api|key|token|secret)[-_][a-z0-9_-]{12,}$/i.test(value)) return value;
  if (/^(?:AKIA|ASIA)[A-Z0-9]{16}$/.test(value) || /^gh[oprsu]_[A-Za-z0-9_]{20,}$/.test(value)) return value;
  if (/\s/.test(value)) return null;
  if (quoted && value.length >= 4) return value;
  if (value.length >= 20) return value;
  if (value.length >= 8 && /[A-Za-z]/.test(value) && /[^A-Za-z]/.test(value)) return value;
  return null;
}

function detectionDetails({ kind, label, value, replacement, offset, source }) {
  return {
    kind,
    label,
    value,
    replacement,
    length: value.length,
    context: { before: source.slice(Math.max(0, offset - 80), offset), match: value, after: source.slice(offset + value.length, offset + value.length + 80) },
  };
}

const NON_PERSON_WORDS = new Set("agent assistant user system model tool team claude zulip github person someone anyone everyone nobody only the this that new latest direct explicit online private prior session status handoff instruction instructions message messages ping pings task work context state directory window".split(" "));

function replaceLikelyPersonNames(value) {
  return String(value)
    .replace(/\b([A-Za-z][A-Za-z'-]{2,})(?=\s+(?:(?:directly|explicitly)\s+)?(?:said|says|asked|asks|ordered|requested|told|wants|needs|returns?|responds?|pinged|pings|messaged|reaffirmed))\b/gi,
      (match, word) => NON_PERSON_WORDS.has(word.toLowerCase()) ? match : "person")
    .replace(/\b(from)\s+([A-Za-z][A-Za-z'-]{2,})\b/gi,
      (match, relation, word) => NON_PERSON_WORDS.has(word.toLowerCase()) ? match : `${relation} person`)
    .replace(/\b(by)\s+([A-Za-z][A-Za-z'-]{2,})(?=\s+(?:just\s+)?(?:on|at|today|yesterday|who|and)\b)/gi,
      (match, relation, word) => NON_PERSON_WORDS.has(word.toLowerCase()) ? match : `${relation} person`)
    .replace(/\b([A-Za-z][A-Za-z'-]{2,})(?=\s+(?:messages?|pings?)\b)/gi,
      (match, word) => NON_PERSON_WORDS.has(word.toLowerCase()) ? match : "person")
    .replace(/\b(if|when|unless)\s+([A-Za-z][A-Za-z'-]{2,})(?=\s+(?:(?:directly|explicitly)\s+)?(?:pings?|pinged|messages?|messaged)\b)/gi,
      (match, relation, word) => NON_PERSON_WORDS.has(word.toLowerCase()) ? match : `${relation} person`)
    .replace(/\b((?:ping|message|tell|ask|notify)(?:s|ed|ing)?\s+)([A-Z][a-z'-]{2,})\b/g,
      (match, action, word) => NON_PERSON_WORDS.has(word.toLowerCase()) ? match : `${action}person`);
}

export function redactText(input, manualTerms = []) {
  let text = String(input ?? "");
  const detections = [];
  text = text.replace(LABELED_CREDENTIAL_PATTERN, (match, offset, source) => {
    if (!labeledCredentialValue(match)) return match;
    const replacement = "[REDACTED CREDENTIAL]";
    detections.push(detectionDetails({ kind: "credential", label: "Credential", value: match, replacement, offset, source }));
    return replacement;
  });
  for (const [pattern, replacement] of [...SECRET_PATTERNS, ...PII_PATTERNS]) {
    text = text.replace(pattern, (match, offset, source) => {
      detections.push(detectionDetails({
        kind: replacement.slice(1, -1),
        label: replacement.slice(1, -1).toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()),
        value: match,
        replacement,
        offset,
        source,
      }));
      return replacement;
    });
  }
  text = text.replace(HOME_DIRECTORY_USER_PATTERN, (match, prefix, user, offset, source) => {
    const replacement = `${prefix}[REDACTED USER]`;
    detections.push(detectionDetails({ kind: "home-directory-user", label: "Home-directory username", value: match, replacement, offset, source }));
    return replacement;
  });
  for (const term of manualTerms.filter(Boolean)) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    text = text.replace(new RegExp(escaped, "gi"), "[REMOVED BY USER]");
  }
  return { text, detections };
}

export function redactAggregateText(input) {
  return redactText(replaceLikelyPersonNames(input)).text;
}

export function safeEvidenceText(input) {
  let text = String(input ?? "").replace(/```[\s\S]*?```/g, "[CODE OMITTED]");
  text = text.replace(/`[^`\n]{24,}`/g, "[INLINE CODE OMITTED]");
  return redactText(text).text.slice(0, 520);
}
