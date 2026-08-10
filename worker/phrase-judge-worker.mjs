import { buildOpenRouterJudgeRequest, extractCandidateId, OPENROUTER_MODEL } from "../server/phrase-card.mjs";
import { buildOpenRouterFrustrationRequest, isShareSafeFrustrationQuote } from "../server/frustration-card.mjs";
import { buildOpenRouterInteractionToneRequest, extractInteractionToneSelection, interactionToneBatches, INTERACTION_TONE_MAX_CANDIDATES, isShareSafeInteractionText, mergeInteractionToneSelections, restoreInteractionToneIds } from "../server/interaction-tone.mjs";
import { buildOpenRouterSessionTopicRequest, extractSessionTopicSelection, isShareSafeTopicMessage, SESSION_TOPIC_MAX_CANDIDATES } from "../server/session-topics.mjs";
import { buildOpenRouterWorkaroundRequest, extractWorkaroundSelection, validateWorkaroundChunks } from "../server/instrumental-workarounds.mjs";
import { sanitizePublicReport } from "../server/public-report-schema.mjs";
import { MAX_DONATION_BYTES, sanitizeResearchDonation } from "../server/research-donation-schema.mjs";
export { sanitizePublicReport } from "../server/public-report-schema.mjs";

const MAX_BODY_BYTES = 256_000;
const MAX_CANDIDATES = 100;
const candidateKeys = ["candidate_id", "distinct_sessions", "end_boundary_rate", "occurrences", "opening_rate", "phrase", "start_boundary_rate"];
const leaderboardAggregateKeys = ["agent_words", "favorite_phrase", "frustrated_messages", "grateful_messages", "instrumental_workarounds", "phrase_occurrences", "phrase_sessions", "tokens", "user_words", "word_ratio"];

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

function judgeResponseDiagnostic(body, requiredArrays) {
  const message = body?.choices?.[0]?.message;
  const content = typeof message?.content === "string" ? message.content : "";
  const finish = safeText(body?.choices?.[0]?.finish_reason, 30) || "unknown";
  if (!content) return { code: "empty_content", finish, content_length: 0, refusal: Boolean(message?.refusal) };
  const attempts = [content, content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "")];
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start >= 0 && end > start) attempts.push(content.slice(start, end + 1));
  let parsed = null;
  for (const attempt of attempts) {
    try { parsed = JSON.parse(attempt); break; } catch { /* Try the next bounded representation. */ }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { code: "invalid_json", finish, content_length: content.length };
  const missing = requiredArrays.filter((key) => !Array.isArray(parsed[key]));
  return { code: missing.length ? "missing_arrays" : "invalid_items", finish, content_length: content.length, missing };
}

function safeUpstreamMessage(value) {
  const message = safeText(value, 240);
  return /(?:Bearer\s+\S+|(?:sk|gh[oprsu])[-_][A-Za-z0-9_-]{12,})/i.test(message) ? "[REDACTED]" : message;
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

export function validateFrustrationRelayPayload(value) {
  return validateInteractionQuoteRelayPayload(value, "frustration");
}

export function validateInteractionToneRelayPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).join("|") !== "candidates") return null;
  if (!Array.isArray(value.candidates) || value.candidates.length < 1 || value.candidates.length > INTERACTION_TONE_MAX_CANDIDATES) return null;
  return value.candidates.every((candidate, index) => candidate
    && typeof candidate === "object"
    && !Array.isArray(candidate)
    && Object.keys(candidate).sort().join("|") === "candidate_id|occurrences|text"
    && candidate.candidate_id === `interaction-${index + 1}`
    && isShareSafeInteractionText(candidate.text)
    && Number.isInteger(candidate.occurrences)
    && candidate.occurrences >= 1
    && candidate.occurrences <= 1_000_000) ? value.candidates : null;
}

export function validateSessionTopicRelayPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).join("|") !== "candidates") return null;
  if (!Array.isArray(value.candidates) || value.candidates.length < 1 || value.candidates.length > SESSION_TOPIC_MAX_CANDIDATES) return null;
  return value.candidates.every((candidate, index) => candidate
    && typeof candidate === "object"
    && !Array.isArray(candidate)
    && Object.keys(candidate).sort().join("|") === "candidate_id|opening_messages"
    && candidate.candidate_id === `session-topic-${index + 1}`
    && Array.isArray(candidate.opening_messages)
    && candidate.opening_messages.length >= 1
    && candidate.opening_messages.length <= 3
    && candidate.opening_messages.every(isShareSafeTopicMessage)) ? value.candidates : null;
}

