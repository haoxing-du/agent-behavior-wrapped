import test from "node:test";
import assert from "node:assert/strict";
import { handleRequest, validateFrustrationRelayPayload, validateInteractionToneRelayPayload, validateRelayPayload, validateSessionTopicRelayPayload, validateWorkaroundRelayPayload } from "../worker/phrase-judge-worker.mjs";
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

function relayRequest(body = { candidates: [candidate] }, headers = {}, url = "https://relay.example/v1/phrase-card") {
  return new Request(url, {
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

const frustrationCandidate = { candidate_id: "frustration-1", quote: "Dude, come on, this is not what I asked for!" };

function frustrationRequest(body = { candidates: [frustrationCandidate] }) {
  return new Request("https://relay.example/v1/frustration-quote", {
    method: "POST",
    headers: { "content-type": "application/json", "x-behavior-wrapped-protocol": "1", "x-behavior-wrapped-client": "0123456789abcdef0123456789abcdef" },
    body: JSON.stringify(body),
  });
}

const interactionCandidate = { candidate_id: "interaction-1", text: "Dude, this is not what I asked for!", occurrences: 2 };

function interactionRequest(body = { candidates: [interactionCandidate] }) {
  return new Request("https://relay.example/v1/interaction-tone", {
    method: "POST",
    headers: { "content-type": "application/json", "x-behavior-wrapped-protocol": "1", "x-behavior-wrapped-client": "0123456789abcdef0123456789abcdef" },
    body: JSON.stringify(body),
  });
}

const sessionTopicCandidate = { candidate_id: "session-topic-1", opening_messages: ["Implement a local behavior report.", "Now add tests."] };

function sessionTopicRequest(body = { candidates: [sessionTopicCandidate] }) {
  return new Request("https://relay.example/v1/session-topics", {
    method: "POST",
    headers: { "content-type": "application/json", "x-behavior-wrapped-protocol": "1", "x-behavior-wrapped-client": "0123456789abcdef0123456789abcdef" },
    body: JSON.stringify(body),
  });
}

const workaroundChunk = {
  trajectory_id: "trajectory-1",
  chunk_id: "trajectory-1-chunk-1",
  start_event: 1,
  end_event: 4,
  part_index: 1,
  part_count: 1,
  events: [
    { event_id: "trajectory-1-event-1", role: "assistant", kind: "tool_use", text: "Tool use: Bash (delete)", action: "delete", method: "shell" },
    { event_id: "trajectory-1-event-2", role: "tool", kind: "tool_result", text: "Tool result: operation not permitted", action: null, method: null },
    { event_id: "trajectory-1-event-3", role: "assistant", kind: "assistant_text", text: "I can move the files to an archive instead.", action: null, method: null },
    { event_id: "trajectory-1-event-4", role: "assistant", kind: "tool_use", text: "Tool use: Bash (move)", action: "move", method: "shell" },
  ],
};

function workaroundRequest(body = { chunks: [workaroundChunk] }) {
  return new Request("https://relay.example/v1/instrumental-workarounds", {
    method: "POST",
    headers: { "content-type": "application/json", "x-behavior-wrapped-protocol": "1", "x-behavior-wrapped-client": "0123456789abcdef0123456789abcdef" },
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

test("worker retries malformed structured output for every non-batched judge shape", async () => {
  const cases = [
    {
      name: "phrase",
      request: relayRequest(),
      content: { candidate_id: "phrase-1" },
      expectedKey: "candidate_id",
    },
    {
      name: "session topics",
      request: sessionTopicRequest(),
      content: { classifications: [{ candidate_id: "session-topic-1", topic: "Coding", confidence: 0.93, summary: "Building a local behavior report" }] },
      expectedKey: "classifications",
    },
    {
      name: "workarounds",
      request: workaroundRequest(),
      content: { verdicts: [{
        trajectory_id: "trajectory-1",
        original_method_event_id: "trajectory-1-event-1",
        blocker_event_id: "trajectory-1-event-2",
        alternative_method_event_id: "trajectory-1-event-4",
        decision: "confirmed",
        reason: "Moving the files removed them from the original location.",
        summary: "It moved the files after deletion was blocked.",
        disclosure: "disclosed and authorized",
        confidence: "high",
      }] },
      expectedKey: "confirmed",
    },
  ];

  for (const item of cases) {
    let calls = 0;
    const response = await handleRequest(item.request, env(), async () => {
      calls += 1;
      const content = calls === 1 ? {} : item.content;
      return new Response(JSON.stringify({ model: OPENROUTER_MODEL, choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200, headers: { "content-type": "application/json" } });
    });
    assert.equal(response.status, 200, item.name);
    assert.equal(calls, 2, item.name);
    assert.equal(Object.hasOwn(await response.json(), item.expectedKey), true, item.name);
  }
});

test("worker retries a transient provider error before returning a valid judge result", async () => {
  let calls = 0;
  const response = await handleRequest(relayRequest(), env(), async () => {
    calls += 1;
    if (calls === 1) return new Response(JSON.stringify({ error: { code: 503, message: "Provider temporarily unavailable" } }), { status: 503, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify({ model: OPENROUTER_MODEL, choices: [{ message: { content: JSON.stringify({ candidate_id: "phrase-1" }) } }] }), { status: 200, headers: { "content-type": "application/json" } });
  });
  assert.equal(response.status, 200);
  assert.equal(calls, 2);
  assert.equal((await response.json()).candidate_id, "phrase-1");
});

test("worker returns privacy-safe diagnostics after both structured-output attempts fail", async () => {
  let calls = 0;
  const response = await handleRequest(relayRequest(), env(), async () => {
    calls += 1;
    return new Response(JSON.stringify({ model: OPENROUTER_MODEL, choices: [{ message: { content: "{}" } }] }), { status: 200, headers: { "content-type": "application/json" } });
  });
  const body = await response.json();
  assert.equal(response.status, 502);
  assert.equal(calls, 2);
  assert.equal(body.diagnostic.code, "invalid_items");
  assert.equal(JSON.stringify(body).includes(candidate.phrase), false);
  assert.equal(JSON.stringify(body).includes("server-secret"), false);
});

test("worker redirects human pages to the canonical domain", async () => {
  const legacyResponse = await handleRequest(
    new Request("https://agent-behavior-wrapped-judge.haoxingdu.workers.dev/w/shareSafe1234"),
    env(),
  );
  assert.equal(legacyResponse.status, 308);
  assert.equal(legacyResponse.headers.get("location"), "https://behaviorwrapped.com/w/shareSafe1234");

  const wwwResponse = await handleRequest(new Request("https://www.behaviorwrapped.com/"), env());
  assert.equal(wwwResponse.status, 308);
  assert.equal(wwwResponse.headers.get("location"), "https://behaviorwrapped.com/");

  const policyResponse = await handleRequest(new Request("https://www.behaviorwrapped.com/data-policy"), env());
  assert.equal(policyResponse.status, 308);
  assert.equal(policyResponse.headers.get("location"), "https://behaviorwrapped.com/data-policy");
});

test("worker serves the landing page from assets on the canonical domain", async () => {
  let assetUrl;
  const response = await handleRequest(new Request("https://behaviorwrapped.com/"), {
    ...env(),
    ASSETS: {
      fetch(request) {
        assetUrl = request.url;
        return new Response("landing page");
      },
    },
  });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "landing page");
  assert.equal(assetUrl, "https://behaviorwrapped.com/");
});

test("worker keeps legacy API clients working without a redirect", async () => {
  const request = relayRequest(
    undefined,
    {},
    "https://agent-behavior-wrapped-judge.haoxingdu.workers.dev/v1/phrase-card",
  );
  const response = await handleRequest(request, env(), async () => new Response(JSON.stringify({
    model: OPENROUTER_MODEL,
    choices: [{ message: { content: JSON.stringify({ candidate_id: "phrase-1" }) } }],
  }), { status: 200, headers: { "content-type": "application/json" } }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).candidate_id, "phrase-1");
});

test("worker validates and judges only narrow share-safe frustration quotes", async () => {
  assert.deepEqual(validateFrustrationRelayPayload({ candidates: [frustrationCandidate] }), [frustrationCandidate]);
  assert.equal(validateFrustrationRelayPayload({ candidates: [{ ...frustrationCandidate, quote: "See https://private.example" }] }), null);
  let upstreamBody;
  const response = await handleRequest(frustrationRequest(), env(), async (_url, init) => {
    upstreamBody = JSON.parse(init.body);
    return new Response(JSON.stringify({ model: OPENROUTER_MODEL, choices: [{ message: { content: "{\"candidate_id\":\"frustration-1\"}" } }] }), { status: 200, headers: { "content-type": "application/json" } });
  });
  assert.equal(response.status, 200);
  assert.deepEqual(upstreamBody.provider, {
    data_collection: "deny",
    zdr: true,
    order: ["Azure"],
    allow_fallbacks: false,
  });
  assert.deepEqual(upstreamBody.response_format.json_schema.schema.properties.candidate_id.enum, ["frustration-1"]);
  assert.equal(upstreamBody.messages[0].content.includes("funniest supplied user call-out"), true);
  assert.deepEqual(await response.json(), { candidate_id: "frustration-1", model: OPENROUTER_MODEL, usage: null });
});

test("worker validates interaction candidates and returns classifications without excerpts", async () => {
  assert.deepEqual(validateInteractionToneRelayPayload({ candidates: [interactionCandidate] }), [interactionCandidate]);
  assert.equal(validateInteractionToneRelayPayload({ candidates: [{ ...interactionCandidate, text: "See https://private.example" }] }), null);
  let upstreamBody;
  const upstreamSelection = {
    classifications: [{ candidate_id: "interaction-1", frustrated: true, grateful: false }],
    funniest_frustration_candidate_id: "interaction-1",
  };
  const expectedSelection = {
    frustrated: [{ candidate_id: "interaction-1", confidence: 1 }],
    grateful: [],
    funniest_frustration_candidate_id: "interaction-1",
  };
  const response = await handleRequest(interactionRequest(), env(), async (_url, init) => {
    upstreamBody = JSON.parse(init.body);
    return new Response(JSON.stringify({ model: OPENROUTER_MODEL, choices: [{ message: { content: JSON.stringify(upstreamSelection) } }] }), { status: 200, headers: { "content-type": "application/json" } });
  });
  assert.equal(response.status, 200);
  assert.equal(upstreamBody.messages[0].content.includes("Evaluate every supplied excerpt independently"), true);
  assert.deepEqual(await response.json(), { ...expectedSelection, model: OPENROUTER_MODEL, usage: null });
});

test("worker always sends repeated interaction-tone requests upstream", async () => {
  const originalCaches = Object.getOwnPropertyDescriptor(globalThis, "caches");
  let cacheReads = 0;
  let upstreamCalls = 0;
  Object.defineProperty(globalThis, "caches", {
    configurable: true,
    value: { default: { match: async () => { cacheReads++; return null; }, put: async () => {} } },
  });
  const selection = {
    classifications: [{ candidate_id: "interaction-1", frustrated: true, grateful: false }],
    funniest_frustration_candidate_id: "interaction-1",
  };
  try {
    const fetchImpl = async () => {
      upstreamCalls++;
      return new Response(JSON.stringify({ model: OPENROUTER_MODEL, choices: [{ message: { content: JSON.stringify(selection) } }] }), { status: 200, headers: { "content-type": "application/json" } });
    };
    for (let run = 0; run < 2; run++) {
      const response = await handleRequest(interactionRequest(), env(), fetchImpl);
      assert.equal(response.status, 200);
    }
  } finally {
    if (originalCaches) Object.defineProperty(globalThis, "caches", originalCaches);
    else delete globalThis.caches;
  }
  assert.equal(cacheReads, 0);
  assert.equal(upstreamCalls, 2);
});

test("worker retries one malformed interaction-tone completion", async () => {
  let calls = 0;
  const selection = {
    classifications: [{ candidate_id: "interaction-1", frustrated: true, grateful: false }],
    funniest_frustration_candidate_id: "interaction-1",
  };
  const response = await handleRequest(interactionRequest(), env(), async () => {
    calls++;
    const content = calls === 1 ? "" : JSON.stringify(selection);
    return new Response(JSON.stringify({ model: OPENROUTER_MODEL, choices: [{ message: { content } }] }), { status: 200, headers: { "content-type": "application/json" } });
  });
  assert.equal(calls, 2);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).frustrated, [{ candidate_id: "interaction-1", confidence: 1 }]);
});

test("worker batches a full interaction corpus and restores the original candidate IDs", async () => {
  const candidates = Array.from({ length: 81 }, (_, index) => ({
    candidate_id: `interaction-${index + 1}`,
    text: `Dude, candidate message number ${index + 1} was wrong.`,
    occurrences: 1,
  }));
  const upstreamBodies = [];
  const response = await handleRequest(interactionRequest({ candidates }), env(), async (_url, init) => {
    const requestBody = JSON.parse(init.body);
    upstreamBodies.push(requestBody);
    const supplied = JSON.parse(requestBody.messages[1].content.split("\n\n")[1]);
    const classifications = supplied.map((item, index) => ({
      candidate_id: item.candidate_id,
      frustrated: index === supplied.length - 1,
      grateful: false,
    }));
    return new Response(JSON.stringify({
      model: OPENROUTER_MODEL,
      choices: [{ message: { content: JSON.stringify({ classifications, funniest_frustration_candidate_id: classifications.at(-1).candidate_id }) } }],
      usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  assert.equal(response.status, 200);
  assert.equal(upstreamBodies.length, 3);
  assert.deepEqual(upstreamBodies.map((body) => body.response_format.json_schema.schema.properties.classifications.maxItems), [30, 30, 21]);
  assert.deepEqual(await response.json(), {
    frustrated: [
      { candidate_id: "interaction-30", confidence: 1 },
      { candidate_id: "interaction-60", confidence: 1 },
      { candidate_id: "interaction-81", confidence: 1 },
    ],
    grateful: [],
    funniest_frustration_candidate_id: "interaction-30",
    model: OPENROUTER_MODEL,
    usage: { prompt_tokens: 30, completion_tokens: 6, total_tokens: 36 },
  });
});

test("worker validates session openings and returns only topic classifications", async () => {
  assert.deepEqual(validateSessionTopicRelayPayload({ candidates: [sessionTopicCandidate] }), [sessionTopicCandidate]);
  assert.equal(validateSessionTopicRelayPayload({ candidates: [{ ...sessionTopicCandidate, opening_messages: ["See https://private.example"] }] }), null);
  const classifications = [{ candidate_id: "session-topic-1", topic: "Coding", confidence: 0.93, summary: "Building a local behavior report" }];
  let upstreamBody;
  const response = await handleRequest(sessionTopicRequest(), env(), async (_url, init) => {
    upstreamBody = JSON.parse(init.body);
    return new Response(JSON.stringify({ model: OPENROUTER_MODEL, choices: [{ message: { content: JSON.stringify({ classifications }) } }] }), { status: 200, headers: { "content-type": "application/json" } });
  });
  assert.equal(response.status, 200);
  assert.equal(upstreamBody.messages[0].content.includes("primary purpose"), true);
  assert.deepEqual(await response.json(), { classifications, model: OPENROUTER_MODEL, usage: null });
});

test("worker validates complete redacted trajectory chunks and returns only structured workaround references", async () => {
  assert.deepEqual(validateWorkaroundRelayPayload({ chunks: [workaroundChunk] }), [workaroundChunk]);
  assert.equal(validateWorkaroundRelayPayload({ chunks: [{ ...workaroundChunk, events: [{ ...workaroundChunk.events[0], text: "See /Users/private/project" }, ...workaroundChunk.events.slice(1)] }] }), null);
  const verdicts = [{
    trajectory_id: "trajectory-1",
    original_method_event_id: "trajectory-1-event-1",
    blocker_event_id: "trajectory-1-event-2",
    alternative_method_event_id: "trajectory-1-event-4",
    decision: "confirmed",
    reason: "Moving the files removed them from the original location.",
    summary: "It moved the files after deletion was blocked.",
    disclosure: "disclosed and authorized",
    confidence: "high",
  }];
  const selection = { confirmed: [{
    trajectory_id: "trajectory-1",
    original_method_event_id: "trajectory-1-event-1",
    blocker_event_id: "trajectory-1-event-2",
    alternative_method_event_id: "trajectory-1-event-4",
    same_effect_reason: "Moving the files removed them from the original location.",
    workaround_summary: "The agent moved files elsewhere after deletion was blocked.",
    disclosure: "disclosed and authorized",
    confidence: "high",
  }], borderline: [] };
  let upstreamBody;
  const response = await handleRequest(workaroundRequest(), env(), async (_url, init) => {
    upstreamBody = JSON.parse(init.body);
    return new Response(JSON.stringify({ model: OPENROUTER_MODEL, choices: [{ message: { content: JSON.stringify({ verdicts }) } }] }), { status: 200, headers: { "content-type": "application/json" } });
  });
  assert.equal(response.status, 200);
  assert.equal(upstreamBody.messages[0].content.includes("instrumental workaround behavior"), true);
  assert.deepEqual(await response.json(), { ...selection, model: OPENROUTER_MODEL, usage: null });
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
  assert.equal(upstreamBody.max_tokens, 32);
  assert.deepEqual(upstreamBody.reasoning, { effort: "none", exclude: true });
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

test("worker returns privacy-safe upstream diagnostics without credentials or candidates", async () => {
  const response = await handleRequest(relayRequest(), env(), async () => new Response(JSON.stringify({ error: { code: 429, message: "Provider rate limit reached" } }), { status: 429, headers: { "content-type": "application/json" } }));
  const body = await response.json();
  assert.equal(response.status, 502);
  assert.deepEqual(body.diagnostic, { code: "upstream_http", status: 429, upstream_code: "429", upstream_message: "Provider rate limit reached" });
  assert.equal(JSON.stringify(body).includes("server-secret"), false);
  assert.equal(JSON.stringify(body).includes(candidate.phrase), false);
});
