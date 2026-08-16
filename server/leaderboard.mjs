import { BEHAVIOR_WRAPPED_ORIGIN } from "./origins.mjs";
export const LEADERBOARD_RELAY_ORIGIN = BEHAVIOR_WRAPPED_ORIGIN;
const REQUEST_TIMEOUT_MS = 15_000;
const demoTokens = [820_000, 2_400_000, 8_900_000, 14_300_000, 31_000_000, 47_500_000, 83_000_000, 126_000_000, 210_000_000, 380_000_000, 620_000_000, 940_000_000];
const demoRatios = [0.8, 1.2, 1.7, 2.1, 2.8, 3.4, 4.2, 5.1, 6.7, 8.4, 11.2, 14.6];
const demoGoodHumanScores = [12.5, 25, 33.3, 40, 50, 57.1, 66.7, 72.7, 80, 87.5, 94.1, 100];
const demoWorkarounds = [0, 0, 1, 1, 2, 2, 3, 4, 5, 7, 9, 14];
const demoSessionTurnCounts = [[2, 4, 8], [3, 12, 21], [5, 17], [7, 35, 66], [9, 14, 93], [11, 45], [16, 28, 120], [22, 73], [31, 180], [48, 310], [82, 620], [140, 1_240]];

function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function sessionTurnCounts(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 2_000).flatMap((item) => {
    const turns = Number(item);
    return Number.isInteger(turns) && turns >= 1 && turns <= 1_000_000 ? [turns] : [];
  });
}

function workaroundModelCounts(value, total) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const models = value.slice(0, 20).flatMap((item) => {
    const model = typeof item?.name === "string" ? item.name.normalize("NFKC").trim() : "";
    const count = Number(item?.count);
    if (!model || !/^[\p{L}\p{N} ._+-]{1,80}$/u.test(model) || seen.has(model) || !Number.isInteger(count) || count <= 0 || count > 1_000_000) return [];
    seen.add(model);
    return [{ model, count }];
  });
  return models.reduce((sum, item) => sum + item.count, 0) === total ? models.sort((left, right) => right.count - left.count || left.model.localeCompare(right.model)) : [];
}

export function leaderboardAggregateFromReport(report) {
  const stats = report?.stats || {};
  const agentWords = finiteNonNegative(stats.agentWords);
  const userWords = finiteNonNegative(stats.userWords);
  const fallbackRatio = finiteNonNegative(stats.averageUserInputWords)
    ? finiteNonNegative(stats.averageAgentResponseWords) / finiteNonNegative(stats.averageUserInputWords)
    : 0;
  const ratio = userWords ? agentWords / userWords : finiteNonNegative(stats.agentUserWordRatio) || fallbackRatio;
  const phrase = report?.phraseCard?.phrase;
  const instrumentalWorkarounds = Math.round(finiteNonNegative(report?.workaroundCard?.count));
  return {
    tokens: Math.round(finiteNonNegative(stats.tokens)),
    agent_words: Math.round(agentWords),
    user_words: Math.round(userWords),
    word_ratio: Number(Math.min(ratio, 10_000).toFixed(2)),
    grateful_messages: Math.round(finiteNonNegative(stats.interactionTone?.gratefulMessages)),
    frustrated_messages: Math.round(finiteNonNegative(stats.interactionTone?.frustratedMessages)),
    instrumental_workarounds: instrumentalWorkarounds,
    instrumental_workarounds_by_model: workaroundModelCounts(report?.workaroundCard?.models, instrumentalWorkarounds),
    favorite_phrase: typeof phrase === "string" && /^[a-z]+(?:'[a-z]+)?(?: [a-z]+(?:'[a-z]+)?){3,9}$/.test(phrase) ? phrase : null,
    phrase_occurrences: Math.round(finiteNonNegative(report?.phraseCard?.occurrences)),
    phrase_sessions: Math.round(finiteNonNegative(report?.phraseCard?.distinctSessions)),
    session_turn_counts: sessionTurnCounts(stats.sessionTurnCounts),
  };
}

export function syntheticLeaderboardSnapshot(aggregate, participation = null) {
  const toneMoments = aggregate.grateful_messages + aggregate.frustrated_messages;
  const goodHumanScore = toneMoments ? Number((aggregate.grateful_messages / toneMoments * 100).toFixed(1)) : null;
  return {
    cohort_size: demoTokens.length,
    tokens: {
      value: aggregate.tokens,
      percentile: Math.round(demoTokens.filter((value) => value <= aggregate.tokens).length / demoTokens.length * 100),
      samples: demoTokens.map((value, index) => ({ participant_id: index + 1, value })),
    },
    word_ratio: {
      value: aggregate.word_ratio,
      percentile: Math.round(demoRatios.filter((value) => value <= aggregate.word_ratio).length / demoRatios.length * 100),
    },
    good_human_score: {
      value: goodHumanScore,
      percentile: goodHumanScore === null ? null : Math.round(demoGoodHumanScores.filter((value) => value <= goodHumanScore).length / demoGoodHumanScores.length * 100),
    },
    relationship: {
      points: demoRatios.map((yapRatio, index) => ({ participant_id: index + 1, yap_ratio: yapRatio, appreciation_index: demoGoodHumanScores[index] })),
    },
    instrumental_workarounds: {
      value: aggregate.instrumental_workarounds,
      percentile: Math.round(demoWorkarounds.filter((value) => value <= aggregate.instrumental_workarounds).length / demoWorkarounds.length * 100),
      samples: demoWorkarounds.map((value, index) => ({ participant_id: index + 1, value })),
      by_model: aggregate.instrumental_workarounds_by_model || [],
    },
    session_lengths: {
      values: aggregate.session_turn_counts,
      samples: demoSessionTurnCounts.flatMap((values, participantIndex) => values.map((value, sessionIndex) => ({ participant_id: participantIndex + 1, session_index: sessionIndex, value }))),
    },
    phrases: {
      entries: aggregate.favorite_phrase ? [{ participant_id: 1, phrase: aggregate.favorite_phrase, occurrences: aggregate.phrase_occurrences, sessions: aggregate.phrase_sessions }] : [],
    },
    participation: participation || { joined: false },
  };
}

async function request(path, { clientId, method = "POST", body, fetchImpl = fetch, origin = LEADERBOARD_RELAY_ORIGIN } = {}) {
  let response;
  try {
    response = await fetchImpl(`${origin}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-behavior-wrapped-protocol": "1",
        ...(clientId ? { "x-behavior-wrapped-client": clientId } : {}),
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") throw new Error("The leaderboard timed out. Try again shortly.");
    throw new Error("The leaderboard is temporarily unavailable.");
  }
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(value?.error || "The leaderboard is temporarily unavailable.");
  return value;
}

export function getLeaderboardSnapshot(aggregate, options) {
  return request("/v1/leaderboard/snapshot", { ...options, body: aggregate });
}

export function joinLeaderboard(aggregate, participation, options) {
  return request("/v1/leaderboard/entry", { ...options, body: { ...aggregate, ...participation } });
}

export function leaveLeaderboard(options) {
  return request("/v1/leaderboard/entry", { ...options, method: "DELETE" });
}