export function validateWorkaroundRelayPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).join("|") !== "chunks") return null;
  return validateWorkaroundChunks(value.chunks);
}

function validateInteractionQuoteRelayPayload(value, prefix) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).join("|") !== "candidates") return null;
  if (!Array.isArray(value.candidates) || value.candidates.length < 1 || value.candidates.length > 40) return null;
  return value.candidates.every((candidate, index) => candidate
    && typeof candidate === "object"
    && !Array.isArray(candidate)
    && Object.keys(candidate).sort().join("|") === "candidate_id|quote"
    && candidate.candidate_id === `${prefix}-${index + 1}`
    && isShareSafeFrustrationQuote(candidate.quote)) ? value.candidates : null;
}

function finiteBetween(value, minimum, maximum) {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

export function validateLeaderboardAggregate(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const aggregate = Object.fromEntries(leaderboardAggregateKeys.map((key) => [key, value[key]]));
  if (!Number.isInteger(aggregate.tokens) || !finiteBetween(aggregate.tokens, 0, 10_000_000_000_000)) return null;
  if (!Number.isInteger(aggregate.agent_words) || !finiteBetween(aggregate.agent_words, 0, 10_000_000_000)) return null;
  if (!Number.isInteger(aggregate.user_words) || !finiteBetween(aggregate.user_words, 0, 10_000_000_000)) return null;
  if (!finiteBetween(aggregate.word_ratio, 0, 10_000)) return null;
  if (!Number.isInteger(aggregate.grateful_messages) || !finiteBetween(aggregate.grateful_messages, 0, 1_000_000)) return null;
  if (!Number.isInteger(aggregate.frustrated_messages) || !finiteBetween(aggregate.frustrated_messages, 0, 1_000_000)) return null;
  if (!Number.isInteger(aggregate.instrumental_workarounds) || !finiteBetween(aggregate.instrumental_workarounds, 0, 1_000_000)) return null;
  if (aggregate.favorite_phrase !== null && (typeof aggregate.favorite_phrase !== "string" || !/^[a-z]+(?:'[a-z]+)?(?: [a-z]+(?:'[a-z]+)?){3,9}$/.test(aggregate.favorite_phrase))) return null;
  if (!Number.isInteger(aggregate.phrase_occurrences) || !finiteBetween(aggregate.phrase_occurrences, 0, 10_000_000)) return null;
  if (!Number.isInteger(aggregate.phrase_sessions) || !finiteBetween(aggregate.phrase_sessions, 0, aggregate.phrase_occurrences)) return null;
  return aggregate;
}

function displayName(value) {
  if (value === "" || value === null || value === undefined) return "Anonymous";
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").trim();
  return normalized.length <= 32 && /^[\p{L}\p{N} _.-]+$/u.test(normalized) ? normalized : null;
}

function safeNumber(value, maximum = 10_000_000_000_000) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= maximum ? number : 0;
}

function safeText(value, maximum = 80) {
  return typeof value === "string" ? value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, maximum) : "";
}

async function clientHash(clientId) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(clientId));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string" || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

async function canManagePublicReport(request, record) {
  const token = request.headers.get("x-behavior-wrapped-management") || "";
  if (!/^[a-f0-9]{64}$/.test(token) || !/^[a-f0-9]{64}$/.test(record?.management_token_hash || "")) return false;
  return safeEqual(await clientHash(token), record.management_token_hash);
}

function percentile(atOrBelow, total) {
  return total ? Math.round(atOrBelow / total * 100) : null;
}

function goodHumanScore(value) {
  const grateful = Number(value.grateful_messages) || 0;
  const frustrated = Number(value.frustrated_messages) || 0;
  return grateful + frustrated ? Number((grateful / (grateful + frustrated) * 100).toFixed(1)) : null;
}

