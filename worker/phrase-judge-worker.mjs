import { buildOpenRouterJudgeRequest, extractCandidateId, OPENROUTER_MODEL } from "../server/phrase-card.mjs";
import { buildOpenRouterFrustrationRequest, isShareSafeFrustrationQuote } from "../server/frustration-card.mjs";
import { buildOpenRouterInteractionToneRequest, extractInteractionToneSelection, interactionToneBatches, INTERACTION_TONE_MAX_CANDIDATES, isShareSafeInteractionText, mergeInteractionToneSelections, restoreInteractionToneIds } from "../server/interaction-tone.mjs";
import { buildOpenRouterSessionTopicRequest, extractSessionTopicSelection, isShareSafeTopicMessage, SESSION_TOPIC_MAX_CANDIDATES } from "../server/session-topics.mjs";
import { buildOpenRouterWorkaroundRequest, extractWorkaroundSelection, validateWorkaroundChunks } from "../server/instrumental-workarounds.mjs";
import { BEHAVIOR_WRAPPED_HOST, BEHAVIOR_WRAPPED_WWW_HOST, LEGACY_BEHAVIOR_WRAPPED_HOST } from "../server/origins.mjs";
import { sanitizePublicReport } from "../server/public-report-schema.mjs";
import { MAX_ENCRYPTED_DONATION_BYTES, sanitizeEncryptedDonationEnvelope } from "../server/encrypted-donation-schema.mjs";
export { sanitizePublicReport } from "../server/public-report-schema.mjs";

const MAX_BODY_BYTES = 256_000;
const MAX_CANDIDATES = 100;
const JUDGE_ATTEMPTS = 2;
const ZULIP_NOTIFICATION_TIMEOUT_MS = 5_000;
const candidateKeys = ["candidate_id", "distinct_sessions", "end_boundary_rate", "occurrences", "opening_rate", "phrase", "start_boundary_rate"];
const leaderboardAggregateKeys = ["agent_words", "favorite_phrase", "frustrated_messages", "grateful_messages", "instrumental_workarounds", "instrumental_workarounds_by_model", "phrase_occurrences", "phrase_sessions", "session_turn_counts", "tokens", "user_words", "word_ratio"];

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

function zulipConfiguration(env) {
  const site = safeText(env.ZULIP_SITE, 200).replace(/\/$/, "");
  const email = safeText(env.ZULIP_BOT_EMAIL, 200);
  const apiKey = typeof env.ZULIP_BOT_API_KEY === "string" ? env.ZULIP_BOT_API_KEY : "";
  const channel = safeText(env.ZULIP_CHANNEL, 80);
  if (!/^https:\/\/[^/]+$/.test(site) || !email.includes("@") || !apiKey || !channel) return null;
  return { site, email, apiKey, channel };
}

