import test from "node:test";
import assert from "node:assert/strict";
import { leaderboardAggregateFromReport, syntheticLeaderboardSnapshot } from "../server/leaderboard.mjs";
import { handleRequest, validateLeaderboardAggregate } from "../worker/phrase-judge-worker.mjs";

const aggregate = {
  tokens: 12_500_000,
  agent_words: 8_000,
  user_words: 2_000,
  word_ratio: 4,
  favorite_phrase: "you are right to push back",
  phrase_occurrences: 12,
  phrase_sessions: 5,
};

test("builds a narrow leaderboard aggregate from a saved report", () => {
  const value = leaderboardAggregateFromReport({
    stats: { tokens: 12_500_000, agentWords: 8_000, userWords: 2_000 },
    phraseCard: { phrase: "you are right to push back", occurrences: 12, distinctSessions: 5 },
  });
  assert.deepEqual(value, aggregate);
  assert.equal(JSON.stringify(value).includes("transcript"), false);
});

test("rejects unsafe or malformed leaderboard aggregates", () => {
  assert.deepEqual(validateLeaderboardAggregate(aggregate), aggregate);
  assert.equal(validateLeaderboardAggregate({ ...aggregate, favorite_phrase: "email me at private@example.com" }), null);
  assert.equal(validateLeaderboardAggregate({ ...aggregate, tokens: -1 }), null);
  assert.equal(validateLeaderboardAggregate({ ...aggregate, word_ratio: Infinity }), null);
});

test("builds a complete synthetic leaderboard without a network request", () => {
  const snapshot = syntheticLeaderboardSnapshot(aggregate);
  assert.equal(snapshot.cohort_size, 12);
  assert.equal(snapshot.tokens.distribution.reduce((sum, bucket) => sum + bucket.count, 0), 12);
  assert.equal(snapshot.word_ratio.distribution.reduce((sum, bucket) => sum + bucket.count, 0), 12);
  assert.ok(snapshot.phrases.wall.length > 3);
});

test("requires explicit consent before storing a leaderboard entry", async () => {
  const request = new Request("https://example.com/v1/leaderboard/entry", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-behavior-wrapped-protocol": "1",
      "x-behavior-wrapped-client": "a".repeat(32),
    },
    body: JSON.stringify({ ...aggregate, consent: false, public_ranked: false, include_phrase: false }),
  });
  const response = await handleRequest(request, { CLIENT_RATE_LIMITER: { limit: async () => ({ success: true }) } });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /consent/i);
});
