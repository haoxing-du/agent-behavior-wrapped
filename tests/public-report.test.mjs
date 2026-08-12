import test from "node:test";
import assert from "node:assert/strict";
import { publishPublicReport } from "../server/public-report.mjs";
import { sanitizePublicReport } from "../worker/phrase-judge-worker.mjs";

function reportFixture() {
  return {
    id: "shareSafe1234",
    createdAt: "2026-08-05T12:00:00.000Z",
    rangeLabel: "Jul 7 – Aug 5, 2026",
    source: "Claude Code + Codex",
    sessionIds: ["private-session-id"],
    stats: {
      sessions: 4, activeDays: 3, durationMinutes: 90, prompts: 20, toolCalls: 12, interruptions: 1,
      tokens: 1_200_000, agentWords: 8_000, userWords: 2_000, agentUserWordRatio: 4,
      averageAgentResponseWords: 400, averageUserInputWords: 100, estimatedCostUsd: 2.4,
      longestSessionTurns: 999,
      sessionTurnCounts: [12, 2, 51, 0, -1, "private"], sessionTurnExcludedCount: 1,
      interactionTone: { frustratedMessages: 3, gratefulMessages: 7, analyzedMessages: 20, method: "private implementation detail" },
      stockPhrases: [{ phrase: "You're right", count: 8 }, { phrase: "Say the word", count: 5 }, { phrase: "genuinely", count: 3 }, { phrase: "one wrinkle", count: 2 }, { phrase: "private custom phrase", count: 99 }],
      outputLanguages: [{ language: "English", words: 6_000, percentage: 75 }, { language: "Spanish", words: 2_000, percentage: 25 }, { language: "Private language", words: 1, percentage: 1 }],
      languageAnomaly: { language: "Chinese", words: 2, occurrences: 1, privateEvidence: "你好 世界" },
      topics: [{ topic: "Coding", tokens: 720_000, percentage: 60 }, { topic: "Writing", tokens: 480_000, percentage: 40 }, { topic: "Private topic", tokens: 1, percentage: 1 }],
      tools: [{ name: "Read", count: 5 }], agents: [{ agent: "claude", name: "Claude Code", count: 4, percentage: 100 }], models: [],
    },
    findings: [{ id: "finding-1", kind: "scope", title: "Expanded scope", summary: "Generalized signal", confidence: { score: 0.7, label: "Medium" } }],
    phraseCard: { phrase: "let me check that carefully", occurrences: 7, distinctSessions: 3 },
    interactionCard: { frustrationQuote: "Dude, come on, this is not what I asked for!", method: "private judge detail" },
    workaroundCard: { count: 2, models: [{ name: "Claude Opus 4.8", count: 2 }], example: "It moved blocked files into an archive instead of deleting them.", method: "private workaround method" },
    workaroundReview: { occurrences: [{ blocker: "private blocker evidence", location: { sessionId: "private-session-id" } }] },
  };
}

test("sanitizes a hosted report to a strict share-safe shape", () => {
  const safe = sanitizePublicReport({ ...reportFixture(), evidence: { text: "private" } });
  const serialized = JSON.stringify(safe);
  assert.equal(serialized.includes("private-session-id"), false);
  assert.equal(serialized.includes("evidence"), false);
  assert.equal(safe.hosting.public, true);
  assert.equal(safe.rangeLabel, "Your recent agent history");
  assert.equal(safe.donationHelperUrl, "http://localhost:4317/donate/shareSafe1234");
  assert.equal(safe.stats.agentUserWordRatio, 4);
  assert.equal(safe.stats.longestSessionTurns, 51);
  assert.deepEqual(safe.stats.sessionTurnCounts, [2, 12, 51]);
  assert.equal(safe.stats.sessionTurnExcludedCount, 1);
  assert.deepEqual(safe.stats.interactionTone, { frustratedMessages: 3, gratefulMessages: 7, analyzedMessages: 20 });
  assert.deepEqual(safe.stats.stockPhrases, [{ phrase: "You're right", count: 8 }, { phrase: "Say the word", count: 5 }, { phrase: "genuinely", count: 3 }, { phrase: "one wrinkle", count: 2 }]);
  assert.deepEqual(safe.stats.outputLanguages.map((item) => item.language), ["English", "Spanish"]);
  assert.deepEqual(safe.stats.languageAnomaly, { language: "Chinese", words: 2, occurrences: 1 });
  assert.deepEqual(safe.stats.topics.map((item) => item.topic), ["Coding", "Writing"]);
  assert.deepEqual(safe.interactionCard, { frustrationQuote: "Dude, come on, this is not what I asked for!" });
  assert.deepEqual(safe.workaroundCard, { count: 2, models: [{ name: "Claude Opus 4.8", count: 2 }], example: "It moved blocked files into an archive instead of deleting them." });
  assert.equal(serialized.includes("private implementation detail"), false);
  assert.equal(serialized.includes("private judge detail"), false);
});

test("preserves a completed zero-occurrence workaround review", () => {
  const safe = sanitizePublicReport({ ...reportFixture(), workaroundCard: { count: 0, models: [] } });
  assert.deepEqual(safe.workaroundCard, { count: 0, models: [] });
});

test("the local publisher strips private session IDs before upload", async () => {
  let uploaded;
  const result = await publishPublicReport({ ...reportFixture(), privateNotes: "must never cross the network", interactionReview: { excerpts: ["private future field"] } }, {
    clientId: "b".repeat(32),
    managementToken: "c".repeat(64),
    origin: "https://example.test",
    fetchImpl: async (_url, request) => {
      uploaded = JSON.parse(request.body);
      return new Response(JSON.stringify({ public_url: "https://example.test/w/shareSafe1234" }), { status: 201, headers: { "content-type": "application/json" } });
    },
  });
  assert.equal("sessionIds" in uploaded.report, false);
  assert.equal("workaroundReview" in uploaded.report, false);
  assert.equal("privateNotes" in uploaded.report, false);
  assert.equal("interactionReview" in uploaded.report, false);
  assert.equal(uploaded.management_token, "c".repeat(64));
  assert.equal(JSON.stringify(uploaded).includes("private future field"), false);
  assert.equal(uploaded.report.rangeLabel, "Your recent agent history");
  assert.equal(result.public_url, "https://example.test/w/shareSafe1234");
  assert.equal(result.management_url, `https://example.test/w/shareSafe1234#manage=${"c".repeat(64)}`);
});
