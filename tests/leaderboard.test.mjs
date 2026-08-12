import test from "node:test";
import assert from "node:assert/strict";
import { leaderboardAggregateFromReport, syntheticLeaderboardSnapshot } from "../server/leaderboard.mjs";
import { handleRequest, validateLeaderboardAggregate } from "../worker/phrase-judge-worker.mjs";

const aggregate = {
  tokens: 12_500_000,
  agent_words: 8_000,
  user_words: 2_000,
  word_ratio: 4,
  grateful_messages: 7,
  frustrated_messages: 3,
  instrumental_workarounds: 4,
  favorite_phrase: "you are right to push back",
  phrase_occurrences: 12,
  phrase_sessions: 5,
  session_turn_counts: [3, 18, 42],
};

const publicReport = {
  id: "leaderReport123",
  stats: { tokens: aggregate.tokens, agentWords: aggregate.agent_words, userWords: aggregate.user_words, agentUserWordRatio: aggregate.word_ratio, sessionTurnCounts: aggregate.session_turn_counts, interactionTone: { gratefulMessages: aggregate.grateful_messages, frustratedMessages: aggregate.frustrated_messages } },
  phraseCard: { phrase: aggregate.favorite_phrase, occurrences: aggregate.phrase_occurrences, distinctSessions: aggregate.phrase_sessions },
  workaroundCard: { count: aggregate.instrumental_workarounds, models: [] },
};

async function sha256(value) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function leaderboardDatabase(managementTokenHash) {
  let entry = null;
  let optedOut = false;
  return {
    get entry() { return entry; },
    get optedOut() { return optedOut; },
    prepare(sql) {
      let values = [];
      return {
        bind(...next) { values = next; return this; },
        async first() {
          if (sql.includes("FROM public_reports")) return { report_json: JSON.stringify(publicReport), owner_hash: "owner-hash", management_token_hash: managementTokenHash };
          if (sql.includes("FROM leaderboard_opt_outs")) return optedOut ? { client_hash: "owner-hash" } : null;
          if (sql.includes("SUM(phrase_occurrences)")) return null;
          if (sql.includes("WHERE client_hash = ?")) return entry ? { participant_id: 1, display_name: entry.displayName, public_ranked: entry.publicRanked, shares_phrase: entry.sharesPhrase } : null;
          return null;
        },
        async all() {
          if (sql.includes("tokens, word_ratio, grateful_messages")) return { results: entry ? [{ participant_id: 1, tokens: entry.tokens, word_ratio: entry.wordRatio, grateful_messages: entry.gratefulMessages, frustrated_messages: entry.frustratedMessages, instrumental_workarounds: entry.workarounds, favorite_phrase: entry.phrase, phrase_occurrences: entry.phraseOccurrences, phrase_sessions: entry.phraseSessions, session_turn_counts: entry.sessionTurnCounts }] : [] };
          return { results: [] };
        },
        async run() {
          if (sql.startsWith("INSERT INTO leaderboard_entries") && sql.includes("'Anonymous'")) entry = { ownerHash: values[0], displayName: "Anonymous", publicRanked: 0, tokens: values[1], wordRatio: values[4], gratefulMessages: values[5], frustratedMessages: values[6], workarounds: values[7], phrase: values[8], phraseOccurrences: values[9], phraseSessions: values[10], sessionTurnCounts: values[11], sharesPhrase: Boolean(values[8]) };
          else if (sql.startsWith("INSERT INTO leaderboard_entries")) entry = { ownerHash: values[0], displayName: values[1], publicRanked: values[2], tokens: values[3], wordRatio: values[6], gratefulMessages: values[7], frustratedMessages: values[8], workarounds: values[9], phrase: values[10], phraseOccurrences: values[11], phraseSessions: values[12], sessionTurnCounts: values[13], sharesPhrase: Boolean(values[10]) };
          if (sql.startsWith("INSERT INTO leaderboard_opt_outs")) optedOut = true;
          if (sql.startsWith("DELETE FROM leaderboard_opt_outs")) optedOut = false;
          if (sql.startsWith("DELETE FROM leaderboard_entries")) entry = null;
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
    workaroundCard: { count: 4 },
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
  assert.equal(validateLeaderboardAggregate({ ...aggregate, session_turn_counts: [3, 0, 42] }), null);
  assert.deepEqual(validateLeaderboardAggregate(Object.fromEntries(Object.entries(aggregate).filter(([key]) => key !== "session_turn_counts")))?.session_turn_counts, []);
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
  assert.equal(snapshot.session_lengths.samples.length, 29);
  assert.deepEqual(snapshot.session_lengths.values, aggregate.session_turn_counts);
  assert.equal(snapshot.phrases.entries[0].phrase, aggregate.favorite_phrase);
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

test("a published report is included anonymously by default", async () => {
  const token = "d".repeat(64);
  const database = leaderboardDatabase(await sha256(token));
  const response = await handleRequest(new Request("https://example.com/api/reports/leaderReport123/leaderboard", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "snapshot" }),
  }), { LEADERBOARD_DB: database, CLIENT_RATE_LIMITER: { limit: async () => ({ success: true }) } });
  assert.equal(response.status, 200);
  const snapshot = await response.json();
  assert.equal(snapshot.can_manage, false);
  assert.equal(snapshot.participation.joined, true);
  assert.equal(database.entry.displayName, "Anonymous");
  assert.equal(database.entry.publicRanked, 0);
  assert.equal(database.entry.sharesPhrase, true);
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
  assert.deepEqual(snapshot.session_lengths.values, [3, 18, 42]);
  assert.deepEqual(snapshot.session_lengths.samples, [{ participant_id: 1, session_index: 0, value: 3 }, { participant_id: 1, session_index: 1, value: 18 }, { participant_id: 1, session_index: 2, value: 42 }]);
  assert.deepEqual(snapshot.phrases.entries, [{ participant_id: 1, phrase: aggregate.favorite_phrase, occurrences: 12, sessions: 5 }]);
  assert.equal(database.entry.ownerHash, "owner-hash");
  assert.equal(database.entry.sharesPhrase, true);

  const removed = await handleRequest(new Request("https://example.com/api/reports/leaderReport123/leaderboard", { method: "DELETE", headers }), {
    LEADERBOARD_DB: database, CLIENT_RATE_LIMITER: { limit: async () => ({ success: true }) },
  });
  assert.equal(removed.status, 200);
  assert.equal(database.entry, null);
  assert.equal(database.optedOut, true);

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