async function leaderboardSnapshot(env, aggregate, hash) {
  if (!env.LEADERBOARD_DB) throw new Error("Leaderboard storage is not configured.");
  const [values, participation] = await Promise.all([
    env.LEADERBOARD_DB.prepare("SELECT tokens, word_ratio, grateful_messages, frustrated_messages, instrumental_workarounds FROM leaderboard_entries").all(),
    env.LEADERBOARD_DB.prepare("SELECT display_name, public_ranked, favorite_phrase IS NOT NULL AS shares_phrase FROM leaderboard_entries WHERE client_hash = ?").bind(hash).first(),
  ]);
  const rows = values.results || [];
  const tokenAtOrBelow = rows.filter((row) => Number(row.tokens) <= aggregate.tokens).length;
  const ratioAtOrBelow = rows.filter((row) => Number(row.word_ratio) <= aggregate.word_ratio).length;
  const score = goodHumanScore(aggregate);
  const cohortScores = rows.map(goodHumanScore).filter((value) => value !== null);
  const scoreAtOrBelow = score === null ? 0 : cohortScores.filter((value) => value <= score).length;
  const workaroundAtOrBelow = rows.filter((row) => Number(row.instrumental_workarounds) <= aggregate.instrumental_workarounds).length;
  return {
    cohort_size: rows.length,
    tokens: {
      value: aggregate.tokens,
      percentile: percentile(tokenAtOrBelow, rows.length),
      samples: rows.map((row) => Number(row.tokens)),
    },
    word_ratio: {
      value: aggregate.word_ratio,
      percentile: percentile(ratioAtOrBelow, rows.length),
    },
    good_human_score: {
      value: score,
      percentile: score === null ? null : percentile(scoreAtOrBelow, cohortScores.length),
    },
    relationship: {
      points: rows.map((row) => ({ yap_ratio: Number(row.word_ratio), appreciation_index: goodHumanScore(row) }))
        .filter((point) => point.appreciation_index !== null),
    },
    instrumental_workarounds: {
      value: aggregate.instrumental_workarounds,
      percentile: percentile(workaroundAtOrBelow, rows.length),
      samples: rows.map((row) => Number(row.instrumental_workarounds)),
    },
    participation: participation ? { joined: true, display_name: participation.display_name, public_ranked: Boolean(participation.public_ranked), shares_phrase: Boolean(participation.shares_phrase) } : { joined: false },
  };
}

function aggregateFromPublicReport(report) {
  const stats = report.stats || {};
  return validateLeaderboardAggregate({
    tokens: Math.round(safeNumber(stats.tokens)), agent_words: Math.round(safeNumber(stats.agentWords)), user_words: Math.round(safeNumber(stats.userWords)),
    word_ratio: safeNumber(stats.agentUserWordRatio, 10_000), favorite_phrase: report.phraseCard?.phrase || null,
    grateful_messages: Math.round(safeNumber(stats.interactionTone?.gratefulMessages, 1_000_000)),
    frustrated_messages: Math.round(safeNumber(stats.interactionTone?.frustratedMessages, 1_000_000)),
    instrumental_workarounds: Math.round(safeNumber(report.workaroundCard?.count, 1_000_000)),
    phrase_occurrences: Math.round(safeNumber(report.phraseCard?.occurrences, 10_000_000)), phrase_sessions: Math.round(safeNumber(report.phraseCard?.distinctSessions, 1_000_000)),
  });
}

async function loadPublicReportRecord(env, id) {
  if (!env.LEADERBOARD_DB) return null;
  const row = await env.LEADERBOARD_DB.prepare("SELECT report_json, owner_hash, management_token_hash FROM public_reports WHERE id = ?").bind(id).first();
  if (!row?.report_json) return null;
  try { return { ...row, report: JSON.parse(row.report_json) }; } catch { return null; }
}

async function loadPublicReport(env, id) {
  return (await loadPublicReportRecord(env, id))?.report || null;
}