export async function sendZulipNotification(env, topic, content, fetchImpl = fetch) {
  const configuration = zulipConfiguration(env);
  if (!configuration) return { sent: false, reason: "not_configured" };
  const body = new URLSearchParams({ type: "stream", to: configuration.channel, topic, content });
  let response;
  try {
    response = await fetchImpl(`${configuration.site}/api/v1/messages`, {
      method: "POST",
      headers: {
        authorization: `Basic ${btoa(`${configuration.email}:${configuration.apiKey}`)}`,
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        "user-agent": "BehaviorWrappedMonitor/1.0",
      },
      body: body.toString(),
      signal: AbortSignal.timeout(ZULIP_NOTIFICATION_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(`Zulip notification request failed: ${safeText(error?.name || "network_error", 40)}`);
  }
  if (!response.ok) throw new Error(`Zulip notification returned HTTP ${response.status}`);
  return { sent: true };
}

export function wrappedCreatedNotification(report) {
  const sessions = Math.round(safeNumber(report?.stats?.sessions, 1_000_000));
  const activeDays = Math.round(safeNumber(report?.stats?.activeDays, 100_000));
  return `**Wrapped created**\n\n- Sessions analyzed: **${sessions.toLocaleString("en-US")}**\n- Active days: **${activeDays.toLocaleString("en-US")}**`;
}

export function donationAcceptedNotification(donation) {
  const metadata = donation?.metadata || {};
  const sessions = Math.round(safeNumber(metadata.sessions, 1_000_000));
  const messages = Math.round(safeNumber(metadata.messages, 10_000_000));
  const detections = Math.round(safeNumber(metadata.automatedDetections, 10_000_000));
  const mode = new Set(["standard", "advanced", "unredacted"]).has(metadata.redactionMode) ? metadata.redactionMode : "unknown";
  return `**Encrypted research donation accepted**\n\n- Sessions: **${sessions.toLocaleString("en-US")}**\n- Messages: **${messages.toLocaleString("en-US")}**\n- Redaction mode: \`${mode}\`\n- Automated detections: **${detections.toLocaleString("en-US")}**`;
}

function scheduleZulipNotification(context, env, topic, content, fetchImpl) {
  if (!zulipConfiguration(env) || !context?.waitUntil) return;
  context.waitUntil(sendZulipNotification(env, topic, content, fetchImpl).catch((error) => {
    console.error(JSON.stringify({ event: "zulip_notification_failed", topic, message: safeText(error?.message, 120) }));
  }));
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
  aggregate.session_turn_counts = aggregate.session_turn_counts === undefined ? [] : aggregate.session_turn_counts;
  if (!Number.isInteger(aggregate.tokens) || !finiteBetween(aggregate.tokens, 0, 10_000_000_000_000)) return null;
  if (!Number.isInteger(aggregate.agent_words) || !finiteBetween(aggregate.agent_words, 0, 10_000_000_000)) return null;
  if (!Number.isInteger(aggregate.user_words) || !finiteBetween(aggregate.user_words, 0, 10_000_000_000)) return null;
  if (!finiteBetween(aggregate.word_ratio, 0, 10_000)) return null;
  if (!Number.isInteger(aggregate.grateful_messages) || !finiteBetween(aggregate.grateful_messages, 0, 1_000_000)) return null;
  if (!Number.isInteger(aggregate.frustrated_messages) || !finiteBetween(aggregate.frustrated_messages, 0, 1_000_000)) return null;
  if (!Number.isInteger(aggregate.instrumental_workarounds) || !finiteBetween(aggregate.instrumental_workarounds, 0, 1_000_000)) return null;
  if (aggregate.instrumental_workarounds_by_model !== undefined) {
    if (!Array.isArray(aggregate.instrumental_workarounds_by_model) || aggregate.instrumental_workarounds_by_model.length > 20) return null;
    const seenModels = new Set();
    const normalizedModels = [];
    let modelTotal = 0;
    for (const item of aggregate.instrumental_workarounds_by_model) {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const model = typeof item.model === "string" ? item.model.normalize("NFKC").trim() : "";
      if (!/^[\p{L}\p{N} ._+-]{1,80}$/u.test(model) || seenModels.has(model) || !Number.isInteger(item.count) || !finiteBetween(item.count, 1, 1_000_000)) return null;
      seenModels.add(model);
      normalizedModels.push({ model, count: item.count });
      modelTotal += item.count;
    }
    if (aggregate.instrumental_workarounds_by_model.length && modelTotal !== aggregate.instrumental_workarounds) return null;
    aggregate.instrumental_workarounds_by_model = normalizedModels;
  } else {
    delete aggregate.instrumental_workarounds_by_model;
  }
  if (aggregate.favorite_phrase !== null && (typeof aggregate.favorite_phrase !== "string" || !/^[a-z]+(?:'[a-z]+)?(?: [a-z]+(?:'[a-z]+)?){3,9}$/.test(aggregate.favorite_phrase))) return null;
  if (!Number.isInteger(aggregate.phrase_occurrences) || !finiteBetween(aggregate.phrase_occurrences, 0, 10_000_000)) return null;
  if (!Number.isInteger(aggregate.phrase_sessions) || !finiteBetween(aggregate.phrase_sessions, 0, aggregate.phrase_occurrences)) return null;
  if (!Array.isArray(aggregate.session_turn_counts) || aggregate.session_turn_counts.length > 2_000 || aggregate.session_turn_counts.some((turns) => !Number.isInteger(turns) || !finiteBetween(turns, 1, 1_000_000))) return null;
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

function median(values) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function goodHumanScore(value) {
  const grateful = Number(value.grateful_messages) || 0;
  const frustrated = Number(value.frustrated_messages) || 0;
  return grateful + frustrated ? Number((grateful / (grateful + frustrated) * 100).toFixed(1)) : null;
}

function storedSessionTurnCounts(value) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.slice(0, 2_000).filter((turns) => Number.isInteger(turns) && finiteBetween(turns, 1, 1_000_000)) : [];
  } catch { return []; }
}

async function leaderboardSnapshot(env, aggregate, hash) {
  if (!env.LEADERBOARD_DB) throw new Error("Leaderboard storage is not configured.");
  const [values, participation, modelTotals] = await Promise.all([
    env.LEADERBOARD_DB.prepare("SELECT rowid AS participant_id, tokens, word_ratio, grateful_messages, frustrated_messages, instrumental_workarounds, favorite_phrase, phrase_occurrences, phrase_sessions, session_turn_counts FROM leaderboard_entries ORDER BY rowid").all(),
    hash ? env.LEADERBOARD_DB.prepare("SELECT rowid AS participant_id, display_name, public_ranked, favorite_phrase IS NOT NULL AS shares_phrase FROM leaderboard_entries WHERE client_hash = ?").bind(hash).first() : Promise.resolve(null),
    env.LEADERBOARD_DB.prepare("SELECT model, SUM(detected_instances) AS detected_instances FROM leaderboard_model_workarounds GROUP BY model ORDER BY detected_instances DESC, model ASC LIMIT 50").all(),
  ]);
  const rows = values.results || [];
  const cohortScores = rows.map(goodHumanScore).filter((value) => value !== null);
  const publicView = !aggregate;
  const tokenValue = publicView ? median(rows.map((row) => row.tokens)) : aggregate.tokens;
  const ratioValue = publicView ? median(rows.map((row) => row.word_ratio)) : aggregate.word_ratio;
  const score = publicView ? (cohortScores.length ? median(cohortScores) : null) : goodHumanScore(aggregate);
  const workaroundValue = publicView ? median(rows.map((row) => row.instrumental_workarounds)) : aggregate.instrumental_workarounds;
  const tokenAtOrBelow = rows.filter((row) => Number(row.tokens) <= tokenValue).length;
  const ratioAtOrBelow = rows.filter((row) => Number(row.word_ratio) <= ratioValue).length;
  const scoreAtOrBelow = score === null ? 0 : cohortScores.filter((value) => value <= score).length;
  const workaroundAtOrBelow = rows.filter((row) => Number(row.instrumental_workarounds) <= workaroundValue).length;
  return {
    public_view: publicView,
    cohort_size: rows.length,
    tokens: {
      value: tokenValue,
      percentile: publicView ? null : percentile(tokenAtOrBelow, rows.length),
      samples: rows.map((row) => ({ participant_id: Number(row.participant_id), value: Number(row.tokens) })),
    },
    word_ratio: {
      value: ratioValue,
      percentile: publicView ? null : percentile(ratioAtOrBelow, rows.length),
    },
    good_human_score: {
      value: score,
      percentile: publicView || score === null ? null : percentile(scoreAtOrBelow, cohortScores.length),
    },
    relationship: {
      points: rows.map((row) => ({ participant_id: Number(row.participant_id), yap_ratio: Number(row.word_ratio), appreciation_index: goodHumanScore(row) }))
        .filter((point) => point.appreciation_index !== null),
    },
    instrumental_workarounds: {
      value: workaroundValue,
      percentile: publicView ? null : percentile(workaroundAtOrBelow, rows.length),
      samples: rows.map((row) => ({ participant_id: Number(row.participant_id), value: Number(row.instrumental_workarounds) })),
      by_model: (modelTotals.results || []).map((row) => ({ model: String(row.model), count: Number(row.detected_instances) })),
    },
    session_lengths: {
      values: publicView ? [] : aggregate.session_turn_counts,
      samples: rows.flatMap((row) => storedSessionTurnCounts(row.session_turn_counts).map((value, sessionIndex) => ({ participant_id: Number(row.participant_id), session_index: sessionIndex, value }))),
    },
    phrases: {
      entries: rows.flatMap((row) => typeof row.favorite_phrase === "string" && /^[a-z]+(?:'[a-z]+)?(?: [a-z]+(?:'[a-z]+)?){3,9}$/.test(row.favorite_phrase)
        ? [{ participant_id: Number(row.participant_id), phrase: row.favorite_phrase, occurrences: Math.round(safeNumber(row.phrase_occurrences, 10_000_000)), sessions: Math.round(safeNumber(row.phrase_sessions, 1_000_000)) }]
        : []).slice(-200).reverse(),
    },
    participation: participation ? { joined: true, participant_id: Number(participation.participant_id), display_name: participation.display_name, public_ranked: Boolean(participation.public_ranked), shares_phrase: Boolean(participation.shares_phrase) } : { joined: false },
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
    instrumental_workarounds_by_model: Array.isArray(report.workaroundCard?.models) ? report.workaroundCard.models.map((item) => ({ model: item.name, count: item.count })) : [],
    phrase_occurrences: Math.round(safeNumber(report.phraseCard?.occurrences, 10_000_000)), phrase_sessions: Math.round(safeNumber(report.phraseCard?.distinctSessions, 1_000_000)),
    session_turn_counts: Array.isArray(stats.sessionTurnCounts) ? stats.sessionTurnCounts : [],
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

async function leaderboardOptedOut(env, hash) {
  return Boolean(await env.LEADERBOARD_DB.prepare("SELECT client_hash FROM leaderboard_opt_outs WHERE client_hash = ?").bind(hash).first());
}

async function upsertAnonymousLeaderboardEntry(env, hash, aggregate) {
  await env.LEADERBOARD_DB.prepare(`INSERT INTO leaderboard_entries
    (client_hash, display_name, public_ranked, tokens, agent_words, user_words, word_ratio, grateful_messages, frustrated_messages, instrumental_workarounds, favorite_phrase, phrase_occurrences, phrase_sessions, session_turn_counts, updated_at)
    VALUES (?, 'Anonymous', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(client_hash) DO UPDATE SET display_name='Anonymous', public_ranked=0,
    tokens=excluded.tokens, agent_words=excluded.agent_words, user_words=excluded.user_words, word_ratio=excluded.word_ratio,
    grateful_messages=excluded.grateful_messages, frustrated_messages=excluded.frustrated_messages, instrumental_workarounds=excluded.instrumental_workarounds,
    favorite_phrase=excluded.favorite_phrase, phrase_occurrences=excluded.phrase_occurrences, phrase_sessions=excluded.phrase_sessions,
    session_turn_counts=excluded.session_turn_counts, updated_at=datetime('now')`).bind(
      hash, aggregate.tokens, aggregate.agent_words, aggregate.user_words, aggregate.word_ratio,
      aggregate.grateful_messages, aggregate.frustrated_messages, aggregate.instrumental_workarounds,
      aggregate.favorite_phrase, aggregate.favorite_phrase ? aggregate.phrase_occurrences : 0,
      aggregate.favorite_phrase ? aggregate.phrase_sessions : 0, JSON.stringify(aggregate.session_turn_counts),
    ).run();
  await replaceLeaderboardModelWorkarounds(env, hash, aggregate.instrumental_workarounds_by_model);
}

async function replaceLeaderboardModelWorkarounds(env, hash, models) {
  if (!Array.isArray(models)) return;
  await env.LEADERBOARD_DB.prepare("DELETE FROM leaderboard_model_workarounds WHERE client_hash = ?").bind(hash).run();
  for (const item of models) {
    await env.LEADERBOARD_DB.prepare("INSERT INTO leaderboard_model_workarounds (client_hash, model, detected_instances, updated_at) VALUES (?, ?, ?, datetime('now'))").bind(hash, item.model, item.count).run();
  }
}

async function handlePublicReports(request, env, fetchImpl, context) {
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
  const aggregate = aggregateFromPublicReport(report);
  if (aggregate && !await leaderboardOptedOut(env, hash)) await upsertAnonymousLeaderboardEntry(env, hash, aggregate);
  const origin = new URL(request.url).origin;
  scheduleZulipNotification(context, env, "app usage", wrappedCreatedNotification(report), fetchImpl);
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
    await env.LEADERBOARD_DB.prepare("DELETE FROM leaderboard_model_workarounds WHERE client_hash = ?").bind(hash).run();
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
    (client_hash, display_name, public_ranked, tokens, agent_words, user_words, word_ratio, grateful_messages, frustrated_messages, instrumental_workarounds, favorite_phrase, phrase_occurrences, phrase_sessions, session_turn_counts, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(client_hash) DO UPDATE SET display_name=excluded.display_name, public_ranked=excluded.public_ranked,
    tokens=excluded.tokens, agent_words=excluded.agent_words, user_words=excluded.user_words, word_ratio=excluded.word_ratio,
    grateful_messages=excluded.grateful_messages, frustrated_messages=excluded.frustrated_messages, instrumental_workarounds=excluded.instrumental_workarounds,
    favorite_phrase=excluded.favorite_phrase, phrase_occurrences=excluded.phrase_occurrences,
    phrase_sessions=excluded.phrase_sessions, session_turn_counts=excluded.session_turn_counts, updated_at=datetime('now')`).bind(
      hash, name, body.public_ranked ? 1 : 0, aggregate.tokens, aggregate.agent_words, aggregate.user_words, aggregate.word_ratio,
      aggregate.grateful_messages, aggregate.frustrated_messages, aggregate.instrumental_workarounds,
      phrase, phrase ? aggregate.phrase_occurrences : 0, phrase ? aggregate.phrase_sessions : 0, JSON.stringify(aggregate.session_turn_counts),
    ).run();
  await replaceLeaderboardModelWorkarounds(env, hash, aggregate.instrumental_workarounds_by_model);
  return json(await leaderboardSnapshot(env, aggregate, hash));
}

async function handlePublicLeaderboard(request, env, id) {
  if (!env.LEADERBOARD_DB) return json({ error: "Leaderboard storage is not configured." }, 503);
  const record = await loadPublicReportRecord(env, id);
  if (!record) return json({ error: "Public Wrapped not found." }, 404);
  const aggregate = aggregateFromPublicReport(record.report);
  if (!aggregate) return json({ error: "This report does not contain leaderboard aggregates." }, 400);
  const canManage = await canManagePublicReport(request, record);
  if (!canManage) return json({ error: "Only the creator of this Wrapped can open its comparison." }, 403);

  if (request.method === "DELETE") {
    await env.LEADERBOARD_DB.prepare("INSERT INTO leaderboard_opt_outs (client_hash, opted_out_at) VALUES (?, datetime('now')) ON CONFLICT(client_hash) DO UPDATE SET opted_out_at=datetime('now')").bind(record.owner_hash).run();
    await env.LEADERBOARD_DB.prepare("DELETE FROM leaderboard_entries WHERE client_hash = ?").bind(record.owner_hash).run();
    await env.LEADERBOARD_DB.prepare("DELETE FROM leaderboard_model_workarounds WHERE client_hash = ?").bind(record.owner_hash).run();
    return json({ removed: true });
  }
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const raw = await readLimitedBody(request);
  if (raw === null) return json({ error: "Request too large." }, 413);
  let body;
  try { body = JSON.parse(raw); } catch { return json({ error: "Invalid JSON." }, 400); }
  let optedOut = await leaderboardOptedOut(env, record.owner_hash);
  if (body.action === "include" || body.action === "join") {
    await env.LEADERBOARD_DB.prepare("DELETE FROM leaderboard_opt_outs WHERE client_hash = ?").bind(record.owner_hash).run();
    await upsertAnonymousLeaderboardEntry(env, record.owner_hash, aggregate);
    optedOut = false;
  } else if (body.action !== "snapshot") {
    return json({ error: "Invalid leaderboard action." }, 400);
  }
  if (!optedOut) await upsertAnonymousLeaderboardEntry(env, record.owner_hash, aggregate);
  try { return json({ ...await leaderboardSnapshot(env, aggregate, record.owner_hash), can_manage: canManage, opted_out: optedOut }); }
  catch { return json({ error: "Leaderboard storage is not configured." }, 503); }
}

async function handleResearchDonation(request, env, fetchImpl, context) {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!env.RESEARCH_DB || !env.RESEARCH_DONATIONS) return json({ error: "Research donation storage is not configured." }, 503);
  const clientId = request.headers.get("x-behavior-wrapped-client") || "";
  if (!/^[a-f0-9]{32}$/.test(clientId)) return json({ error: "A valid local client ID is required." }, 400);
  if (!await applyRateLimit(env.CORPUS_RATE_LIMITER || env.CLIENT_RATE_LIMITER, `research-donation:${clientId}`)) return json({ error: "Too many donation requests. Try again shortly." }, 429);
  const raw = await readLimitedBody(request, MAX_ENCRYPTED_DONATION_BYTES);
  if (raw === null) return json({ error: "Research donation is too large." }, 413);
  let body;
  try { body = JSON.parse(raw); } catch { return json({ error: "Invalid JSON." }, 400); }
  const donation = sanitizeEncryptedDonationEnvelope(body?.encryptedDonation);
  if (!donation) return json({ error: "Invalid encrypted research donation." }, 400);
  const id = crypto.randomUUID();
  const ownerHash = await clientHash(clientId);
  const deletionToken = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  const deletionTokenHash = await sha256Hex(deletionToken);
  const objectKey = `donations/${donation.metadata.createdAt.slice(0, 7)}/${id}.json`;
  const serialized = JSON.stringify(donation);
  const objectBytes = new TextEncoder().encode(serialized).byteLength;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(donation.ciphertext));
  const ciphertextSha256 = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  try {
    await env.RESEARCH_DONATIONS.put(objectKey, serialized, {
      httpMetadata: { contentType: "application/json" },
      customMetadata: { donationId: id, encryptionKeyId: donation.encryption.keyId },
    });
  } catch { return json({ error: "Encrypted research storage is temporarily unavailable." }, 503); }
  try {
    await env.RESEARCH_DB.prepare(`INSERT INTO research_donations
      (id, owner_hash, deletion_token_hash, report_id, object_key, encryption_key_id, encryption_algorithm, ciphertext_sha256,
       object_bytes, redaction_mode, unredacted_data, automated_detections, session_count, message_count,
       consent_version, consented_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        id, ownerHash, deletionTokenHash, donation.metadata.reportId, objectKey, donation.encryption.keyId, donation.encryption.algorithm,
        ciphertextSha256, objectBytes, donation.metadata.redactionMode, donation.metadata.unredactedData ? 1 : 0,
        donation.metadata.automatedDetections, donation.metadata.sessions, donation.metadata.messages,
        donation.metadata.consentVersion, donation.metadata.consentedAt, donation.metadata.createdAt,
      ).run();
  } catch {
    await env.RESEARCH_DONATIONS.delete(objectKey).catch(() => {});
    return json({ error: "Research donation metadata storage is temporarily unavailable." }, 503);
  }
  scheduleZulipNotification(context, env, "data donations", donationAcceptedNotification(donation), fetchImpl);
  return json({ accepted: true, donation_id: id, deletion_token: deletionToken, encrypted: true }, 201);
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function deleteResearchDonation(request, env, id) {
  if (!env.RESEARCH_DB || !env.RESEARCH_DONATIONS) return json({ error: "Research donation storage is not configured." }, 503);
  const networkId = request.headers.get("cf-connecting-ip") || "unknown";
  if (!await applyRateLimit(env.CLIENT_RATE_LIMITER, `research-deletion:${networkId}`)) return json({ error: "Too many deletion requests. Try again shortly." }, 429);
  const token = request.headers.get("x-behavior-wrapped-deletion-token") || "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return json({ error: "A valid deletion token is required." }, 400);
  const record = await env.RESEARCH_DB.prepare("SELECT object_key FROM research_donations WHERE id = ? AND deletion_token_hash = ?").bind(id, await sha256Hex(token)).first();
  if (!record?.object_key) return json({ error: "Donation not found." }, 404);
  try { await env.RESEARCH_DONATIONS.delete(record.object_key); }
  catch { return json({ error: "Encrypted research storage is temporarily unavailable." }, 503); }
  await env.RESEARCH_DB.prepare("DELETE FROM research_donations WHERE id = ?").bind(id).run();
  return json({ deleted: true });
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
  const routedRequestBody = {
    ...requestBody,
    provider: {
      ...(requestBody.provider || {}),
      order: ["Azure"],
      allow_fallbacks: false,
    },
  };
  let upstream;
  try {
    upstream = await fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        "x-title": "Behavior Wrapped",
      },
      body: JSON.stringify(routedRequestBody),
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
  for (let attempt = 0; attempt < JUDGE_ATTEMPTS; attempt++) {
    const result = await requestOpenRouter(env, fetchImpl, buildOpenRouterInteractionToneRequest(batch.local));
    if (result.errorResponse) {
      if (attempt + 1 < JUDGE_ATTEMPTS && result.retryable) continue;
      return result;
    }
    lastBody = result.body;
    const selection = extractInteractionToneSelection(result.body, batch.local);
    if (selection) return { body: result.body, selection: restoreInteractionToneIds(selection, batch) };
    console.error(JSON.stringify({
      event: "openrouter_invalid_response",
      judge: "interaction-tone",
      attempt: attempt + 1,
      diagnostic: judgeResponseDiagnostic(result.body, ["classifications"]),
    }));
  }
  return { body: lastBody, selection: null };
}

function judgeSelection(judgeKind, body, candidates) {
  if (judgeKind === "instrumental-workarounds") return extractWorkaroundSelection(body, candidates);
  if (judgeKind === "session-topics") return extractSessionTopicSelection(body, candidates);
  return extractCandidateId(body, candidates);
}

function judgeDiagnostic(judgeKind, body) {
  if (judgeKind === "instrumental-workarounds") return judgeResponseDiagnostic(body, ["verdicts"]);
  if (judgeKind === "session-topics") return judgeResponseDiagnostic(body, ["classifications"]);
  return judgeResponseDiagnostic(body, []);
}

function invalidJudgeError(judgeKind) {
  if (judgeKind === "instrumental-workarounds") return "Instrumental-workaround judge returned an invalid review.";
  if (judgeKind === "session-topics") return "Session-topic judge returned an invalid classification.";
  return "Card judge returned an invalid selection.";
}

function isHostedAppPath(pathname) {
  return pathname === "/" || pathname === "/leaderboard" || /^\/(?:w|leaderboard|donate)\/[A-Za-z0-9_-]{8,32}$/.test(pathname);
}

function isUnlistedAppPath(pathname) {
  return /^\/(?:w|leaderboard|donate)\/[A-Za-z0-9_-]{8,32}$/.test(pathname);
}

export async function handleRequest(request, env, fetchImpl = fetch, context) {
  const url = new URL(request.url);
  if (url.pathname === "/data-policy" && new Set(["GET", "HEAD"]).has(request.method)) {
    return Response.redirect("https://susancalvin.org/data-policy", 308);
  }
  const hostedAppPath = isHostedAppPath(url.pathname);
  if (hostedAppPath && new Set(["GET", "HEAD"]).has(request.method)
    && (url.hostname === LEGACY_BEHAVIOR_WRAPPED_HOST || url.hostname === BEHAVIOR_WRAPPED_WWW_HOST)) {
    url.protocol = "https:";
    url.host = BEHAVIOR_WRAPPED_HOST;
    return Response.redirect(url.toString(), 308);
  }
  if (request.method === "GET" && url.pathname === "/health") return json({ service: "behavior-wrapped-phrase-judge", healthy: true });
  if (request.method === "GET" && url.pathname === "/api/leaderboard") {
    const networkId = request.headers.get("cf-connecting-ip") || "unknown";
    if (!await applyRateLimit(env.CLIENT_RATE_LIMITER, `public-leaderboard:${networkId}`)) return json({ error: "Too many leaderboard requests. Try again shortly." }, 429);
    try { return json(await leaderboardSnapshot(env, null, null)); }
    catch { return json({ error: "Leaderboard storage is not configured." }, 503); }
  }
  const publicReportMatch = url.pathname.match(/^\/api\/reports\/([A-Za-z0-9_-]{8,32})$/);
  if (request.method === "GET" && publicReportMatch) {
    const report = await loadPublicReport(env, publicReportMatch[1]);
    return report ? json(report) : json({ error: "Public Wrapped not found." }, 404);
  }
  if (url.pathname === "/v1/research-donations") {
    if (request.headers.get("x-behavior-wrapped-protocol") !== "2") return json({ error: "Update Behavior Wrapped before donating; encrypted donation protocol 2 is required." }, 426);
    return handleResearchDonation(request, env, fetchImpl, context);
  }
  const researchDonationMatch = url.pathname.match(/^\/v1\/research-donations\/([0-9a-f-]{36})$/);
  if (researchDonationMatch && request.method === "DELETE") {
    if (request.headers.get("x-behavior-wrapped-protocol") !== "2") return json({ error: "Unsupported client protocol." }, 400);
    return deleteResearchDonation(request, env, researchDonationMatch[1]);
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
    return handlePublicReports(request, env, fetchImpl, context);
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
  if (url.pathname !== "/v1/phrase-card" && !frustrationRoute && !interactionToneRoute && !sessionTopicRoute && !workaroundRoute) {
    if (hostedAppPath && new Set(["GET", "HEAD"]).has(request.method) && env.ASSETS?.fetch) {
      const response = await env.ASSETS.fetch(request);
      if (!isUnlistedAppPath(url.pathname)) return response;
      const headers = new Headers(response.headers);
      headers.set("x-robots-tag", "noindex, nofollow");
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }
    return json({ error: "Not found." }, 404);
  }
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
    return json(responseBody);
  }

  const requestBody = workaroundRoute ? buildOpenRouterWorkaroundRequest(candidates) : sessionTopicRoute ? buildOpenRouterSessionTopicRequest(candidates) : frustrationRoute ? buildOpenRouterFrustrationRequest(candidates) : buildOpenRouterJudgeRequest(candidates);
  let upstreamBody = {};
  let selection = null;
  for (let attempt = 0; attempt < JUDGE_ATTEMPTS; attempt++) {
    const upstreamResult = await requestOpenRouter(env, fetchImpl, requestBody);
    if (upstreamResult.errorResponse) {
      if (attempt + 1 < JUDGE_ATTEMPTS && upstreamResult.retryable) continue;
      return upstreamResult.errorResponse;
    }
    upstreamBody = upstreamResult.body;
    selection = judgeSelection(judgeKind, upstreamBody, candidates);
    if (selection) break;
    console.error(JSON.stringify({
      event: "openrouter_invalid_response",
      judge: judgeKind,
      attempt: attempt + 1,
      diagnostic: judgeDiagnostic(judgeKind, upstreamBody),
    }));
  }
  if (!selection) return json({ error: invalidJudgeError(judgeKind), diagnostic: judgeDiagnostic(judgeKind, upstreamBody) }, 502);
  const usage = upstreamBody.usage ? {
    prompt_tokens: upstreamBody.usage.prompt_tokens || 0,
    completion_tokens: upstreamBody.usage.completion_tokens || 0,
    total_tokens: upstreamBody.usage.total_tokens || 0,
  } : null;
  if (workaroundRoute) {
    return json({ ...selection, model: upstreamBody.model || OPENROUTER_MODEL, usage });
  }
  if (sessionTopicRoute) {
    return json({ ...selection, model: upstreamBody.model || OPENROUTER_MODEL, usage });
  }
  return json({
    candidate_id: selection,
    model: upstreamBody.model || OPENROUTER_MODEL,
    usage,
  });
}

export default {
  fetch(request, env, context) {
    return handleRequest(request, env, fetch, context);
  },
};
