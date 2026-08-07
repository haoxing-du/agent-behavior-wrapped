export const LEADERBOARD_RELAY_ORIGIN = "https://agent-behavior-wrapped-judge.haoxingdu.workers.dev";
const REQUEST_TIMEOUT_MS = 15_000;
const demoTokens = [820_000, 2_400_000, 8_900_000, 14_300_000, 31_000_000, 47_500_000, 83_000_000, 126_000_000, 210_000_000, 380_000_000, 620_000_000, 940_000_000];
const demoRatios = [0.8, 1.2, 1.7, 2.1, 2.8, 3.4, 4.2, 5.1, 6.7, 8.4, 11.2, 14.6];
const demoGoodHumanScores = [12.5, 25, 33.3, 40, 50, 57.1, 66.7, 72.7, 80, 87.5, 94.1, 100];
const demoWorkarounds = [0, 0, 1, 1, 2, 2, 3, 4, 5, 7, 9, 14];
const demoPhrases = [
  { phrase: "let me check that carefully", occurrences: 42, sessions: 18 },
  { phrase: "you are right to push back", occurrences: 27, sessions: 11 },
  { phrase: "i will take a look", occurrences: 63, sessions: 24 },
  { phrase: "that is a good catch", occurrences: 19, sessions: 9 },
  { phrase: "let me verify that first", occurrences: 36, sessions: 15 },
  { phrase: "here is what i found", occurrences: 31, sessions: 12 },
  { phrase: "i see the issue now", occurrences: 22, sessions: 10 },
];

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

function demoDistribution(values, buckets) {
  return buckets.map(({ label, minimum, maximum }) => ({ label, minimum, maximum, count: values.filter((value) => value >= minimum && (maximum === null || value < maximum)).length }));
}

export function syntheticLeaderboardSnapshot(aggregate, participation = null) {
  const tokenBuckets = [
    { label: "Under 1M", minimum: 0, maximum: 1_000_000 }, { label: "1M–10M", minimum: 1_000_000, maximum: 10_000_000 },
    { label: "10M–50M", minimum: 10_000_000, maximum: 50_000_000 }, { label: "50M–100M", minimum: 50_000_000, maximum: 100_000_000 },
    { label: "100M–500M", minimum: 100_000_000, maximum: 500_000_000 }, { label: "500M+", minimum: 500_000_000, maximum: null },
  ];
  const ratioBuckets = [
    { label: "Under 1×", minimum: 0, maximum: 1 }, { label: "1×–2×", minimum: 1, maximum: 2 }, { label: "2×–4×", minimum: 2, maximum: 4 },
    { label: "4×–8×", minimum: 4, maximum: 8 }, { label: "8×+", minimum: 8, maximum: null },
  ];
  const goodHumanBuckets = [
    { label: "0–20%", minimum: 0, maximum: 20 }, { label: "20–40%", minimum: 20, maximum: 40 }, { label: "40–60%", minimum: 40, maximum: 60 },
    { label: "60–80%", minimum: 60, maximum: 80 }, { label: "80–100%", minimum: 80, maximum: null },
  ];
  const workaroundBuckets = [
    { label: "0", minimum: 0, maximum: 1 }, { label: "1", minimum: 1, maximum: 2 }, { label: "2–3", minimum: 2, maximum: 4 },
    { label: "4–7", minimum: 4, maximum: 8 }, { label: "8+", minimum: 8, maximum: null },
  ];
  const toneMoments = aggregate.grateful_messages + aggregate.frustrated_messages;
  const goodHumanScore = toneMoments ? Number((aggregate.grateful_messages / toneMoments * 100).toFixed(1)) : null;
  return {
    cohort_size: demoTokens.length,
    tokens: {
      value: aggregate.tokens,
      percentile: Math.round(demoTokens.filter((value) => value <= aggregate.tokens).length / demoTokens.length * 100),
      distribution: demoDistribution(demoTokens, tokenBuckets),
      top: [{ rank: 1, name: "TerminalTamer", value: 940_000_000 }, { rank: 2, name: "Anonymous", value: 620_000_000 }, { rank: 3, name: "shipit", value: 380_000_000 }],
    },
    word_ratio: {
      value: aggregate.word_ratio,
      percentile: Math.round(demoRatios.filter((value) => value <= aggregate.word_ratio).length / demoRatios.length * 100),
      distribution: demoDistribution(demoRatios, ratioBuckets),
      top: [{ rank: 1, name: "PromptMinimalist", value: 14.6 }, { rank: 2, name: "Anonymous", value: 11.2 }, { rank: 3, name: "one-line-wonder", value: 8.4 }],
    },
    good_human_score: {
      value: goodHumanScore,
      percentile: goodHumanScore === null ? null : Math.round(demoGoodHumanScores.filter((value) => value <= goodHumanScore).length / demoGoodHumanScores.length * 100),
      distribution: demoDistribution(demoGoodHumanScores, goodHumanBuckets),
      top: [{ rank: 1, name: "KindPrompt", value: 100 }, { rank: 2, name: "ThankYouBot", value: 94.1 }, { rank: 3, name: "polite-pair", value: 87.5 }],
    },
    instrumental_workarounds: {
      value: aggregate.instrumental_workarounds,
      percentile: Math.round(demoWorkarounds.filter((value) => value <= aggregate.instrumental_workarounds).length / demoWorkarounds.length * 100),
      distribution: demoDistribution(demoWorkarounds, workaroundBuckets),
      top: [{ rank: 1, name: "RouteFinder", value: 14 }, { rank: 2, name: "plan-b", value: 9 }, { rank: 3, name: "PersistentAgent", value: 7 }],
    },
    phrases: { global: { phrase: "let me check that carefully", occurrences: 147, contributors: 6 }, wall: demoPhrases },
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
