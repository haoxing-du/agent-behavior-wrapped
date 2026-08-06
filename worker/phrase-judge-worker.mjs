import { buildOpenRouterJudgeRequest, extractCandidateId, OPENROUTER_MODEL } from "../server/phrase-card.mjs";
import { buildOpenRouterFrustrationRequest, isShareSafeFrustrationQuote } from "../server/frustration-card.mjs";
import { buildOpenRouterInteractionToneRequest, extractInteractionToneSelection, INTERACTION_TONE_MAX_CANDIDATES, isShareSafeInteractionText } from "../server/interaction-tone.mjs";
import { buildOpenRouterSessionTopicRequest, extractSessionTopicSelection, isShareSafeTopicMessage, SESSION_TOPIC_MAX_CANDIDATES } from "../server/session-topics.mjs";
import { buildOpenRouterWorkaroundRequest, extractWorkaroundSelection, isShareSafeTrajectoryText, WORKAROUND_MAX_CANDIDATES } from "../server/instrumental-workarounds.mjs";

const MAX_BODY_BYTES = 256_000;
const MAX_CANDIDATES = 100;
const candidateKeys = ["candidate_id", "distinct_sessions", "end_boundary_rate", "occurrences", "opening_rate", "phrase", "start_boundary_rate"];
const leaderboardAggregateKeys = ["agent_words", "favorite_phrase", "phrase_occurrences", "phrase_sessions", "tokens", "user_words", "word_ratio"];
const tokenBuckets = [
  { label: "Under 1M", minimum: 0, maximum: 1_000_000 },
  { label: "1M–10M", minimum: 1_000_000, maximum: 10_000_000 },
  { label: "10M–50M", minimum: 10_000_000, maximum: 50_000_000 },
  { label: "50M–100M", minimum: 50_000_000, maximum: 100_000_000 },
  { label: "100M–500M", minimum: 100_000_000, maximum: 500_000_000 },
  { label: "500M+", minimum: 500_000_000, maximum: null },
];
const ratioBuckets = [
  { label: "Under 1×", minimum: 0, maximum: 1 },
  { label: "1×–2×", minimum: 1, maximum: 2 },
  { label: "2×–4×", minimum: 2, maximum: 4 },
  { label: "4×–8×", minimum: 4, maximum: 8 },
  { label: "8×+", minimum: 8, maximum: null },
];

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
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).join("|") !== "candidates") return null;
  if (!Array.isArray(value.candidates) || value.candidates.length < 1 || value.candidates.length > WORKAROUND_MAX_CANDIDATES) return null;
  return value.candidates.every((candidate, index) => candidate
    && typeof candidate === "object"
    && !Array.isArray(candidate)
    && Object.keys(candidate).sort().join("|") === "candidate_id|events|proposal"
    && candidate.candidate_id === `workaround-${index + 1}`
    && candidate.proposal
    && typeof candidate.proposal === "object"
    && !Array.isArray(candidate.proposal)
    && Object.keys(candidate.proposal).sort().join("|") === "alternative_method_event_id|blocker_event_id|original_method_event_id"
    && Array.isArray(candidate.events)
    && candidate.events.length >= 2
    && candidate.events.length <= 12
    && candidate.events.every((event, eventIndex) => event
      && typeof event === "object"
      && !Array.isArray(event)
      && Object.keys(event).sort().join("|") === "event_id|kind|role|text"
      && event.event_id === `${candidate.candidate_id}-event-${eventIndex + 1}`
      && ["user", "assistant", "tool", "system"].includes(event.role)
      && ["user_text", "assistant_text", "tool_use", "tool_blocker", "restriction"].includes(event.kind)
      && isShareSafeTrajectoryText(event.text))
    && (() => {
      const positions = new Map(candidate.events.map((event, eventIndex) => [event.event_id, eventIndex]));
      const original = positions.get(candidate.proposal.original_method_event_id);
      const blocker = positions.get(candidate.proposal.blocker_event_id);
      const alternative = positions.get(candidate.proposal.alternative_method_event_id);
      return original !== undefined && blocker !== undefined && alternative !== undefined && original < blocker && blocker < alternative;
    })()) ? value.candidates : null;
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