async function handlePublicReports(request, env) {
  if (!env.LEADERBOARD_DB) return json({ error: "Public report storage is not configured." }, 503);
  const clientId = request.headers.get("x-behavior-wrapped-client") || "";
  if (!/^[a-f0-9]{32}$/.test(clientId)) return json({ error: "A valid local client ID is required." }, 400);
  if (!await applyRateLimit(env.CLIENT_RATE_LIMITER, `reports:${clientId}`)) return json({ error: "Too many report requests. Try again shortly." }, 429);
  const hash = await clientHash(clientId);
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/v1\/reports(?:\/([A-Za-z0-9_-]{8,32}))?$/);
  if (!match) return json({ error: "Not found." }, 404);
  if (request.method === "DELETE" && match[1]) {
    const result = await env.LEADERBOARD_DB.prepare("DELETE FROM public_reports WHERE id = ? AND owner_hash = ?").bind(match[1], hash).run();
    return json({ removed: Boolean(result.meta?.changes) });
  }
  if (request.method !== "POST" || match[1]) return json({ error: "Method not allowed." }, 405);
  const raw = await readLimitedBody(request);
  if (raw === null) return json({ error: "Request too large." }, 413);
  let body;
  try { body = JSON.parse(raw); } catch { return json({ error: "Invalid JSON." }, 400); }
  const report = sanitizePublicReport(body?.report);
  if (!report) return json({ error: "Invalid share-safe report." }, 400);
  if (!/^[a-f0-9]{64}$/.test(body?.management_token || "")) return json({ error: "A valid report management credential is required." }, 400);
  const managementTokenHash = await clientHash(body.management_token);
  const serialized = JSON.stringify(report);
  if (serialized.length > 40_000 || /"(?:sessionIds|evidence|transcript|tool_result|tool_use)"\s*:/.test(serialized)) return json({ error: "Report contains data that cannot be hosted publicly." }, 400);
  try {
    await env.LEADERBOARD_DB.prepare("INSERT INTO public_reports (id, owner_hash, management_token_hash, report_json, updated_at) VALUES (?, ?, ?, ?, datetime('now'))").bind(report.id, hash, managementTokenHash, serialized).run();
  } catch { return json({ error: "That public report ID already exists." }, 409); }
  const origin = new URL(request.url).origin;
  return json({ id: report.id, public_url: `${origin}/w/${report.id}` }, 201);
}

