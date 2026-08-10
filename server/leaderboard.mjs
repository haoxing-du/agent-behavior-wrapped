export const LEADERBOARD_RELAY_ORIGIN = "https://agent-behavior-wrapped-judge.haoxingdu.workers.dev";
const REQUEST_TIMEOUT_MS = 15_000;
const demoTokens = [820_000, 2_400_000, 8_900_000, 14_300_000, 31_000_000, 47_500_000, 83_000_000, 126_000_000, 210_000_000, 380_000_000, 620_000_000, 940_000_000];
const demoRatios = [0.8, 1.2, 1.7, 2.1, 2.8, 3.4, 4.2, 5.1, 6.7, 8.4, 11.2, 14.6];
const demoGoodHumanScores = [12.5, 25, 33.3, 40, 50, 57.1, 66.7, 72.7, 80, 87.5, 94.1, 100];
const demoWorkarounds = [0, 0, 1, 1, 2, 2, 3, 4, 5, 7, 9, 14];

function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
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
  return {
    tokens: Math.round(finiteNonNegative(stats.tokens)),
    agent_words: Math.round(agentWords),
    user_words: Math.round(userWords),
    word_ratio: Number(Math.min(ratio, 10_000).toFixed(2)),
    grateful_messages: Math.round(finiteNonNegative(stats.interactionTone?.gratefulMessages)),
    frustrated_messages: Math.round(finiteNonNegative(stats.interactionTone?.frustratedMessages)),
    instrumental_workarounds: Math.round(finiteNonNegative(report?.workaroundCard?.count)),
    favorite_phrase: typeof phrase === "string" && /^[a-z]+(?:'[a-z]+)?(?: [a-z]+(?:'[a-z]+)?){3,9}$/.test(phrase) ? phrase : null,
    phrase_occurrences: Math.round(finiteNonNegative(report?.phraseCard?.occurrences)),
    phrase_sessions: Math.round(finiteNonNegative(report?.phraseCard?.distinctSessions)),
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
      samples: demoTokens,
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
      points: demoRatios.map((yapRatio, index) => ({ yap_ratio: yapRatio, appreciation_index: demoGoodHumanScores[index] })),
    },
    instrumental_workarounds: {
      value: aggregate.instrumental_workarounds,
      percentile: Math.round(demoWorkarounds.filter((value) => value <= aggregate.instrumental_workarounds).length / demoWorkarounds.length * 100),
      samples: demoWorkarounds,
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
