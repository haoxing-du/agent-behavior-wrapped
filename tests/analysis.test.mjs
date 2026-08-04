import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { discoverSessions, readRecords } from "../server/discovery.mjs";
import { analyzeSessions, makeDonationPreview } from "../server/analysis.mjs";
import { redactText, safeEvidenceText } from "../server/privacy.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "projects");

test("discovers synthetic projects without exposing source file paths", () => {
  const catalog = discoverSessions(root);
  assert.equal(catalog.rootAvailable, true);
  assert.equal(catalog.projects.length, 2);
  assert.equal(catalog.sessions.length, 3);
  assert.equal("file" in catalog.sessions[0], false);
  assert.ok(catalog.index.get(catalog.sessions[0].id).file.endsWith(".jsonl"));
});

test("computes deterministic stats and transparent behavior findings", () => {
  const catalog = discoverSessions(root);
  const records = [...catalog.index].map(([sessionId, session]) => ({ sessionId, records: readRecords(session.file) }));
  const report = analyzeSessions(records);
  assert.equal(report.stats.sessions, 3);
  assert.equal(report.stats.activeDays, 3);
  assert.equal(report.stats.interruptions, 1);
  assert.ok(report.stats.toolCalls >= 6);
  assert.equal(report.stats.tokens, 5500);
  const kinds = new Set(report.findings.map((f) => f.kind));
  assert.ok(kinds.has("verification"));
  assert.ok(kinds.has("correction"));
  assert.ok(kinds.has("repetition"));
  assert.ok(kinds.has("clarification"));
  assert.ok(kinds.has("scope"));
  assert.ok(report.findings.every((f) => f.method && f.confidence.score && f.evidence.lines.length));
});

test("redacts likely secrets and PII, strips code from evidence", () => {
  const sample = "Contact Ada at ada@example.com with token=sk-test_12345678901234567890 from /Users/ada/project";
  const result = redactText(sample);
  assert.ok(!result.text.includes("ada@example.com"));
  assert.ok(!result.text.includes("sk-test"));
  assert.ok(!result.text.includes("/Users/ada"));
  assert.ok(result.detections.length >= 3);
  assert.equal(safeEvidenceText("Here is ```private code```"), "Here is [CODE OMITTED]");
});

test("donation preview contains only message text, with code and secrets removed", () => {
  const catalog = discoverSessions(root);
  const entries = [...catalog.index].map(([sessionId, session]) => ({ sessionId, records: readRecords(session.file) }));
  const labels = new Map(catalog.sessions.map((s, index) => [s.id, { label: `Session ${index + 1}` }]));
  const bundle = makeDonationPreview(entries, labels);
  const serialized = JSON.stringify(bundle);
  assert.equal(bundle.createdLocally, true);
  assert.ok(bundle.detectionCount >= 2);
  assert.ok(!serialized.includes("demo.person@example.com"));
  assert.ok(!serialized.includes("sk-test_demo"));
  assert.ok(!serialized.includes("tool_result"));
});
