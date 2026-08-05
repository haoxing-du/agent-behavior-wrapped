import { buildOpenRouterJudgeRequest, extractCandidateId, OPENROUTER_MODEL } from "../server/phrase-card.mjs";

const MAX_BODY_BYTES = 48_000;
const MAX_CANDIDATES = 100;
const candidateKeys = ["candidate_id", "distinct_sessions", "end_boundary_rate", "occurrences", "opening_rate", "phrase", "start_boundary_rate"];

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
}

function validRate(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function validCandidate(candidate, index) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
  if (Object.keys(candidate).sort().join("|") !== candidateKeys.join("|")) return false;
  if (candidate.candidate_id !== `phrase-${index + 1}`) return false;
  if (typeof candidate.phrase !== "string" || candidate.phrase.length > 120) return false;
  if (!/^[a-z]+(?:'[a-z]+)?(?: [a-z]+(?:'[a-z]+)?){3,9}$/.test(candidate.phrase)) return false;
  if (!Number.isInteger(candidate.occurrences) || candidate.occurrences < 1 || candidate.occurrences > 10_000_000) return false;
  if (!Number.isInteger(candidate.distinct_sessions) || candidate.distinct_sessions < 1 || candidate.distinct_sessions > candidate.occurrences) return false;
  return validRate(candidate.opening_rate) && validRate(candidate.start_boundary_rate) && validRate(candidate.end_boundary_rate);
}

export function validateRelayPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).join("|") !== "candidates") return null;
  if (!Array.isArray(value.candidates) || value.candidates.length < 1 || value.candidates.length > MAX_CANDIDATES) return null;
  return value.candidates.every(validCandidate) ? value.candidates : null;
}

async function applyRateLimit(binding, key) {
  if (!binding?.limit) return true;
  return (await binding.limit({ key })).success;
}

async function readLimitedBody(request) {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(body);
}

export async function handleRequest(request, env, fetchImpl = fetch) {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health") return json({ service: "behavior-wrapped-phrase-judge", healthy: true });
  if (url.pathname !== "/v1/phrase-card") return json({ error: "Not found." }, 404);
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (request.headers.get("x-behavior-wrapped-protocol") !== "1") return json({ error: "Unsupported client protocol." }, 400);
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) return json({ error: "Request too large." }, 413);

  const raw = await readLimitedBody(request);
  if (raw === null) return json({ error: "Request too large." }, 413);
  let body;
  try { body = JSON.parse(raw); } catch { return json({ error: "Invalid JSON." }, 400); }
  const candidates = validateRelayPayload(body);
  if (!candidates) return json({ error: "Invalid redacted candidate payload." }, 400);

  const clientHeader = request.headers.get("x-behavior-wrapped-client") || "";
  const networkId = request.headers.get("cf-connecting-ip") || "unknown";
  const clientKey = /^[a-f0-9]{32}$/.test(clientHeader) ? clientHeader : networkId;
  if (!await applyRateLimit(env.CLIENT_RATE_LIMITER, clientKey)) return json({ error: "Too many requests from this client. Try again shortly." }, 429);
  if (!await applyRateLimit(env.GLOBAL_RATE_LIMITER, "all-clients")) return json({ error: "The shared phrase judge is busy. Try again shortly." }, 429);
  if (!env.OPENROUTER_API_KEY) return json({ error: "Phrase judge is not configured." }, 503);

  let upstream;
  try {
    upstream = await fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        "x-title": "Behavior Wrapped",
      },
      body: JSON.stringify(buildOpenRouterJudgeRequest(candidates)),
    });
  } catch (error) {
    console.error(JSON.stringify({
      event: "openrouter_fetch_error",
      name: error?.name || null,
      message: String(error?.message || "request failed").slice(0, 240),
    }));
    return json({ error: "Phrase judge is temporarily unavailable." }, 502);
  }
  const upstreamBody = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    console.error(JSON.stringify({
      event: "openrouter_error",
      status: upstream.status,
      code: upstreamBody?.error?.code || null,
      message: String(upstreamBody?.error?.message || "request failed").slice(0, 240),
    }));
    return json({ error: "Phrase judge is temporarily unavailable." }, 502);
  }
  const candidateId = extractCandidateId(upstreamBody, candidates);
  if (!candidateId) return json({ error: "Phrase judge returned an invalid selection." }, 502);
  const usage = upstreamBody.usage ? {
    prompt_tokens: upstreamBody.usage.prompt_tokens || 0,
    completion_tokens: upstreamBody.usage.completion_tokens || 0,
    total_tokens: upstreamBody.usage.total_tokens || 0,
  } : null;
  return json({
    candidate_id: candidateId,
    model: upstreamBody.model || OPENROUTER_MODEL,
    usage,
  });
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
};
