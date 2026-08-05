import test from "node:test";
import assert from "node:assert/strict";
import { handleRequest, validateRelayPayload } from "../worker/phrase-judge-worker.mjs";
import { OPENROUTER_MODEL } from "../server/phrase-card.mjs";

const candidate = {
  candidate_id: "phrase-1",
  phrase: "let me check that carefully",
  occurrences: 4,
  distinct_sessions: 3,
  opening_rate: 0.5,
  start_boundary_rate: 0.75,
  end_boundary_rate: 1,
};

function relayRequest(body = { candidates: [candidate] }, headers = {}) {
  return new Request("https://relay.example/v1/phrase-card", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-behavior-wrapped-protocol": "1",
      "x-behavior-wrapped-client": "0123456789abcdef0123456789abcdef",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function env(rateLimitSuccess = true) {
  const limiter = { limit: async () => ({ success: rateLimitSuccess }) };
  return { OPENROUTER_API_KEY: "server-secret", CLIENT_RATE_LIMITER: limiter, GLOBAL_RATE_LIMITER: limiter };
}

test("worker accepts only the narrow redacted aggregate schema", () => {
  assert.deepEqual(validateRelayPayload({ candidates: [candidate] }), [candidate]);
  assert.equal(validateRelayPayload({ candidates: [{ ...candidate, phrase: "/Users/private/project" }] }), null);
  assert.equal(validateRelayPayload({ candidates: [{ ...candidate, extra: "not allowed" }] }), null);
  assert.equal(validateRelayPayload({ candidates: Array.from({ length: 101 }, () => candidate) }), null);
});

test("worker attaches the secret server-side and returns only a validated candidate ID", async () => {
  let authorization;
  let upstreamBody;
  const fetchImpl = async (_url, init) => {
    authorization = init.headers.authorization;
    upstreamBody = JSON.parse(init.body);
    return new Response(JSON.stringify({
      model: OPENROUTER_MODEL,
      choices: [{ message: { content: JSON.stringify({ candidate_id: "phrase-1" }) } }],
      usage: { prompt_tokens: 22, completion_tokens: 3 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const response = await handleRequest(relayRequest(), env(), fetchImpl);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(authorization, "Bearer server-secret");
  assert.equal(upstreamBody.model, OPENROUTER_MODEL);
  assert.deepEqual(upstreamBody.response_format.json_schema.schema.properties.candidate_id.enum, ["phrase-1"]);
  assert.deepEqual(body, {
    candidate_id: "phrase-1",
    model: OPENROUTER_MODEL,
    usage: { prompt_tokens: 22, completion_tokens: 3, total_tokens: 0 },
  });
  assert.equal(JSON.stringify(body).includes("server-secret"), false);
  assert.equal(JSON.stringify(body).includes(candidate.phrase), false);
});

test("worker rate limits before calling OpenRouter", async () => {
  let called = false;
  const response = await handleRequest(relayRequest(), env(false), async () => { called = true; });
  assert.equal(response.status, 429);
  assert.equal(called, false);
});
