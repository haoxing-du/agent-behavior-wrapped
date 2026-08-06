const blockedKey = /(?:authorization|api[_-]?key|credential|secret|token)/i;
const secretValue = /(?:sk|gh[oprsu])[-_][A-Za-z0-9_-]{12,}|Bearer\s+\S+/i;

function safeValue(value, depth = 0) {
  if (depth > 4 || value === undefined) return undefined;
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const normalized = value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
    return secretValue.test(normalized) ? "[REDACTED]" : normalized;
  }
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => safeValue(item, depth + 1)).filter((item) => item !== undefined);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).slice(0, 30).flatMap(([key, item]) => blockedKey.test(key) ? [] : [[key, safeValue(item, depth + 1)]]).filter(([, item]) => item !== undefined));
  }
  return undefined;
}

export function judgeRequestDetails(judge, transport, endpoint, candidates) {
  const serialized = JSON.stringify({ candidates });
  return {
    judge,
    transport,
    endpoint,
    candidate_count: candidates.length,
    payload_bytes: new TextEncoder().encode(serialized).byteLength,
  };
}

export function judgeError(message, details = {}) {
  const error = new Error(message);
  error.judgeDetails = safeValue(details);
  return error;
}

export function judgeErrorDetails(error) {
  return safeValue({
    ...(error?.judgeDetails || {}),
    error_name: error?.name || "Error",
    error_message: error?.message || "Judge request failed",
  });
}

export function judgeResponseDetails(body) {
  const message = body?.choices?.[0]?.message;
  const content = typeof message?.content === "string" ? message.content : Array.isArray(message?.content) ? message.content.map((part) => part?.text || "").join("") : "";
  return safeValue({
    model: body?.model || null,
    finish_reason: body?.choices?.[0]?.finish_reason || null,
    content_length: content.length,
    refusal: Boolean(message?.refusal),
    usage: body?.usage ? {
      prompt_tokens: body.usage.prompt_tokens || 0,
      completion_tokens: body.usage.completion_tokens || 0,
      total_tokens: body.usage.total_tokens || 0,
    } : null,
  });
}
