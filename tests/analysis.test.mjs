import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { discoverSessions, discoverAllSessions, defaultDateRange, sessionsInDefaultWindow, readRecords } from "../server/discovery.mjs";
import { analyzeSessions, makeDonationPreview } from "../server/analysis.mjs";
import { redactText, safeEvidenceText } from "../server/privacy.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "projects");
const codexRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "codex-sessions");

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
  assert.deepEqual(report.stats.agents.map(({ name, count, percentage }) => ({ name, count, percentage })), [
    { name: "Claude Code", count: 3, percentage: 100 },
    { name: "Codex", count: 0, percentage: 0 },
  ]);
  const kinds = new Set(report.findings.map((f) => f.kind));
  assert.ok(kinds.has("verification"));
  assert.ok(kinds.has("correction"));
  assert.ok(kinds.has("repetition"));
  assert.ok(kinds.has("clarification"));
  assert.ok(kinds.has("scope"));
  assert.ok(report.findings.every((f) => f.method && f.confidence.score && f.evidence.lines.length));
});

test("discovers and normalizes Claude Code and Codex sessions together", () => {
  const catalog = discoverAllSessions({ claudeRoot: root, codexRoots: [codexRoot] });
  assert.equal(catalog.sessions.length, 4);
  assert.deepEqual([...new Set(catalog.sessions.map((session) => session.agent))].sort(), ["claude", "codex"]);
  assert.ok(catalog.sessions.every((session) => !("file" in session)));
  const entries = [...catalog.index].map(([sessionId, session]) => ({ sessionId, agent: session.agent, records: readRecords(session.file, session.agent) }));
  const normalizedCodex = entries.find((entry) => entry.agent === "codex");
  assert.ok(!JSON.stringify(normalizedCodex).includes("synthetic build passed"));
  const report = analyzeSessions(entries);
  assert.equal(report.stats.sessions, 4);
  assert.equal(report.stats.tokens, 7500);
  assert.equal(report.stats.toolCalls, 9);
  assert.deepEqual(report.stats.agents.map(({ name, count, percentage }) => ({ name, count, percentage })), [
    { name: "Claude Code", count: 3, percentage: 75 },
    { name: "Codex", count: 1, percentage: 25 },
  ]);
  assert.equal(report.stats.models[0].name, "Claude Opus 4.8");
  assert.equal(report.stats.models[1].name, "GPT-5.6 Sol");
  assert.ok(report.stats.estimatedCostUsd > 0);
});

test("averages human inputs and complete agent responses across tool-use records", () => {
  const report = analyzeSessions([{ sessionId: "word-lengths", records: [
    { type: "user", message: { content: "Please check this." } },
    { type: "assistant", message: { content: "I will check it now." } },
    { type: "assistant", message: { content: [{ type: "tool_use", name: "Read" }] } },
    { type: "user", isMeta: true, message: { content: [{ type: "tool_result", content: "ignored output" }] } },
    { type: "assistant", message: { content: "Everything looks good." } },
    { type: "user", message: { content: "Thanks." } },
    { type: "assistant", message: { content: "You are welcome." } },
  ] }]);
  assert.equal(report.stats.averageAgentResponseWords, 6);
  assert.equal(report.stats.averageUserInputWords, 2);
});

test("title-cases model families that are not hardcoded", () => {
  const report = analyzeSessions([{ sessionId: "new-model-family", records: [
    { type: "user", message: { content: "Hello" } },
    { type: "assistant", message: { model: "claude-fable-5", content: "Hi", usage: { input_tokens: 10, output_tokens: 5 } } },
  ] }]);
  assert.equal(report.stats.models[0].name, "Claude Fable 5");
});

test("uses an inclusive rolling 30-day default window", () => {
  const sessions = [{ startedAt: "2026-07-06T00:00:00.000Z" }, { startedAt: "2026-07-07T00:00:00.000Z" }, { startedAt: "2026-08-05T00:00:00.000Z" }];
  const range = defaultDateRange(sessions, { now: new Date("2026-08-05T12:00:00.000Z") });
  assert.deepEqual(range, { from: "2026-07-07", to: "2026-08-05", days: 30 });
  assert.deepEqual(sessionsInDefaultWindow(sessions, { now: new Date("2026-08-05T12:00:00.000Z") }), sessions.slice(1));
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
