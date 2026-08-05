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

test("requires five tokens and rejects dangling or predictably truncated endings", () => {
  const records = [
    "I will carefully inspect the build output before answering.",
    "I will carefully inspect the test output before answering.",
    "I will carefully inspect the log output before answering.",
  ].map((content) => ({ type: "assistant", message: { content } }));
  const candidates = buildPhraseCandidates([{ sessionId: "boundaries", records }]);
  assert.ok(candidates.length > 0);
  assert.ok(candidates.every((candidate) => candidate.phrase.split(" ").length >= 5));
  assert.equal(candidates.some((candidate) => candidate.phrase === "i will carefully inspect the"), false);
  assert.equal(candidates.some((candidate) => candidate.phrase === "i will carefully inspect the build"), false);
});

test("treats punctuation-delimited clauses as complete phrase boundaries", () => {
  const records = Array.from({ length: 3 }, () => ({ type: "assistant", message: { content: "You're right to push back, and I'll inspect the evidence carefully." } }));
  const candidates = buildPhraseCandidates([{ sessionId: "clauses", records }]);
  assert.ok(candidates.some((candidate) => candidate.phrase === "you're right to push back"));
});

test("caps the judge payload at 100 phrase candidates", () => {
  const wordFor = (number) => `word${String.fromCharCode(97 + Math.floor(number / 26))}${String.fromCharCode(97 + number % 26)}`;
  const records = Array.from({ length: 120 }, (_, index) => ({ type: "assistant", message: { content: `Alpha beta gamma ${wordFor(index)} complete.` } }));
  const candidates = buildPhraseCandidates([{ sessionId: "many-candidates", records }], { maximumCandidates: 500 });
  assert.equal(candidates.length, 100);
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
      choices: [{ message: { content: JSON.stringify({ candidate_id: candidate.candidate_id }) } }],
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
  assert.equal(outbound.tools, undefined);
  assert.equal(outbound.max_tokens, undefined);
  assert.deepEqual(outbound.reasoning, { exclude: true });
  assert.equal(outbound.response_format.json_schema.strict, true);
  assert.deepEqual(outbound.response_format.json_schema.schema.properties.candidate_id.enum, [candidate.candidate_id]);
  assert.equal(result.provider, "OpenRouter");
  assert.ok(result.latencyMs >= 0);
});

test("accepts exactly one known candidate ID in ordinary response text without retrying", async () => {
  const candidate = buildPhraseCandidates(fixtureRecords())[0];
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return new Response(JSON.stringify({ choices: [{ message: { content: `My selection is ${candidate.candidate_id}.` } }] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const result = await judgePhraseCard([candidate], "test-key", { fetchImpl });
  assert.equal(calls, 1);
  assert.equal(result.phrase, candidate.phrase);
});

test("rejects ordinary text that mentions more than one supplied candidate ID", async () => {
  const first = buildPhraseCandidates(fixtureRecords())[0];
  const second = { ...first, candidate_id: "phrase-2", phrase: "another safe candidate" };
  const fetchImpl = async () => new Response(JSON.stringify({ choices: [{ message: { content: "Either phrase-1 or phrase-2." } }] }), { status: 200, headers: { "content-type": "application/json" } });
  await assert.rejects(judgePhraseCard([first, second], "test-key", { fetchImpl }), /exactly one supplied phrase candidate/);
});

test("times out a stalled phrase judge request instead of waiting indefinitely", async () => {
  const candidate = buildPhraseCandidates(fixtureRecords())[0];
  const fetchImpl = async () => { const error = new Error("stalled"); error.name = "TimeoutError"; throw error; };
  await assert.rejects(judgePhraseCard([candidate], "test-key", { fetchImpl, timeoutMs: 1_000 }), /timed out after 1 seconds/);
});
