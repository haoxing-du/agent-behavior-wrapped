import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFrustrationQuoteCandidates,
  buildOpenRouterFrustrationRequest,
  isShareSafeFrustrationQuote,
  judgeFrustrationQuoteViaRelay,
} from "../server/frustration-card.mjs";

const safeQuote = "Dude, come on, this is clearly not what I asked for!!!";

test("builds only redacted, share-safe user frustration candidates", () => {
  const candidates = buildFrustrationQuoteCandidates([{ sessionId: "synthetic", records: [
    { type: "user", message: { content: safeQuote } },
    { type: "assistant", message: { content: "Dude, this assistant message does not count." } },
    { type: "user", message: { content: "Come on, token=sk-test_12345678901234567890 should never leave." } },
    { type: "user", message: { content: "Perfect, thanks!" } },
  ] }]);
  assert.deepEqual(candidates, [{ candidate_id: "frustration-1", quote: safeQuote }]);
  const serialized = JSON.stringify(candidates);
  assert.equal(serialized.includes("sk-test"), false);
  assert.equal(serialized.includes("assistant message"), false);
});

test("uses a strict candidate-ID schema for the funniest quote judge", () => {
  const candidates = [{ candidate_id: "frustration-1", quote: safeQuote }];
  const request = buildOpenRouterFrustrationRequest(candidates);
  assert.deepEqual(request.reasoning, { effort: "none", exclude: true });
  assert.deepEqual(request.response_format.json_schema.schema.properties.candidate_id.enum, ["frustration-1"]);
  assert.equal(request.messages[0].content.includes("funniest supplied user call-out"), true);
  assert.equal(isShareSafeFrustrationQuote("Come on, see https://private.example"), false);
});

test("resolves the relay selection to the exact local quote", async () => {
  const candidate = { candidate_id: "frustration-1", quote: safeQuote };
  let outbound;
  const result = await judgeFrustrationQuoteViaRelay([candidate], {
    endpoint: "https://relay.example/v1/frustration-quote",
    clientId: "0123456789abcdef0123456789abcdef",
    fetchImpl: async (_url, init) => {
      outbound = JSON.parse(init.body);
      return new Response(JSON.stringify({ candidate_id: "frustration-1", quote: "invented quote" }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  assert.deepEqual(outbound, { candidates: [candidate] });
  assert.equal(result.quote, safeQuote);
  assert.equal(result.provider, "OpenRouter via Behavior Wrapped relay");
});