async function handleLeaderboard(request, env) {
  const clientId = request.headers.get("x-behavior-wrapped-client") || "";
  if (!/^[a-f0-9]{32}$/.test(clientId)) return json({ error: "A valid local client ID is required." }, 400);
  const networkId = request.headers.get("cf-connecting-ip") || "unknown";
  if (!await applyRateLimit(env.CLIENT_RATE_LIMITER, `leaderboard:${clientId || networkId}`)) return json({ error: "Too many leaderboard requests. Try again shortly." }, 429);
  const hash = await clientHash(clientId);

  if (request.method === "DELETE") {
    if (!env.LEADERBOARD_DB) return json({ error: "Leaderboard storage is not configured." }, 503);
    await env.LEADERBOARD_DB.prepare("DELETE FROM leaderboard_entries WHERE client_hash = ?").bind(hash).run();
    return json({ removed: true });
  }

  const raw = await readLimitedBody(request);
  if (raw === null) return json({ error: "Request too large." }, 413);
  let body;
  try { body = JSON.parse(raw); } catch { return json({ error: "Invalid JSON." }, 400); }
  const aggregate = validateLeaderboardAggregate(body);
  if (!aggregate) return json({ error: "Invalid leaderboard aggregate." }, 400);

  const url = new URL(request.url);
  if (url.pathname === "/v1/leaderboard/snapshot" && request.method === "POST") {
    try { return json(await leaderboardSnapshot(env, aggregate, hash)); }
    catch { return json({ error: "Leaderboard storage is not configured." }, 503); }
  }
  if (url.pathname !== "/v1/leaderboard/entry" || request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (body.consent !== true || typeof body.public_ranked !== "boolean" || typeof body.include_phrase !== "boolean") return json({ error: "Explicit leaderboard consent is required." }, 400);
  const name = displayName(body.display_name);
  if (!name) return json({ error: "Display name must be 32 characters or fewer and contain only letters, numbers, spaces, dots, underscores, or hyphens." }, 400);
  if (!env.LEADERBOARD_DB) return json({ error: "Leaderboard storage is not configured." }, 503);
  const phrase = body.include_phrase ? aggregate.favorite_phrase : null;
  await env.LEADERBOARD_DB.prepare(`INSERT INTO leaderboard_entries
    (client_hash, display_name, public_ranked, tokens, agent_words, user_words, word_ratio, grateful_messages, frustrated_messages, instrumental_workarounds, favorite_phrase, phrase_occurrences, phrase_sessions, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(client_hash) DO UPDATE SET display_name=excluded.display_name, public_ranked=excluded.public_ranked,
    tokens=excluded.tokens, agent_words=excluded.agent_words, user_words=excluded.user_words, word_ratio=excluded.word_ratio,
    grateful_messages=excluded.grateful_messages, frustrated_messages=excluded.frustrated_messages, instrumental_workarounds=excluded.instrumental_workarounds,
    favorite_phrase=excluded.favorite_phrase, phrase_occurrences=excluded.phrase_occurrences,
    phrase_sessions=excluded.phrase_sessions, updated_at=datetime('now')`).bind(
      hash, name, body.public_ranked ? 1 : 0, aggregate.tokens, aggregate.agent_words, aggregate.user_words, aggregate.word_ratio,
      aggregate.grateful_messages, aggregate.frustrated_messages, aggregate.instrumental_workarounds,
      phrase, phrase ? aggregate.phrase_occurrences : 0, phrase ? aggregate.phrase_sessions : 0,
    ).run();
  return json(await leaderboardSnapshot(env, aggregate, hash));
}

async function saveLeaderboardEntry(env, hash, aggregate, body) {
  if (body.consent !== true || typeof body.publicRanked !== "boolean" || typeof body.includePhrase !== "boolean") return { error: "Explicit leaderboard consent is required.", status: 400 };
  const name = displayName(body.displayName);
  if (!name) return { error: "Display name must be 32 characters or fewer and contain only letters, numbers, spaces, dots, underscores, or hyphens.", status: 400 };
  const phrase = body.includePhrase ? aggregate.favorite_phrase : null;
  await env.LEADERBOARD_DB.prepare(`INSERT INTO leaderboard_entries
    (client_hash, display_name, public_ranked, tokens, agent_words, user_words, word_ratio, grateful_messages, frustrated_messages, instrumental_workarounds, favorite_phrase, phrase_occurrences, phrase_sessions, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(client_hash) DO UPDATE SET display_name=excluded.display_name, public_ranked=excluded.public_ranked,
    tokens=excluded.tokens, agent_words=excluded.agent_words, user_words=excluded.user_words, word_ratio=excluded.word_ratio,
    grateful_messages=excluded.grateful_messages, frustrated_messages=excluded.frustrated_messages, instrumental_workarounds=excluded.instrumental_workarounds,
    favorite_phrase=excluded.favorite_phrase, phrase_occurrences=excluded.phrase_occurrences,
    phrase_sessions=excluded.phrase_sessions, updated_at=datetime('now')`).bind(
      hash, name, body.publicRanked ? 1 : 0, aggregate.tokens, aggregate.agent_words, aggregate.user_words, aggregate.word_ratio,
      aggregate.grateful_messages, aggregate.frustrated_messages, aggregate.instrumental_workarounds,
      phrase, phrase ? aggregate.phrase_occurrences : 0, phrase ? aggregate.phrase_sessions : 0,
    ).run();
  return null;
}

async function handlePublicLeaderboard(request, env, id) {
  if (!env.LEADERBOARD_DB) return json({ error: "Leaderboard storage is not configured." }, 503);
  const record = await loadPublicReportRecord(env, id);
  if (!record) return json({ error: "Public Wrapped not found." }, 404);
  const aggregate = aggregateFromPublicReport(record.report);
  if (!aggregate) return json({ error: "This report does not contain leaderboard aggregates." }, 400);
  const canManage = await canManagePublicReport(request, record);

  if (request.method === "DELETE") {
    if (!canManage) return json({ error: "Only the creator of this Wrapped can remove its leaderboard entry." }, 403);
    await env.LEADERBOARD_DB.prepare("DELETE FROM leaderboard_entries WHERE client_hash = ?").bind(record.owner_hash).run();
    return json({ removed: true });
  }
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const raw = await readLimitedBody(request);
  if (raw === null) return json({ error: "Request too large." }, 413);
  let body;
  try { body = JSON.parse(raw); } catch { return json({ error: "Invalid JSON." }, 400); }
  if (body.action === "join") {
    if (!canManage) return json({ error: "Only the creator of this Wrapped can join with these results." }, 403);
    const failure = await saveLeaderboardEntry(env, record.owner_hash, aggregate, body);
    if (failure) return json({ error: failure.error }, failure.status);
  } else if (body.action !== "snapshot") {
    return json({ error: "Invalid leaderboard action." }, 400);
  }
  try { return json({ ...await leaderboardSnapshot(env, aggregate, canManage ? record.owner_hash : `public:${id}`), can_manage: canManage }); }
  catch { return json({ error: "Leaderboard storage is not configured." }, 503); }
}

async function handleResearchDonation(request, env) {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!env.LEADERBOARD_DB) return json({ error: "Research donation storage is not configured." }, 503);
  const clientId = request.headers.get("x-behavior-wrapped-client") || "";
  if (!/^[a-f0-9]{32}$/.test(clientId)) return json({ error: "A valid local client ID is required." }, 400);
  if (!await applyRateLimit(env.CORPUS_RATE_LIMITER || env.CLIENT_RATE_LIMITER, `research-donation:${clientId}`)) return json({ error: "Too many donation requests. Try again shortly." }, 429);
  const raw = await readLimitedBody(request, MAX_DONATION_BYTES + 20_000);
  if (raw === null) return json({ error: "Research donation is too large." }, 413);
  let body;
  try { body = JSON.parse(raw); } catch { return json({ error: "Invalid JSON." }, 400); }
  const donation = sanitizeResearchDonation(body?.donation);
  if (!donation) return json({ error: "Invalid or unconsented research donation." }, 400);
  const id = crypto.randomUUID();
  const ownerHash = await clientHash(clientId);
  try {
    await env.LEADERBOARD_DB.prepare(`INSERT INTO research_donations
      (id, owner_hash, report_id, donation_json, consented_at, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))`).bind(
        id, ownerHash, donation.reportId, JSON.stringify(donation), donation.consent.consentedAt,
      ).run();
  } catch { return json({ error: "Research donation storage is not configured." }, 503); }
  return json({ accepted: true, donation_id: id }, 201);
}

