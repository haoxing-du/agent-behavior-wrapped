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
};

const publicReport = {
  id: "leaderReport123",
  stats: { tokens: aggregate.tokens, agentWords: aggregate.agent_words, userWords: aggregate.user_words, agentUserWordRatio: aggregate.word_ratio, interactionTone: { gratefulMessages: aggregate.grateful_messages, frustratedMessages: aggregate.frustrated_messages } },
  phraseCard: { phrase: aggregate.favorite_phrase, occurrences: aggregate.phrase_occurrences, distinctSessions: aggregate.phrase_sessions },
  workaroundCard: { count: aggregate.instrumental_workarounds, models: [] },
};

async function sha256(value) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function leaderboardDatabase(managementTokenHash) {
  let entry = null;
  return {
    get entry() { return entry; },
    prepare(sql) {
      let values = [];
      return {
        bind(...next) { values = next; return this; },
        async first() {
          if (sql.includes("FROM public_reports")) return { report_json: JSON.stringify(publicReport), owner_hash: "owner-hash", management_token_hash: managementTokenHash };
          if (sql.includes("SUM(phrase_occurrences)")) return null;
          if (sql.includes("WHERE client_hash = ?")) return entry ? { display_name: entry.displayName, public_ranked: entry.publicRanked, shares_phrase: entry.sharesPhrase } : null;
          return null;
        },
        async all() {
          if (sql.startsWith("SELECT tokens, word_ratio, grateful_messages")) return { results: entry ? [{ tokens: entry.tokens, word_ratio: entry.wordRatio, grateful_messages: entry.gratefulMessages, frustrated_messages: entry.frustratedMessages, instrumental_workarounds: entry.workarounds }] : [] };
          return { results: [] };
        },
        async run() {
          if (sql.startsWith("INSERT INTO leaderboard_entries")) entry = { ownerHash: values[0], displayName: values[1], publicRanked: values[2], tokens: values[3], wordRatio: values[6], gratefulMessages: values[7], frustratedMessages: values[8], workarounds: values[9], sharesPhrase: Boolean(values[10]) };
          if (sql.startsWith("DELETE FROM leaderboard_entries")) entry = null;
          return { meta: { changes: 1 } };
        },
      };
    },
  };
}

test("builds a narrow leaderboard aggregate from a saved report", () => {
  const value = leaderboardAggregateFromReport({
    stats: { tokens: 12_500_000, agentWords: 8_000, userWords: 2_000, interactionTone: { gratefulMessages: 7, frustratedMessages: 3 } },
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
});

test("builds a complete synthetic leaderboard without a network request", () => {
  const snapshot = syntheticLeaderboardSnapshot(aggregate);
  assert.equal(snapshot.cohort_size, 12);
  assert.equal(snapshot.tokens.samples.length, 12);
  assert.equal(snapshot.relationship.points.length, 12);
  assert.deepEqual(snapshot.relationship.points[0], { yap_ratio: 0.8, appreciation_index: 12.5 });
  assert.equal(snapshot.good_human_score.value, 70);
  assert.equal(snapshot.instrumental_workarounds.value, 4);
  assert.equal(snapshot.instrumental_workarounds.samples.length, 12);
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

test("a shared public report cannot be enrolled without its management credential", async () => {
  const token = "d".repeat(64);
  const database = leaderboardDatabase(await sha256(token));
  const response = await handleRequest(new Request("https://example.com/api/reports/leaderReport123/leaderboard", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "join", consent: true, displayName: "Tester", publicRanked: true, includePhrase: false }),
  }), { LEADERBOARD_DB: database, CLIENT_RATE_LIMITER: { limit: async () => ({ success: true }) } });
  assert.equal(response.status, 403);
  assert.equal(database.entry, null);
});

test("the creator can explicitly store and later remove a permanent aggregate entry", async () => {
  const token = "e".repeat(64);
  const database = leaderboardDatabase(await sha256(token));
  const headers = { "content-type": "application/json", "x-behavior-wrapped-management": token };
  const joined = await handleRequest(new Request("https://example.com/api/reports/leaderReport123/leaderboard", {
    method: "POST", headers,
    body: JSON.stringify({ action: "join", consent: true, displayName: "Tester", publicRanked: true, includePhrase: false }),
  }), { LEADERBOARD_DB: database, CLIENT_RATE_LIMITER: { limit: async () => ({ success: true }) } });
  assert.equal(joined.status, 200);
  const snapshot = await joined.json();
  assert.equal(snapshot.can_manage, true);
  assert.equal(snapshot.participation.joined, true);
  assert.equal(snapshot.good_human_score.value, 70);
  assert.equal(snapshot.instrumental_workarounds.value, 4);
  assert.equal(snapshot.tokens.samples.length, 1);
  assert.deepEqual(snapshot.relationship.points, [{ yap_ratio: 4, appreciation_index: 70 }]);
  assert.equal(database.entry.ownerHash, "owner-hash");
  assert.equal(database.entry.sharesPhrase, false);

  const removed = await handleRequest(new Request("https://example.com/api/reports/leaderReport123/leaderboard", { method: "DELETE", headers }), {
    LEADERBOARD_DB: database, CLIENT_RATE_LIMITER: { limit: async () => ({ success: true }) },
  });
  assert.equal(removed.status, 200);
  assert.equal(database.entry, null);
});
