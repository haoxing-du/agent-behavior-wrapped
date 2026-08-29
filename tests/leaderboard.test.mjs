import test from "node:test";
import assert from "node:assert/strict";
import { leaderboardAggregateFromReport, syntheticLeaderboardSnapshot } from "../server/leaderboard.mjs";
import { buildSessionLengthDistribution, parseSessionLengthDistribution } from "../server/session-length-distribution.mjs";
import { handleRequest, validateLeaderboardAggregate } from "../worker/phrase-judge-worker.mjs";

const aggregate = {
  tokens: 12_500_000,
  agent_words: 8_000,
  user_words: 2_000,
  word_ratio: 4,
  grateful_messages: 7,
  frustrated_messages: 3,
  instrumental_workarounds: 4,
  instrumental_workarounds_by_model: [{ model: "GPT-5.6 Sol", count: 3 }, { model: "Claude Opus 4.8", count: 1 }],
  favorite_phrase: "you are right to push back",
  phrase_occurrences: 12,
  phrase_sessions: 5,
  session_turn_counts: [3, 18, 42],
};

const publicReport = {
  id: "leaderReport123",
  stats: { tokens: aggregate.tokens, agentWords: aggregate.agent_words, userWords: aggregate.user_words, agentUserWordRatio: aggregate.word_ratio, sessionTurnCounts: aggregate.session_turn_counts, interactionTone: { gratefulMessages: aggregate.grateful_messages, frustratedMessages: aggregate.frustrated_messages } },
  phraseCard: { phrase: aggregate.favorite_phrase, occurrences: aggregate.phrase_occurrences, distinctSessions: aggregate.phrase_sessions },
  workaroundCard: { count: aggregate.instrumental_workarounds, models: aggregate.instrumental_workarounds_by_model.map(({ model, count }) => ({ name: model, count })) },
};

async function sha256(value) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function leaderboardDatabase(managementTokenHash) {
  let entry = null;
  let optedOut = false;
  let sessionLengthDistribution = null;
  const modelEntries = new Map();
  return {
    get entry() { return entry; },
    get optedOut() { return optedOut; },
    get modelEntries() { return modelEntries; },
    get sessionLengthDistribution() { return sessionLengthDistribution; },
    prepare(sql) {
      let values = [];
      return {
        bind(...next) { values = next; return this; },
        async first() {
          if (sql.includes("FROM public_reports")) return { report_json: JSON.stringify(publicReport), owner_hash: "owner-hash", management_token_hash: managementTokenHash };
          if (sql.includes("FROM leaderboard_opt_outs")) return optedOut ? { client_hash: "owner-hash" } : null;
          if (sql.includes("FROM leaderboard_session_length_distribution")) return sessionLengthDistribution ? { distribution_json: JSON.stringify(sessionLengthDistribution) } : null;
          if (sql.includes("SUM(phrase_occurrences)")) return null;
          if (sql.includes("WHERE client_hash = ?")) return entry ? { participant_id: 1, display_name: entry.displayName, public_ranked: entry.publicRanked, shares_phrase: entry.sharesPhrase } : null;
          return null;
        },
        async all() {
          if (sql.includes("SELECT session_turn_counts FROM leaderboard_entries")) return { results: entry ? [{ session_turn_counts: entry.sessionTurnCounts }] : [] };
          if (sql.includes("tokens, word_ratio, grateful_messages")) return { results: entry ? [{ participant_id: 1, tokens: entry.tokens, word_ratio: entry.wordRatio, grateful_messages: entry.gratefulMessages, frustrated_messages: entry.frustratedMessages, instrumental_workarounds: entry.workarounds, favorite_phrase: entry.phrase, phrase_occurrences: entry.phraseOccurrences, phrase_sessions: entry.phraseSessions, session_turn_counts: entry.sessionTurnCounts }] : [] };
          if (sql.includes("FROM leaderboard_model_workarounds")) return { results: [...modelEntries].map(([model, count]) => ({ model, detected_instances: count })).sort((left, right) => right.detected_instances - left.detected_instances || left.model.localeCompare(right.model)) };
          return { results: [] };
        },
        async run() {
          if (sql.startsWith("INSERT INTO leaderboard_entries") && sql.includes("'Anonymous'")) entry = { ownerHash: values[0], displayName: "Anonymous", publicRanked: 0, tokens: values[1], wordRatio: values[4], gratefulMessages: values[5], frustratedMessages: values[6], workarounds: values[7], phrase: values[8], phraseOccurrences: values[9], phraseSessions: values[10], sessionTurnCounts: values[11], sharesPhrase: Boolean(values[8]) };
          else if (sql.startsWith("INSERT INTO leaderboard_entries")) entry = { ownerHash: values[0], displayName: values[1], publicRanked: values[2], tokens: values[3], wordRatio: values[6], gratefulMessages: values[7], frustratedMessages: values[8], workarounds: values[9], phrase: values[10], phraseOccurrences: values[11], phraseSessions: values[12], sessionTurnCounts: values[13], sharesPhrase: Boolean(values[10]) };
          if (sql.startsWith("INSERT INTO leaderboard_opt_outs")) optedOut = true;
          if (sql.startsWith("DELETE FROM leaderboard_opt_outs")) optedOut = false;
          if (sql.startsWith("DELETE FROM leaderboard_entries")) entry = null;
          if (sql.startsWith("DELETE FROM leaderboard_model_workarounds")) modelEntries.clear();
          if (sql.startsWith("INSERT INTO leaderboard_model_workarounds")) modelEntries.set(values[1], values[2]);
          if (sql.startsWith("INSERT INTO leaderboard_session_length_distribution")) sessionLengthDistribution = JSON.parse(values[0]);
          return { meta: { changes: 1 } };
        },
      };
    },
  };
}

