import assert from "node:assert/strict";
import test from "node:test";
import {
  applyInteractionToneJudgment,
  buildInteractionToneCandidates,
  buildOpenRouterInteractionToneRequest,
  extractInteractionToneSelection,
  judgeInteractionToneViaRelay,
} from "../server/interaction-tone.mjs";

const records = [{ sessionId: "synthetic", records: [
  { type: "user", message: { content: "Dude, this is amazing!" } },
  { type: "user", message: { content: "Dude, this is amazing!" } },
  { type: "user", message: { content: "Thank you, this is exactly what I needed." } },
  { type: "assistant", message: { content: "Thanks should not count from the assistant." } },
  { type: "user", message: { content: "Come on, token=sk-test_12345678901234567890 should never leave." } },
] }];

test("builds deduplicated, redacted interaction candidates with occurrence counts", () => {
  const candidates = buildInteractionToneCandidates(records);
  assert.ok(candidates.some((candidate) => candidate.text === "Dude, this is amazing!" && candidate.occurrences === 2));
  assert.ok(candidates.some((candidate) => candidate.text === "Thank you, this is exactly what I needed."));
  assert.equal(JSON.stringify(candidates).includes("sk-test"), false);
  assert.equal(JSON.stringify(candidates).includes("assistant"), false);
});

test("builds a strict interaction classifier request", () => {
  const candidates = buildInteractionToneCandidates(records);
  const request = buildOpenRouterInteractionToneRequest(candidates);
  assert.deepEqual(request.reasoning, { effort: "none", exclude: true });
  assert.equal(request.seed, 1729);
  assert.equal(request.messages[0].content.includes("word \"dude\" used warmly"), true);
  assert.equal(request.messages[0].content.includes("Return exactly one classification for every candidate"), true);
  const classifications = request.response_format.json_schema.schema.properties.classifications;
  assert.equal(classifications.minItems, candidates.length);
  assert.equal(classifications.maxItems, candidates.length);
  assert.deepEqual(classifications.items.properties.candidate_id.enum, candidates.map((candidate) => candidate.candidate_id));
});

test("resolves judged IDs to local counts and the exact local quote", async () => {
  const candidates = buildInteractionToneCandidates(records);
  const dude = candidates.find((candidate) => candidate.text.startsWith("Dude"));
  const thanks = candidates.find((candidate) => candidate.text.startsWith("Thank"));
  const selection = {
    frustrated: [{ candidate_id: dude.candidate_id, confidence: 0.91 }],
    grateful: [{ candidate_id: thanks.candidate_id, confidence: 0.96 }],
    funniest_frustration_candidate_id: dude.candidate_id,
  };
  const result = await judgeInteractionToneViaRelay(candidates, {
    endpoint: "https://relay.example/v1/interaction-tone",
    clientId: "0123456789abcdef0123456789abcdef",
    fetchImpl: async () => new Response(JSON.stringify({ ...selection, model: "test-model", invented_quote: "not trusted" }), { status: 200, headers: { "content-type": "application/json" } }),
  });
  assert.equal(result.frustratedMessages, 2);
  assert.equal(result.gratefulMessages, 1);
  assert.equal(result.frustrationQuote, dude.text);
  assert.equal(result.provider, "OpenRouter via Behavior Wrapped relay");
  const analyzed = { stats: { interactionTone: { analyzedMessages: 3 } } };
  applyInteractionToneJudgment(analyzed, result);
  assert.equal(analyzed.stats.interactionTone.frustratedMessages, 2);
  assert.equal(analyzed.interactionCard.frustrationQuote, dude.text);
});

test("drops invented IDs and low-confidence classifications", () => {
  const candidates = buildInteractionToneCandidates(records);
  assert.deepEqual(extractInteractionToneSelection({ frustrated: [{ candidate_id: "interaction-999", confidence: 0.9 }], grateful: [], funniest_frustration_candidate_id: "none" }, candidates), {
    frustrated: [], grateful: [], funniest_frustration_candidate_id: "none",
  });
  assert.deepEqual(extractInteractionToneSelection({ frustrated: [{ candidate_id: candidates[0].candidate_id, confidence: 0.5 }], grateful: [], funniest_frustration_candidate_id: candidates[0].candidate_id }, candidates), {
    frustrated: [], grateful: [], funniest_frustration_candidate_id: "none",
  });
});

test("requires one ordered binary verdict for every candidate", () => {
  const candidates = buildInteractionToneCandidates(records);
  const complete = candidates.map((candidate, index) => ({
    candidate_id: candidate.candidate_id,
    frustrated: index === 0,
    grateful: index === 1,
  }));
  const selection = extractInteractionToneSelection({ classifications: complete, funniest_frustration_candidate_id: "none" }, candidates);
  assert.deepEqual(selection.frustrated, [{ candidate_id: candidates[0].candidate_id, confidence: 1 }]);
  assert.deepEqual(selection.grateful, [{ candidate_id: candidates[1].candidate_id, confidence: 1 }]);
  assert.equal(extractInteractionToneSelection({ classifications: complete.slice(1), funniest_frustration_candidate_id: "none" }, candidates), null);
  assert.equal(extractInteractionToneSelection({ classifications: [...complete].reverse(), funniest_frustration_candidate_id: "none" }, candidates), null);
});

test("accepts fenced JSON and drops malformed items instead of failing the whole classification", () => {
  const candidates = [{ candidate_id: "interaction-1", text: "Dude, this is not what I asked for!", occurrences: 1 }];
  const body = { choices: [{ message: { content: "```json\n{\"frustrated\":[{\"candidate_id\":\"interaction-1\",\"confidence\":0.9},{\"candidate_id\":\"invented\",\"confidence\":0.99}],\"grateful\":[],\"funniest_frustration_candidate_id\":\"interaction-1\"}\n```" } }] };
  assert.deepEqual(extractInteractionToneSelection(body, candidates), {
    frustrated: [{ candidate_id: "interaction-1", confidence: 0.9 }],
    grateful: [],
    funniest_frustration_candidate_id: "interaction-1",
  });
});
