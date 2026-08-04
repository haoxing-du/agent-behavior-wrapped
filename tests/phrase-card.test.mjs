import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { discoverSessions, readRecords } from "../server/discovery.mjs";
import { buildPhraseCandidates, OPENROUTER_MODEL, judgePhraseCard } from "../server/phrase-card.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "projects");

function fixtureRecords() {
  const catalog = discoverSessions(root);
  return [...catalog.index].map(([sessionId, session]) => ({ sessionId, records: readRecords(session.file) }));
}

test("counts exact, repeated assistant phrases without retaining transcript text", () => {
  const candidates = buildPhraseCandidates(fixtureRecords());
  const phrase = candidates.find((candidate) => candidate.phrase === "let me check that carefully");
  assert.deepEqual(phrase && { occurrences: phrase.occurrences, sessions: phrase.distinct_sessions }, { occurrences: 3, sessions: 3 });
  const serialized = JSON.stringify(candidates);
  assert.ok(!serialized.includes("demo.person@example.com"));
  assert.ok(!serialized.includes("sk-test_demo"));
  assert.ok(!serialized.includes("tool_result"));
});

test("keeps safe single-occurrence candidates when a small selection has no repeats", () => {
  const candidates = buildPhraseCandidates([{
    sessionId: "tiny-session",
    records: [{ type: "assistant", message: { content: "I will verify the change before calling it complete." } }],
  }]);
  assert.ok(candidates.length > 0);
  assert.equal(candidates[0].occurrences, 1);
  assert.equal(candidates[0].distinct_sessions, 1);
});

test("resolves Nemotron's candidate ID locally instead of accepting invented wording or counts", async () => {
  const candidate = buildPhraseCandidates(fixtureRecords())[0];
  let outbound;
  let requestUrl;
  let authorization;
  const fetchImpl = async (url, init) => {
    requestUrl = url;
    authorization = init.headers.authorization;
    outbound = JSON.parse(init.body);
    return new Response(JSON.stringify({
      model: OPENROUTER_MODEL,
      choices: [{ message: { tool_calls: [{ type: "function", function: { name: "select_phrase_card", arguments: JSON.stringify({ candidate_id: candidate.candidate_id, interestingness_score: 84, rationale: "Recognizable agent habit." }) } }] } }],
      usage: { prompt_tokens: 12, completion_tokens: 7 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const result = await judgePhraseCard([candidate], "test-key-never-serialized", { fetchImpl });
  assert.equal(result.phrase, candidate.phrase);
  assert.equal(result.occurrences, candidate.occurrences);
  assert.equal(result.distinctSessions, candidate.distinct_sessions);
  assert.equal(JSON.stringify(outbound).includes("test-key-never-serialized"), false);
  assert.equal(requestUrl, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(authorization, "Bearer test-key-never-serialized");
  assert.equal(outbound.model, OPENROUTER_MODEL);
  assert.equal(result.provider, "OpenRouter");
  assert.ok(result.latencyMs >= 0);
});