test("builds a narrow leaderboard aggregate from a saved report", () => {
  const value = leaderboardAggregateFromReport({
    stats: { tokens: 12_500_000, agentWords: 8_000, userWords: 2_000, sessionTurnCounts: [3, 18, 42], interactionTone: { gratefulMessages: 7, frustratedMessages: 3 } },
    phraseCard: { phrase: "you are right to push back", occurrences: 12, distinctSessions: 5 },
    workaroundCard: { count: 4, models: [{ name: "GPT-5.6 Sol", count: 3 }, { name: "Claude Opus 4.8", count: 1 }] },
  });
  assert.deepEqual(value, aggregate);
  assert.equal(JSON.stringify(value).includes("transcript"), false);
});

test("rejects unsafe or malformed leaderboard aggregates", () => {
  assert.deepEqual(validateLeaderboardAggregate(aggregate), aggregate);
  assert.equal(validateLeaderboardAggregate({ ...aggregate, favorite_phrase: "email me at private@example.com" }), null);
  assert.equal(validateLeaderboardAggregate({ ...aggregate, tokens: -1 }), null);
  assert.equal(validateLeaderboardAggregate({ ...aggregate, word_ratio: Infinity }), null);
  assert.equal(validateLeaderboardAggregate({ ...aggregate, grateful_messages: -1 }), null);
  assert.equal(validateLeaderboardAggregate({ ...aggregate, instrumental_workarounds_by_model: [{ model: "GPT-5.6 Sol", count: 2 }] }), null);
  assert.equal(validateLeaderboardAggregate({ ...aggregate, instrumental_workarounds_by_model: [{ model: "GPT-5.6 Sol", count: 2 }, { model: "GPT-5.6 Sol", count: 2 }] }), null);
  assert.equal(validateLeaderboardAggregate({ ...aggregate, session_turn_counts: [3, 0, 42] }), null);
  assert.deepEqual(validateLeaderboardAggregate(Object.fromEntries(Object.entries(aggregate).filter(([key]) => key !== "session_turn_counts")))?.session_turn_counts, []);
  assert.equal("instrumental_workarounds_by_model" in validateLeaderboardAggregate(Object.fromEntries(Object.entries(aggregate).filter(([key]) => key !== "instrumental_workarounds_by_model"))), false);
});