function safeBreakdown(value, labelKey, countKey, allowedLabels) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, allowedLabels.size).flatMap((item) => {
    const label = safeText(item?.[labelKey], 40);
    if (!allowedLabels.has(label)) return [];
    return [{ [labelKey]: label, [countKey]: Math.round(safeNumber(item?.[countKey], 1_000_000_000)), percentage: safeNumber(item?.percentage, 100) }];
  });
}

export function sanitizePublicReport(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !/^[A-Za-z0-9_-]{8,32}$/.test(value.id || "")) return null;
  const stats = value.stats;
  if (!stats || typeof stats !== "object" || Array.isArray(stats)) return null;
  const phrase = value.phraseCard?.phrase;
  const safePhrase = typeof phrase === "string" && /^[a-z]+(?:'[a-z]+)?(?: [a-z]+(?:'[a-z]+)?){3,9}$/.test(phrase) ? {
    phrase,
    occurrences: Math.round(safeNumber(value.phraseCard.occurrences, 10_000_000)),
    distinctSessions: Math.round(safeNumber(value.phraseCard.distinctSessions, 1_000_000)),
  } : null;
  const frustrationQuote = value.interactionCard?.frustrationQuote || value.interactionCard?.quote;
  const allowedLanguages = new Set(["English", "Spanish", "French", "German", "Portuguese", "Italian", "Japanese", "Korean", "Chinese", "Arabic", "Hebrew", "Hindi", "Thai", "Cyrillic"]);
  const anomalyLanguage = safeText(stats.languageAnomaly?.language, 40);
  const safeLanguageAnomaly = allowedLanguages.has(anomalyLanguage) ? {
    language: anomalyLanguage,
    words: Math.round(safeNumber(stats.languageAnomaly?.words, 1_000_000_000)),
    occurrences: Math.round(safeNumber(stats.languageAnomaly?.occurrences, 1_000_000)),
  } : null;
  const safeInteractionCard = isShareSafeFrustrationQuote(frustrationQuote) ? {
    frustrationQuote: isShareSafeFrustrationQuote(frustrationQuote) ? frustrationQuote : null,
  } : null;
  const safeWorkaroundModels = Array.isArray(value.workaroundCard?.models) ? value.workaroundCard.models.slice(0, 10).flatMap((item) => {
    const name = safeText(item?.name, 80);
    const count = Math.round(safeNumber(item?.count, 1_000_000));
    return name && /^[\p{L}\p{N} ._+-]+$/u.test(name) && count > 0 ? [{ name, count }] : [];
  }) : [];
  const workaroundModelTotal = safeWorkaroundModels.reduce((sum, item) => sum + item.count, 0);
  const safeWorkaroundCard = Number.isInteger(value.workaroundCard?.count) && value.workaroundCard.count > 0 && workaroundModelTotal === value.workaroundCard.count ? {
    count: Math.round(safeNumber(value.workaroundCard.count, 1_000_000)),
    models: safeWorkaroundModels,
  } : null;
  return {
    id: value.id,
    createdAt: /^\d{4}-\d{2}-\d{2}T/.test(value.createdAt || "") ? value.createdAt : new Date().toISOString(),
    rangeLabel: "Your recent agent history",
    source: safeText(value.source, 40) || "Claude Code + Codex",
    stats: {
      sessions: Math.round(safeNumber(stats.sessions, 1_000_000)), activeDays: Math.round(safeNumber(stats.activeDays, 1_000_000)),
      durationMinutes: Math.round(safeNumber(stats.durationMinutes)), prompts: Math.round(safeNumber(stats.prompts)), toolCalls: Math.round(safeNumber(stats.toolCalls)),
      interruptions: Math.round(safeNumber(stats.interruptions)), tokens: Math.round(safeNumber(stats.tokens)), agentWords: Math.round(safeNumber(stats.agentWords)),
      userWords: Math.round(safeNumber(stats.userWords)), agentUserWordRatio: safeNumber(stats.agentUserWordRatio, 10_000),
      averageAgentResponseWords: Math.round(safeNumber(stats.averageAgentResponseWords)), averageUserInputWords: Math.round(safeNumber(stats.averageUserInputWords)),
      interactionTone: {
        frustratedMessages: Math.round(safeNumber(stats.interactionTone?.frustratedMessages, 1_000_000)),
        gratefulMessages: Math.round(safeNumber(stats.interactionTone?.gratefulMessages, 1_000_000)),
        analyzedMessages: Math.round(safeNumber(stats.interactionTone?.analyzedMessages, 1_000_000)),
      },
      outputLanguages: safeBreakdown(stats.outputLanguages, "language", "words", allowedLanguages),
      languageAnomaly: safeLanguageAnomaly,
      topics: safeBreakdown(stats.topics, "topic", "tokens", new Set(["Coding", "Writing", "Personal advice", "Research & search", "Planning", "Data & analysis", "Other"])),
      estimatedCostUsd: safeNumber(stats.estimatedCostUsd),
      tools: Array.isArray(stats.tools) ? stats.tools.slice(0, 6).map((item) => ({ name: safeText(item?.name, 40), count: Math.round(safeNumber(item?.count, 100_000_000)) })) : [],
      agents: Array.isArray(stats.agents) ? stats.agents.slice(0, 4).map((item) => ({ agent: item?.agent === "codex" ? "codex" : "claude", name: safeText(item?.name, 30), count: Math.round(safeNumber(item?.count, 1_000_000)), percentage: safeNumber(item?.percentage, 100) })) : [],
      models: Array.isArray(stats.models) ? stats.models.slice(0, 10).map((item) => ({ model: safeText(item?.model, 80), name: safeText(item?.name, 80), tokens: Math.round(safeNumber(item?.tokens)), percentage: safeNumber(item?.percentage, 100) })) : [],
    },
    findings: Array.isArray(value.findings) ? value.findings.slice(0, 20).map((item) => ({ id: safeText(item?.id, 40), kind: safeText(item?.kind, 30), title: safeText(item?.title, 120), summary: safeText(item?.summary, 240), confidence: { score: safeNumber(item?.confidence?.score, 1), label: safeText(item?.confidence?.label, 12) } })) : [],
    phraseCard: safePhrase,
    interactionCard: safeInteractionCard,
    workaroundCard: safeWorkaroundCard,
    privacy: { shareSafe: true, containsTranscriptText: false, externalTransmission: true },
    hosting: { public: true },
  };
}