async function applyRateLimit(binding, key) {
  if (!binding?.limit) return true;
  return (await binding.limit({ key })).success;
}

async function readLimitedBody(request, maximumBytes = MAX_BODY_BYTES) {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximumBytes) {
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

async function requestOpenRouter(env, fetchImpl, requestBody) {
  let upstream;
  try {
    upstream = await fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        "x-title": "Behavior Wrapped",
      },
      body: JSON.stringify(requestBody),
    });
  } catch (error) {
    console.error(JSON.stringify({
      event: "openrouter_fetch_error",
      name: error?.name || null,
      message: String(error?.message || "request failed").slice(0, 240),
    }));
    return { errorResponse: json({ error: "Card judge is temporarily unavailable.", diagnostic: { code: "upstream_fetch_error", name: safeText(error?.name, 60) || "Error", message: safeUpstreamMessage(error?.message || "request failed") } }, 502), retryable: true };
  }
  const body = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    console.error(JSON.stringify({
      event: "openrouter_error",
      status: upstream.status,
      code: body?.error?.code || null,
      message: String(body?.error?.message || "request failed").slice(0, 240),
    }));
    return { errorResponse: json({ error: "Card judge is temporarily unavailable.", diagnostic: { code: "upstream_http", status: upstream.status, upstream_code: safeText(String(body?.error?.code ?? ""), 80) || null, upstream_message: safeUpstreamMessage(body?.error?.message || "request failed") } }, 502), retryable: upstream.status === 429 || upstream.status >= 500 };
  }
  return { body };
}

function mergedUsage(bodies) {
  const usage = bodies.map((body) => body.usage).filter(Boolean);
  return usage.length ? {
    prompt_tokens: usage.reduce((sum, item) => sum + (item.prompt_tokens || 0), 0),
    completion_tokens: usage.reduce((sum, item) => sum + (item.completion_tokens || 0), 0),
    total_tokens: usage.reduce((sum, item) => sum + (item.total_tokens || 0), 0),
  } : null;
}

