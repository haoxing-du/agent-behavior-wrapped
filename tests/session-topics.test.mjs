import assert from "node:assert/strict";
import test from "node:test";
import {
  applySessionTopicJudgment,
  buildOpenRouterSessionTopicRequest,
  buildSessionTopicCandidates,
  extractSessionTopicSelection,
  judgeSessionTopicsViaRelay,
} from "../server/session-topics.mjs";

const sessions = [
  { sessionId: "coding", records: [
    { type: "user", message: { content: "Implement the React component." } },
    { type: "assistant", message: { content: "Working on it.", usage: { input_tokens: 70, output_tokens: 20, cache_creation_input_tokens: 5, cache_read_input_tokens: 5 } } },
    { type: "user", message: { content: "Now add tests." } },
    { type: "user", isMeta: true, message: { content: "private tool output" } },
  ] },
  { sessionId: "writing", records: [
    { type: "user", message: { content: "Draft a warm launch email." } },
    { type: "assistant", message: { content: "Here is a draft.", usage: { input_tokens: 30, output_tokens: 20 } } },
  ] },
];

test("builds redacted session openings with private token weights", () => {
  const bundle = buildSessionTopicCandidates(sessions);
  assert.equal(bundle.candidates.length, 2);
  assert.deepEqual(bundle.candidates[0].opening_messages, ["Implement the React component.", "Now add tests."]);
  assert.equal(bundle.tokenWeights.get("session-topic-1"), 100);
  assert.equal(bundle.tokenWeights.get("session-topic-2"), 50);
  assert.equal(bundle.sessionIds.get("session-topic-1"), "coding");
  assert.equal("sessionId" in bundle.candidates[0], false);
  assert.equal("tokens" in bundle.candidates[0], false);
});

test("builds a strict one-classification-per-session request", () => {
  const bundle = buildSessionTopicCandidates(sessions);
  const request = buildOpenRouterSessionTopicRequest(bundle.candidates);
  const schema = request.response_format.json_schema.schema.properties.classifications;
  assert.equal(schema.minItems, 2);
  assert.equal(schema.maxItems, 2);
  assert.ok(schema.items.properties.topic.enum.includes("Coding"));
  assert.equal(schema.items.properties.summary.maxLength, 120);
  assert.deepEqual(request.reasoning, { effort: "none", exclude: true });
  assert.deepEqual(request.provider, { data_collection: "deny", zdr: true });
});

test("weights judged session topics by locally counted tokens", async () => {
  const bundle = buildSessionTopicCandidates(sessions);
  const classifications = [
    { candidate_id: "session-topic-1", topic: "Coding", confidence: 0.94, summary: "Building and testing a React component" },
    { candidate_id: "session-topic-2", topic: "Writing", confidence: 0.88, summary: "Drafting a warm launch email" },
  ];
  const result = await judgeSessionTopicsViaRelay(bundle, {
    endpoint: "https://relay.example/v1/session-topics",
    clientId: "0123456789abcdef0123456789abcdef",
    fetchImpl: async (_url, init) => {
      const outbound = JSON.parse(init.body);
      assert.deepEqual(outbound, { candidates: bundle.candidates });
      return new Response(JSON.stringify({ classifications, model: "test-model" }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  assert.deepEqual(result.topics, [
    { topic: "Coding", tokens: 100, percentage: 66.7 },
    { topic: "Writing", tokens: 50, percentage: 33.3 },
  ]);
  assert.deepEqual(result.sessionSummaries, [
    { sessionId: "coding", summary: "Building and testing a React component", topic: "Coding" },
    { sessionId: "writing", summary: "Drafting a warm launch email", topic: "Writing" },
  ]);
  const analyzed = { stats: { topics: [] } };
  applySessionTopicJudgment(analyzed, result);
  assert.deepEqual(analyzed.stats.topics, result.topics);
});

test("maps low-confidence classifications to Other and rejects missing IDs", () => {
  const bundle = buildSessionTopicCandidates(sessions);
  assert.deepEqual(extractSessionTopicSelection({ classifications: [
    { candidate_id: "session-topic-1", topic: "Coding", confidence: 0.4, summary: "Building and testing a React component" },
    { candidate_id: "session-topic-2", topic: "Writing", confidence: 0.9, summary: "Drafting a warm launch email" },
  ] }, bundle.candidates), { classifications: [
    { candidate_id: "session-topic-1", topic: "Other", confidence: 0.4, summary: "Building and testing a React component" },
    { candidate_id: "session-topic-2", topic: "Writing", confidence: 0.9, summary: "Drafting a warm launch email" },
  ] });
  assert.equal(extractSessionTopicSelection({ classifications: [{ candidate_id: "session-topic-1", topic: "Coding", confidence: 0.9, summary: "Building a React component" }] }, bundle.candidates), null);
});