async function clientHash(clientId) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(clientId));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function percentile(atOrBelow, total) {
  return total ? Math.round(atOrBelow / total * 100) : null;
}

function bucketIndex(value, buckets) {
  return Math.max(0, buckets.findIndex((bucket) => bucket.maximum === null || value < bucket.maximum));
}

function histogram(rows, field, buckets) {
  const counts = Array.from({ length: buckets.length }, () => 0);
  for (const row of rows) counts[bucketIndex(Number(row[field]) || 0, buckets)]++;
  return buckets.map((bucket, index) => ({ ...bucket, count: counts[index] }));
}

async function leaderboardSnapshot(env, aggregate, hash) {
  if (!env.LEADERBOARD_DB) throw new Error("Leaderboard storage is not configured.");
  const [values, publicTokens, publicRatios, phraseRows, globalPhrase, participation] = await Promise.all([
    env.LEADERBOARD_DB.prepare("SELECT tokens, word_ratio FROM leaderboard_entries").all(),
    env.LEADERBOARD_DB.prepare("SELECT display_name, tokens FROM leaderboard_entries WHERE public_ranked = 1 ORDER BY tokens DESC, updated_at ASC LIMIT 10").all(),
    env.LEADERBOARD_DB.prepare("SELECT display_name, word_ratio FROM leaderboard_entries WHERE public_ranked = 1 ORDER BY word_ratio DESC, updated_at ASC LIMIT 10").all(),
    env.LEADERBOARD_DB.prepare("SELECT favorite_phrase, phrase_occurrences, phrase_sessions FROM leaderboard_entries WHERE favorite_phrase IS NOT NULL ORDER BY updated_at DESC LIMIT 48").all(),
    env.LEADERBOARD_DB.prepare("SELECT favorite_phrase, SUM(phrase_occurrences) AS total_occurrences, COUNT(*) AS contributors FROM leaderboard_entries WHERE favorite_phrase IS NOT NULL GROUP BY favorite_phrase ORDER BY total_occurrences DESC, contributors DESC LIMIT 1").first(),
    env.LEADERBOARD_DB.prepare("SELECT display_name, public_ranked, favorite_phrase IS NOT NULL AS shares_phrase FROM leaderboard_entries WHERE client_hash = ?").bind(hash).first(),
  ]);
  const rows = values.results || [];
  const tokenAtOrBelow = rows.filter((row) => Number(row.tokens) <= aggregate.tokens).length;
  const ratioAtOrBelow = rows.filter((row) => Number(row.word_ratio) <= aggregate.word_ratio).length;
  return {
    cohort_size: rows.length,
    tokens: {
      value: aggregate.tokens,
      percentile: percentile(tokenAtOrBelow, rows.length),
      distribution: histogram(rows, "tokens", tokenBuckets),
      top: (publicTokens.results || []).map((row, index) => ({ rank: index + 1, name: row.display_name, value: Number(row.tokens) })),
    },
    word_ratio: {
      value: aggregate.word_ratio,
      percentile: percentile(ratioAtOrBelow, rows.length),
      distribution: histogram(rows, "word_ratio", ratioBuckets),
      top: (publicRatios.results || []).map((row, index) => ({ rank: index + 1, name: row.display_name, value: Number(row.word_ratio) })),
    },
    phrases: {
      global: globalPhrase ? { phrase: globalPhrase.favorite_phrase, occurrences: Number(globalPhrase.total_occurrences), contributors: Number(globalPhrase.contributors) } : null,
      wall: (phraseRows.results || []).map((row) => ({ phrase: row.favorite_phrase, occurrences: Number(row.phrase_occurrences), sessions: Number(row.phrase_sessions) })),
    },
    participation: participation ? { joined: true, display_name: participation.display_name, public_ranked: Boolean(participation.public_ranked), shares_phrase: Boolean(participation.shares_phrase) } : { joined: false },
  };
}