test("builds a complete synthetic leaderboard without a network request", () => {
  const snapshot = syntheticLeaderboardSnapshot(aggregate);
  assert.equal(snapshot.cohort_size, 12);
  assert.equal(snapshot.tokens.samples.length, 12);
  assert.equal(snapshot.relationship.points.length, 12);
  assert.deepEqual(snapshot.relationship.points[0], { participant_id: 1, yap_ratio: 0.8, appreciation_index: 12.5 });
  assert.equal(snapshot.good_human_score.value, 70);
  assert.equal(snapshot.instrumental_workarounds.value, 4);
  assert.equal(snapshot.instrumental_workarounds.samples.length, 12);
  assert.deepEqual(snapshot.instrumental_workarounds.by_model, aggregate.instrumental_workarounds_by_model);
  assert.equal(snapshot.session_lengths.distribution.session_count, 29);
  assert.equal(snapshot.session_lengths.distribution.points.length, 64);
  assert.deepEqual(snapshot.session_lengths.values, aggregate.session_turn_counts);
  assert.equal(snapshot.phrases.entries[0].phrase, aggregate.favorite_phrase);
});

test("precomputes a bounded session-length density contour", () => {
  const distribution = buildSessionLengthDistribution([1, 2, 3, 18, 42, 1_000]);
  assert.equal(distribution.session_count, 6);
  assert.equal(distribution.median_turns, 10.5);
  assert.equal(distribution.min_turns, 1);
  assert.equal(distribution.max_turns, 1_000);
  assert.equal(distribution.points.length, 64);
  assert.ok(distribution.points.some((point) => point.density === 1));
  assert.deepEqual(parseSessionLengthDistribution(JSON.stringify(distribution)), distribution);
  assert.equal(parseSessionLengthDistribution('{"session_count":1,"points":[]}'), null);
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

test("a report-specific leaderboard comparison is creator-only", async () => {
  const token = "d".repeat(64);
  const database = leaderboardDatabase(await sha256(token));
  const response = await handleRequest(new Request("https://example.com/api/reports/leaderReport123/leaderboard", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "snapshot" }),
  }), { LEADERBOARD_DB: database, CLIENT_RATE_LIMITER: { limit: async () => ({ success: true }) } });
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /creator/i);
  assert.equal(database.entry, null);
});

test("the public leaderboard exposes cohort medians without report management state", async () => {
  const token = "f".repeat(64);
  const database = leaderboardDatabase(await sha256(token));
  const environment = { LEADERBOARD_DB: database, CLIENT_RATE_LIMITER: { limit: async () => ({ success: true }) } };
  await handleRequest(new Request("https://example.com/api/reports/leaderReport123/leaderboard", {
    method: "POST",
    headers: { "content-type": "application/json", "x-behavior-wrapped-management": token },
    body: JSON.stringify({ action: "snapshot" }),
  }), environment);
  const response = await handleRequest(new Request("https://example.com/api/leaderboard"), environment);
  assert.equal(response.status, 200);
  const snapshot = await response.json();
  assert.equal(snapshot.public_view, true);
  assert.equal(snapshot.can_manage, undefined);
  assert.deepEqual(snapshot.participation, { joined: false });
  assert.equal(snapshot.tokens.value, aggregate.tokens);
  assert.equal(snapshot.tokens.percentile, null);
  assert.equal(snapshot.word_ratio.value, aggregate.word_ratio);
  assert.equal(snapshot.good_human_score.value, 70);
  assert.equal(snapshot.instrumental_workarounds.value, aggregate.instrumental_workarounds);
  assert.deepEqual(snapshot.session_lengths.values, []);
  assert.equal(snapshot.session_lengths.distribution.session_count, 3);
  assert.equal(snapshot.session_lengths.distribution.points.length, 64);
});

