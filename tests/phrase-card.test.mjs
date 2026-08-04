import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { discoverSessions, readRecords } from "../server/discovery.mjs";
import { buildPhraseCandidates, HAIKU_MODEL, judgePhraseCard } from "../server/phrase-card.mjs";

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

test("resolves Haiku's candidate ID locally instead of accepting invented wording or counts", async () => {
  const candidate = buildPhraseCandidates(fixtureRecords())[0];
  let outbound;
  const fetchImpl = async (_url, init) => {
    outbound = JSON.parse(init.body);
    return new Response(JSON.stringify({
      model: HAIKU_MODEL,
      content: [{ type: "tool_use", name: "select_phrase_card", input: { candidate_id: candidate.candidate_id, interestingness_score: 84, rationale: "Recognizable agent habit." } }],
      usage: { input_tokens: 12, output_tokens: 7 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const result = await judgePhraseCard([candidate], "test-key-never-serialized", { fetchImpl });
  assert.equal(result.phrase, candidate.phrase);
  assert.equal(result.occurrences, candidate.occurrences);
  assert.equal(result.distinctSessions, candidate.distinct_sessions);
  assert.equal(JSON.stringify(outbound).includes("test-key-never-serialized"), false);
});