async function judgeInteractionToneBatch(env, fetchImpl, batch) {
  let lastBody = {};
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await requestOpenRouter(env, fetchImpl, buildOpenRouterInteractionToneRequest(batch.local));
    if (result.errorResponse) {
      if (attempt === 0 && result.retryable) continue;
      return result;
    }
    lastBody = result.body;
    const selection = extractInteractionToneSelection(result.body, batch.local);
    if (selection) return { body: result.body, selection: restoreInteractionToneIds(selection, batch) };
  }
  return { body: lastBody, selection: null };
}

async function interactionToneCacheEntry(candidates) {
  const cache = globalThis.caches?.default;
  if (!cache || !globalThis.crypto?.subtle) return null;
  const bytes = new TextEncoder().encode(JSON.stringify(candidates));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return { cache, key: new Request(`https://agent-behavior-wrapped-judge.haoxingdu.workers.dev/.cache/interaction-tone-v2/${hash}`) };
}

export async function handleRequest(request, env, fetchImpl = fetch) {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health") return json({ service: "behavior-wrapped-phrase-judge", healthy: true });
  const publicReportMatch = url.pathname.match(/^\/api\/reports\/([A-Za-z0-9_-]{8,32})$/);
  if (request.method === "GET" && publicReportMatch) {
    const report = await loadPublicReport(env, publicReportMatch[1]);
    return report ? json(report) : json({ error: "Public Wrapped not found." }, 404);
  }
  if (url.pathname === "/v1/research-donations") {
    if (request.headers.get("x-behavior-wrapped-protocol") !== "1") return json({ error: "Unsupported client protocol." }, 400);
    return handleResearchDonation(request, env);
  }
  const publicLeaderboardMatch = url.pathname.match(/^\/api\/reports\/([A-Za-z0-9_-]{8,32})\/leaderboard$/);
  if (publicLeaderboardMatch && new Set(["POST", "DELETE"]).has(request.method)) {
    const networkId = request.headers.get("cf-connecting-ip") || "unknown";
    if (!await applyRateLimit(env.CLIENT_RATE_LIMITER, `public-leaderboard:${networkId}`)) return json({ error: "Too many leaderboard requests. Try again shortly." }, 429);
    return handlePublicLeaderboard(request, env, publicLeaderboardMatch[1]);
  }
  if (url.pathname.startsWith("/v1/reports")) {
    if (request.headers.get("x-behavior-wrapped-protocol") !== "1") return json({ error: "Unsupported client protocol." }, 400);
    if (!new Set(["POST", "DELETE"]).has(request.method)) return json({ error: "Method not allowed." }, 405);
    return handlePublicReports(request, env);
  }
  if (url.pathname.startsWith("/v1/leaderboard/")) {
    if (request.headers.get("x-behavior-wrapped-protocol") !== "1") return json({ error: "Unsupported client protocol." }, 400);
    if (!new Set(["POST", "DELETE"]).has(request.method)) return json({ error: "Method not allowed." }, 405);
    return handleLeaderboard(request, env);
  }
  const frustrationRoute = url.pathname === "/v1/frustration-quote";
  const interactionToneRoute = url.pathname === "/v1/interaction-tone";
  const sessionTopicRoute = url.pathname === "/v1/session-topics";
  const workaroundRoute = url.pathname === "/v1/instrumental-workarounds";
  if (url.pathname !== "/v1/phrase-card" && !frustrationRoute && !interactionToneRoute && !sessionTopicRoute && !workaroundRoute) return json({ error: "Not found." }, 404);
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (request.headers.get("x-behavior-wrapped-protocol") !== "1") return json({ error: "Unsupported client protocol." }, 400);
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) return json({ error: "Request too large." }, 413);

  const raw = await readLimitedBody(request);
  if (raw === null) return json({ error: "Request too large." }, 413);
  let body;
  try { body = JSON.parse(raw); } catch { return json({ error: "Invalid JSON." }, 400); }
  const candidates = workaroundRoute ? validateWorkaroundRelayPayload(body) : sessionTopicRoute ? validateSessionTopicRelayPayload(body) : interactionToneRoute ? validateInteractionToneRelayPayload(body) : frustrationRoute ? validateFrustrationRelayPayload(body) : validateRelayPayload(body);
  if (!candidates) return json({ error: "Invalid redacted analysis payload." }, 400);

  const toneCache = interactionToneRoute ? await interactionToneCacheEntry(candidates) : null;
  const cachedTone = toneCache ? await toneCache.cache.match(toneCache.key) : null;
  if (cachedTone) {
    const cachedBody = await cachedTone.json().catch(() => null);
    if (cachedBody && extractInteractionToneSelection(cachedBody, candidates)) return json(cachedBody);
  }

  const clientHeader = request.headers.get("x-behavior-wrapped-client") || "";
  const networkId = request.headers.get("cf-connecting-ip") || "unknown";
  const clientKey = /^[a-f0-9]{32}$/.test(clientHeader) ? clientHeader : networkId;
  const judgeKind = workaroundRoute ? "instrumental-workarounds" : sessionTopicRoute ? "session-topics" : interactionToneRoute ? "interaction-tone" : frustrationRoute ? "frustration" : "phrase";
  const clientLimiter = workaroundRoute && env.CORPUS_RATE_LIMITER ? env.CORPUS_RATE_LIMITER : env.CLIENT_RATE_LIMITER;
  if (!await applyRateLimit(clientLimiter, `${judgeKind}:${clientKey}`)) return json({ error: "Too many requests from this client. Try again shortly." }, 429);
  if (!await applyRateLimit(env.GLOBAL_RATE_LIMITER, "all-clients")) return json({ error: "The shared phrase judge is busy. Try again shortly." }, 429);
  if (!env.OPENROUTER_API_KEY) return json({ error: "Phrase judge is not configured." }, 503);

  if (interactionToneRoute) {
    const batches = interactionToneBatches(candidates);
    const results = await Promise.all(batches.map((batch) => judgeInteractionToneBatch(env, fetchImpl, batch)));
    const failed = results.find((result) => result.errorResponse);
    if (failed) return failed.errorResponse;
    const selections = results.map((result) => result.selection);
    const invalidIndex = selections.findIndex((selection) => !selection);
    if (invalidIndex >= 0) return json({ error: "Interaction-tone judge returned an invalid classification.", diagnostic: judgeResponseDiagnostic(results[invalidIndex].body, ["classifications"]) }, 502);
    const responseBody = {
      ...mergeInteractionToneSelections(candidates, selections),
      model: results[0]?.body?.model || OPENROUTER_MODEL,
      usage: mergedUsage(results.map((result) => result.body)),
    };
    if (toneCache) await toneCache.cache.put(toneCache.key, new Response(JSON.stringify(responseBody), { headers: { "content-type": "application/json", "cache-control": "public, max-age=604800" } }));
    return json(responseBody);
  }

  const upstreamResult = await requestOpenRouter(env, fetchImpl, workaroundRoute ? buildOpenRouterWorkaroundRequest(candidates) : sessionTopicRoute ? buildOpenRouterSessionTopicRequest(candidates) : frustrationRoute ? buildOpenRouterFrustrationRequest(candidates) : buildOpenRouterJudgeRequest(candidates));
  if (upstreamResult.errorResponse) return upstreamResult.errorResponse;
  const upstreamBody = upstreamResult.body;
  const usage = upstreamBody.usage ? {
    prompt_tokens: upstreamBody.usage.prompt_tokens || 0,
    completion_tokens: upstreamBody.usage.completion_tokens || 0,
    total_tokens: upstreamBody.usage.total_tokens || 0,
  } : null;
  if (workaroundRoute) {
    const selection = extractWorkaroundSelection(upstreamBody, candidates);
    if (!selection) return json({ error: "Instrumental-workaround judge returned an invalid review.", diagnostic: judgeResponseDiagnostic(upstreamBody, ["verdicts"]) }, 502);
    return json({ ...selection, model: upstreamBody.model || OPENROUTER_MODEL, usage });
  }
  if (sessionTopicRoute) {
    const selection = extractSessionTopicSelection(upstreamBody, candidates);
    if (!selection) return json({ error: "Session-topic judge returned an invalid classification." }, 502);
    return json({ ...selection, model: upstreamBody.model || OPENROUTER_MODEL, usage });
  }
  const candidateId = extractCandidateId(upstreamBody, candidates);
  if (!candidateId) return json({ error: "Card judge returned an invalid selection." }, 502);
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