test("the creator can persistently opt out and later add anonymous stats back", async () => {
  const token = "e".repeat(64);
  const database = leaderboardDatabase(await sha256(token));
  const headers = { "content-type": "application/json", "x-behavior-wrapped-management": token };
  const initial = await handleRequest(new Request("https://example.com/api/reports/leaderReport123/leaderboard", {
    method: "POST", headers,
    body: JSON.stringify({ action: "snapshot" }),
  }), { LEADERBOARD_DB: database, CLIENT_RATE_LIMITER: { limit: async () => ({ success: true }) } });
  assert.equal(initial.status, 200);
  const snapshot = await initial.json();
  assert.equal(snapshot.can_manage, true);
  assert.equal(snapshot.participation.joined, true);
  assert.equal(snapshot.good_human_score.value, 70);
  assert.equal(snapshot.instrumental_workarounds.value, 4);
  assert.equal(snapshot.tokens.samples.length, 1);
  assert.deepEqual(snapshot.relationship.points, [{ participant_id: 1, yap_ratio: 4, appreciation_index: 70 }]);
  assert.deepEqual(snapshot.tokens.samples, [{ participant_id: 1, value: 12_500_000 }]);
  assert.deepEqual(snapshot.instrumental_workarounds.samples, [{ participant_id: 1, value: 4 }]);
  assert.deepEqual(snapshot.instrumental_workarounds.by_model, aggregate.instrumental_workarounds_by_model);
  assert.deepEqual(snapshot.session_lengths.values, [3, 18, 42]);
  assert.equal(snapshot.session_lengths.distribution.session_count, 3);
  assert.equal(snapshot.session_lengths.distribution.median_turns, 18);
  assert.equal("samples" in snapshot.session_lengths, false);
  assert.deepEqual(snapshot.phrases.entries, [{ participant_id: 1, phrase: aggregate.favorite_phrase, occurrences: 12, sessions: 5 }]);
  assert.equal(database.entry.ownerHash, "owner-hash");
  assert.equal(database.entry.sharesPhrase, true);
  assert.deepEqual([...database.modelEntries], aggregate.instrumental_workarounds_by_model.map(({ model, count }) => [model, count]));

  const removed = await handleRequest(new Request("https://example.com/api/reports/leaderReport123/leaderboard", { method: "DELETE", headers }), {
    LEADERBOARD_DB: database, CLIENT_RATE_LIMITER: { limit: async () => ({ success: true }) },
  });
  assert.equal(removed.status, 200);
  assert.equal(database.entry, null);
  assert.equal(database.modelEntries.size, 0);
  assert.equal(database.optedOut, true);
  assert.equal(database.sessionLengthDistribution.session_count, 0);

  const stillOut = await handleRequest(new Request("https://example.com/api/reports/leaderReport123/leaderboard", {
    method: "POST", headers, body: JSON.stringify({ action: "snapshot" }),
  }), { LEADERBOARD_DB: database, CLIENT_RATE_LIMITER: { limit: async () => ({ success: true }) } });
  assert.equal(stillOut.status, 200);
  assert.equal((await stillOut.json()).participation.joined, false);
  assert.equal(database.entry, null);

  const included = await handleRequest(new Request("https://example.com/api/reports/leaderReport123/leaderboard", {
    method: "POST", headers, body: JSON.stringify({ action: "include" }),
  }), { LEADERBOARD_DB: database, CLIENT_RATE_LIMITER: { limit: async () => ({ success: true }) } });
  assert.equal(included.status, 200);
  assert.equal((await included.json()).participation.joined, true);
  assert.equal(database.optedOut, false);
  assert.equal(database.entry.displayName, "Anonymous");
});
