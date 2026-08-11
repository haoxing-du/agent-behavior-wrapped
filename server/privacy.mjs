const SECRET_PATTERNS = [
  [/\bsk[-_][a-z0-9_-]{16,}\b/gi, "[REDACTED SECRET]"],
  [/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "[REDACTED AWS KEY]"],
  [/\bgh[oprsu]_[A-Za-z0-9_]{20,}\b/g, "[REDACTED GITHUB TOKEN]"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED PRIVATE KEY]"],
];

const HEURISTIC_SECRET_PATTERNS = [
  [/(?:api|key|token|secret)[-_][a-z0-9_-]{12,}/gi, "[REDACTED SECRET]"],
  [/\b[A-Za-z0-9+/]{40,}={0,2}\b/g, "[REDACTED HIGH-ENTROPY STRING]"],
];

const PII_PATTERNS = [
  [/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, "[REDACTED PHONE]"],
  [/\b\d{3}-\d{2}-\d{4}\b/g, "[REDACTED SSN]"],
  [/\b(?:\d[ -]*?){13,19}\b/g, "[REDACTED NUMBER]"],
];

const LABELED_CREDENTIAL_PATTERN = /\b(?:password|passwd|pwd|secret|token|api[_ -]?key)\s*[:=]\s*(?:"[^"\n]{1,256}"|'[^'\n]{1,256}'|`[^`\n]{1,256}`|[^\s,;]{1,256})/gi;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const HOME_DIRECTORY_USER_PATTERN = /(\/Users\/|\/home\/)([^/\s]+)/g;
const NON_SECRET_VALUES = new Set("a an the this that my our your their none null undefined true false yes no not password passwd pwd secret token api key removed omitted redacted".split(" "));

function labeledCredentialValue(match) {
  const raw = match.replace(/^[^:=]+[:=]\s*/, "").trim();
  if (!raw || /^\[(?:code|inline code|url|path|redacted|removed|omitted)\b/i.test(raw)) return null;
  const quoted = /^(["'`]).*\1$/.test(raw);
  const value = raw.replace(/^["'`*_([{<]+|["'`*_\])}>.!?]+$/g, "");
  if (!value || NON_SECRET_VALUES.has(value.toLowerCase()) || /\b(?:removed|omitted|redacted)\b/i.test(value)) return null;
  if (/^sk[-_][a-z0-9_-]{16,}$/i.test(value)) return value;
  if (/^(?:AKIA|ASIA)[A-Z0-9]{16}$/.test(value) || /^gh[oprsu]_[A-Za-z0-9_]{20,}$/.test(value)) return value;
  if (/\s/.test(value)) return null;
  if (quoted && value.length >= 4) return value;
  if (value.length >= 20) return value;
  if (value.length >= 8 && /[A-Za-z]/.test(value) && /\d/.test(value)) return value;
  if (value.length >= 12 && /[A-Z]/.test(value) && /[a-z]/.test(value) && /[_+/=]/.test(value)) return value;
  return null;
}

function normalizedRedactionKind(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function detectionDetails({ kind, label, value, replacement, offset, source, enabled = true }) {
  return {
    kind,
    label,
    value,
    replacement,
    enabled,
    length: value.length,
    context: { before: source.slice(Math.max(0, offset - 80), offset), match: value, after: source.slice(offset + value.length, offset + value.length + 80) },
  };
}

function isSshIdentity(match, offset, source) {
  const localPart = match.slice(0, match.indexOf("@")).toLowerCase();
  const before = source.slice(Math.max(0, offset - 8), offset);
  const after = source.slice(offset + match.length, offset + match.length + 1);
  return localPart === "git" || /ssh:\/\/$/i.test(before) || after === ":";
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

export function redactText(input, manualTerms = [], { disabledKinds = [], includeHeuristicSecrets = true } = {}) {
  let text = String(input ?? "");
  const detections = [];
  const disabled = new Set(disabledKinds.map(normalizedRedactionKind));
  text = text.replace(LABELED_CREDENTIAL_PATTERN, (match, offset, source) => {
    if (!labeledCredentialValue(match)) return match;
    const replacement = "[REDACTED CREDENTIAL]";
    const enabled = !disabled.has("credential");
    detections.push(detectionDetails({ kind: "credential", label: "Credential", value: match, replacement, offset, source, enabled }));
    return enabled ? replacement : match;
  });
  for (const [pattern, replacement] of [...SECRET_PATTERNS, ...(includeHeuristicSecrets ? HEURISTIC_SECRET_PATTERNS : []), ...PII_PATTERNS]) {
    text = text.replace(pattern, (match, offset, source) => {
      const kind = normalizedRedactionKind(replacement);
      const enabled = !disabled.has(kind);
      detections.push(detectionDetails({
        kind,
        label: replacement.slice(1, -1).toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()),
        value: match,
        replacement,
        offset,
        source,
        enabled,
      }));
      return enabled ? replacement : match;
    });
  }
  text = text.replace(EMAIL_PATTERN, (match, offset, source) => {
    if (isSshIdentity(match, offset, source)) return match;
    const replacement = "[REDACTED EMAIL]";
    const kind = "redacted-email";
    const enabled = !disabled.has(kind);
    detections.push(detectionDetails({ kind, label: "Email", value: match, replacement, offset, source, enabled }));
    return enabled ? replacement : match;
  });
  text = text.replace(HOME_DIRECTORY_USER_PATTERN, (match, prefix, user, offset, source) => {
    const replacement = `${prefix}[REDACTED USER]`;
    const enabled = !disabled.has("home-directory-user");
    detections.push(detectionDetails({ kind: "home-directory-user", label: "Home-directory username", value: match, replacement, offset, source, enabled }));
    return enabled ? replacement : match;
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