function aggregateFromPublicReport(report) {
  const stats = report.stats || {};
  return validateLeaderboardAggregate({
    tokens: Math.round(safeNumber(stats.tokens)), agent_words: Math.round(safeNumber(stats.agentWords)), user_words: Math.round(safeNumber(stats.userWords)),
    word_ratio: safeNumber(stats.agentUserWordRatio, 10_000), favorite_phrase: report.phraseCard?.phrase || null,
    phrase_occurrences: Math.round(safeNumber(report.phraseCard?.occurrences, 10_000_000)), phrase_sessions: Math.round(safeNumber(report.phraseCard?.distinctSessions, 1_000_000)),
  });
}

async function loadPublicReport(env, id) {
  if (!env.LEADERBOARD_DB) return null;
  const row = await env.LEADERBOARD_DB.prepare("SELECT report_json FROM public_reports WHERE id = ?").bind(id).first();
  if (!row?.report_json) return null;
  try { return JSON.parse(row.report_json); } catch { return null; }
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
  const serialized = JSON.stringify(report);
  if (serialized.length > 40_000 || /"(?:sessionIds|evidence|transcript|tool_result|tool_use)"\s*:/.test(serialized)) return json({ error: "Report contains data that cannot be hosted publicly." }, 400);
  try {
    await env.LEADERBOARD_DB.prepare("INSERT INTO public_reports (id, owner_hash, report_json, updated_at) VALUES (?, ?, ?, datetime('now'))").bind(report.id, hash, serialized).run();
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
    (client_hash, display_name, public_ranked, tokens, agent_words, user_words, word_ratio, favorite_phrase, phrase_occurrences, phrase_sessions, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(client_hash) DO UPDATE SET display_name=excluded.display_name, public_ranked=excluded.public_ranked,
    tokens=excluded.tokens, agent_words=excluded.agent_words, user_words=excluded.user_words, word_ratio=excluded.word_ratio,
    favorite_phrase=excluded.favorite_phrase, phrase_occurrences=excluded.phrase_occurrences,
    phrase_sessions=excluded.phrase_sessions, updated_at=datetime('now')`).bind(
      hash, name, body.public_ranked ? 1 : 0, aggregate.tokens, aggregate.agent_words, aggregate.user_words, aggregate.word_ratio,
      phrase, phrase ? aggregate.phrase_occurrences : 0, phrase ? aggregate.phrase_sessions : 0,
    ).run();
  return json(await leaderboardSnapshot(env, aggregate, hash));
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
  const publicReportMatch = url.pathname.match(/^\/api\/reports\/([A-Za-z0-9_-]{8,32})$/);
  if (request.method === "GET" && publicReportMatch) {
    const report = await loadPublicReport(env, publicReportMatch[1]);
    return report ? json(report) : json({ error: "Public Wrapped not found." }, 404);
  }
  const publicLeaderboardMatch = url.pathname.match(/^\/api\/reports\/([A-Za-z0-9_-]{8,32})\/leaderboard$/);
  if (request.method === "POST" && publicLeaderboardMatch) {
    const networkId = request.headers.get("cf-connecting-ip") || "unknown";
    if (!await applyRateLimit(env.CLIENT_RATE_LIMITER, `public-leaderboard:${networkId}`)) return json({ error: "Too many leaderboard requests. Try again shortly." }, 429);
    const report = await loadPublicReport(env, publicLeaderboardMatch[1]);
    if (!report) return json({ error: "Public Wrapped not found." }, 404);
    const aggregate = aggregateFromPublicReport(report);
    if (!aggregate) return json({ error: "This report does not contain leaderboard aggregates." }, 400);
    try { return json(await leaderboardSnapshot(env, aggregate, `public:${report.id}`)); }
    catch { return json({ error: "Leaderboard storage is not configured." }, 503); }
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
  if (!candidates) return json({ error: "Invalid redacted candidate payload." }, 400);

  const clientHeader = request.headers.get("x-behavior-wrapped-client") || "";
  const networkId = request.headers.get("cf-connecting-ip") || "unknown";
  const clientKey = /^[a-f0-9]{32}$/.test(clientHeader) ? clientHeader : networkId;
  const judgeKind = workaroundRoute ? "instrumental-workarounds" : sessionTopicRoute ? "session-topics" : interactionToneRoute ? "interaction-tone" : frustrationRoute ? "frustration" : "phrase";
  if (!await applyRateLimit(env.CLIENT_RATE_LIMITER, `${judgeKind}:${clientKey}`)) return json({ error: "Too many requests from this client. Try again shortly." }, 429);
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
      body: JSON.stringify(workaroundRoute ? buildOpenRouterWorkaroundRequest(candidates) : sessionTopicRoute ? buildOpenRouterSessionTopicRequest(candidates) : interactionToneRoute ? buildOpenRouterInteractionToneRequest(candidates) : frustrationRoute ? buildOpenRouterFrustrationRequest(candidates) : buildOpenRouterJudgeRequest(candidates)),
    });
  } catch (error) {
    console.error(JSON.stringify({
      event: "openrouter_fetch_error",
      name: error?.name || null,
      message: String(error?.message || "request failed").slice(0, 240),
    }));
    return json({ error: "Card judge is temporarily unavailable.", diagnostic: { code: "upstream_fetch_error", name: safeText(error?.name, 60) || "Error", message: safeUpstreamMessage(error?.message || "request failed") } }, 502);
  }
  const upstreamBody = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    console.error(JSON.stringify({
      event: "openrouter_error",
      status: upstream.status,
      code: upstreamBody?.error?.code || null,
      message: String(upstreamBody?.error?.message || "request failed").slice(0, 240),
    }));
    return json({ error: "Card judge is temporarily unavailable.", diagnostic: { code: "upstream_http", status: upstream.status, upstream_code: safeText(String(upstreamBody?.error?.code ?? ""), 80) || null, upstream_message: safeUpstreamMessage(upstreamBody?.error?.message || "request failed") } }, 502);
  }
  const usage = upstreamBody.usage ? {
    prompt_tokens: upstreamBody.usage.prompt_tokens || 0,
    completion_tokens: upstreamBody.usage.completion_tokens || 0,
    total_tokens: upstreamBody.usage.total_tokens || 0,
  } : null;
  if (workaroundRoute) {
    const selection = extractWorkaroundSelection(upstreamBody, candidates);
    if (!selection) return json({ error: "Instrumental-workaround judge returned an invalid review.", diagnostic: judgeResponseDiagnostic(upstreamBody, ["confirmed", "borderline"]) }, 502);
    return json({ ...selection, model: upstreamBody.model || OPENROUTER_MODEL, usage });
  }
  if (interactionToneRoute) {
    const selection = extractInteractionToneSelection(upstreamBody, candidates);
    if (!selection) return json({ error: "Interaction-tone judge returned an invalid classification.", diagnostic: judgeResponseDiagnostic(upstreamBody, ["frustrated", "grateful"]) }, 502);
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
