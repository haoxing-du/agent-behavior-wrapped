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
      interactionTone: { frustratedMessages: 3, gratefulMessages: 7, analyzedMessages: 20, method: "private implementation detail" },
      outputLanguages: [{ language: "English", words: 6_000, percentage: 75 }, { language: "Spanish", words: 2_000, percentage: 25 }, { language: "Private language", words: 1, percentage: 1 }],
      topics: [{ topic: "Coding", prompts: 12, percentage: 60 }, { topic: "Writing", prompts: 8, percentage: 40 }, { topic: "Private topic", prompts: 1, percentage: 1 }],
      tools: [{ name: "Read", count: 5 }], agents: [{ agent: "claude", name: "Claude Code", count: 4, percentage: 100 }], models: [],
    },
    findings: [{ id: "finding-1", kind: "scope", title: "Expanded scope", summary: "Generalized signal", confidence: { score: 0.7, label: "Medium" } }],
    phraseCard: { phrase: "let me check that carefully", occurrences: 7, distinctSessions: 3 },
    interactionCard: { quote: "Dude, come on, this is not what I asked for!", method: "private judge detail" },
  };
}

test("sanitizes a hosted report to a strict share-safe shape", () => {
  const safe = sanitizePublicReport({ ...reportFixture(), evidence: { text: "private" } });
  const serialized = JSON.stringify(safe);
  assert.equal(serialized.includes("private-session-id"), false);
  assert.equal(serialized.includes("evidence"), false);
  assert.equal(safe.hosting.public, true);
  assert.equal(safe.rangeLabel, "Your recent agent history");
  assert.equal(safe.stats.agentUserWordRatio, 4);
  assert.deepEqual(safe.stats.interactionTone, { frustratedMessages: 3, gratefulMessages: 7, analyzedMessages: 20 });
  assert.deepEqual(safe.stats.outputLanguages.map((item) => item.language), ["English", "Spanish"]);
  assert.deepEqual(safe.stats.topics.map((item) => item.topic), ["Coding", "Writing"]);
  assert.deepEqual(safe.interactionCard, { quote: "Dude, come on, this is not what I asked for!" });
  assert.equal(serialized.includes("private implementation detail"), false);
  assert.equal(serialized.includes("private judge detail"), false);
});

test("the local publisher strips private session IDs before upload", async () => {
  let uploaded;
  const result = await publishPublicReport(reportFixture(), {
    clientId: "b".repeat(32),
    origin: "https://example.test",
    fetchImpl: async (_url, request) => {
      uploaded = JSON.parse(request.body);
      return new Response(JSON.stringify({ public_url: "https://example.test/w/shareSafe1234" }), { status: 201, headers: { "content-type": "application/json" } });
    },
  });
  assert.equal("sessionIds" in uploaded.report, false);
  assert.equal(uploaded.report.rangeLabel, "Your recent agent history");
  assert.equal(result.public_url, "https://example.test/w/shareSafe1234");
});
