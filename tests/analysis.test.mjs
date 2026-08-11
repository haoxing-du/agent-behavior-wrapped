import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { discoverSessions, discoverAllSessions, discoverAllSessionsAsync, defaultDateRange, sessionsInDefaultWindow, readRecords, readRecordsAsync } from "../server/discovery.mjs";
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

test("async discovery indexes complete sessions beyond the former one-megabyte sample", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "behavior-wrapped-large-"));
  const project = path.join(directory, "large-project");
  fs.mkdirSync(project);
  const file = path.join(project, "large.jsonl");
  const records = [
    { type: "user", timestamp: "2026-08-01T00:00:00.000Z", message: { content: "Start" } },
    { type: "assistant", timestamp: "2026-08-01T00:00:01.000Z", message: { content: "x".repeat(1_100_000) } },
    { type: "user", timestamp: "2026-08-02T00:00:00.000Z", message: { content: "Finish" } },
  ];
  fs.writeFileSync(file, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
  const catalog = await discoverAllSessionsAsync({ claudeRoot: directory, codexRoots: [], cache: false });
  assert.equal(catalog.sessions[0].recordCount, 3);
  assert.equal(catalog.sessions[0].promptCount, 2);
  assert.equal(catalog.sessions[0].endedAt, "2026-08-02T00:00:00.000Z");
  assert.equal((await readRecordsAsync(file)).length, 3);
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

test("normalizes structured Codex tool records into private-safe workaround evidence", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "behavior-wrapped-codex-"));
  const file = path.join(directory, "structured.jsonl");
  const records = [
    { timestamp: "2026-08-01T00:00:00.000Z", type: "turn_context", payload: { model: "gpt-5.6-sol" } },
    { timestamp: "2026-08-01T00:00:01.000Z", type: "response_item", payload: { type: "custom_tool_call", call_id: "delete-call", name: "exec", input: "const r = await tools.exec_command({cmd:\"rm -rf /Users/private/project/cache\"});" } },
    { timestamp: "2026-08-01T00:00:02.000Z", type: "response_item", payload: { type: "custom_tool_call_output", call_id: "delete-call", output: [{ type: "input_text", text: "Script failed" }, { type: "input_text", text: "Rejected: rm commands are not permitted. Private details follow." }] } },
    { timestamp: "2026-08-01T00:00:03.000Z", type: "response_item", payload: { type: "custom_tool_call", call_id: "edit-call", name: "exec", input: "text(await tools.apply_patch(patch))" } },
  ];
  fs.writeFileSync(file, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
  const normalized = readRecords(file, "codex");
  const blocks = normalized.flatMap((record) => record.message?.content || []);
  assert.equal(blocks.find((block) => block.type === "tool_use")?.action_hint, "delete");
  assert.equal(blocks.find((block) => block.type === "tool_use")?.method_hint, "shell");
  assert.equal(blocks.filter((block) => block.type === "tool_use")[1]?.action_hint, "edit");
  const result = blocks.find((block) => block.type === "tool_result");
  assert.equal(result.is_error, true);
  assert.equal(result.error_summary, "operation not permitted");
  assert.equal(JSON.stringify(normalized).includes("/Users/private"), false);
  assert.equal(JSON.stringify(normalized).includes("Private details"), false);
});

test("backfills forked Codex models without recounting inherited token totals", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "behavior-wrapped-codex-fork-"));
  const file = path.join(directory, "forked.jsonl");
  const records = [
    { timestamp: "2026-08-01T00:00:00.000Z", type: "session_meta", payload: { forked_from_id: "parent-session" } },
    { timestamp: "2026-08-01T00:00:01.000Z", type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Inherited response" }] } },
    { timestamp: "2026-08-01T00:00:02.000Z", type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 1000, output_tokens: 100, cached_input_tokens: 500 } } } },
    { timestamp: "2026-08-01T00:00:03.000Z", type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 1200, output_tokens: 150, cached_input_tokens: 600 } } } },
    { timestamp: "2026-08-01T00:00:04.000Z", type: "turn_context", payload: { model: "gpt-5.6-sol" } },
    { timestamp: "2026-08-01T00:00:05.000Z", type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 1400, output_tokens: 200, cached_input_tokens: 700 } } } },
  ];
  fs.writeFileSync(file, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);

  const normalized = readRecords(file, "codex");
  assert.equal(normalized.find((record) => record.type === "assistant")?.message.model, "gpt-5.6-sol");
  const usageRecords = normalized.filter((record) => record.message?.usage);
  assert.equal(usageRecords.length, 1);
  assert.deepEqual(usageRecords[0].message.usage, {
    input_tokens: 200,
    output_tokens: 50,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 100,
  });
  const report = analyzeSessions([{ sessionId: "forked", agent: "codex", records: normalized }]);
  assert.equal(report.stats.tokens, 350);
  assert.deepEqual(report.stats.models.map(({ name, tokens }) => ({ name, tokens })), [{ name: "GPT-5.6 Sol", tokens: 350 }]);
});

test("pairs interleaved Codex tool outputs with their call IDs", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "behavior-wrapped-codex-pairing-"));
  const file = path.join(directory, "interleaved.jsonl");
  const records = [
    { timestamp: "2026-08-01T00:00:00.000Z", type: "response_item", payload: { type: "function_call", call_id: "delete-call", name: "exec_command", arguments: JSON.stringify({ cmd: "rm generated" }) } },
    { timestamp: "2026-08-01T00:00:01.000Z", type: "response_item", payload: { type: "function_call", call_id: "read-call", name: "read_file", arguments: JSON.stringify({ path: "private-file" }) } },
    { timestamp: "2026-08-01T00:00:02.000Z", type: "response_item", payload: { type: "function_call_output", call_id: "read-call", output: "completed" } },
    { timestamp: "2026-08-01T00:00:03.000Z", type: "response_item", payload: { type: "function_call_output", call_id: "delete-call", output: "Permission denied" } },
  ];
  fs.writeFileSync(file, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
  const results = readRecords(file, "codex").flatMap((record) => record.message?.content || []).filter((block) => block.type === "tool_result");
  assert.equal(results[0].error_summary, null);
  assert.equal(results[1].error_summary, "permission denied");
});

test("sorts agent usage from highest percentage to lowest", () => {
  const report = analyzeSessions([
    { sessionId: "codex-one", agent: "codex", records: [] },
    { sessionId: "codex-two", agent: "codex", records: [] },
    { sessionId: "claude-one", agent: "claude", records: [] },
  ]);
  assert.deepEqual(report.stats.agents.map(({ agent, percentage }) => ({ agent, percentage })), [
    { agent: "codex", percentage: 66.7 },
    { agent: "claude", percentage: 33.3 },
  ]);
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
  assert.equal(report.stats.agentWords, 11);
  assert.equal(report.stats.userWords, 4);
  assert.equal(report.stats.agentUserWordRatio, 2.75);
});

test("records the turn count for each session and the longest session", () => {
  const turnCounts = [51, 2, 21, 1, 11, 6];
  const report = analyzeSessions(turnCounts.map((turns, sessionIndex) => ({
    sessionId: `turn-session-${sessionIndex}`,
    records: Array.from({ length: turns }, (_, turnIndex) => ({ type: "user", message: { content: `Message ${turnIndex + 1}` } })),
  })));
  assert.equal(report.stats.longestSessionTurns, 51);
  assert.deepEqual(report.stats.sessionTurnCounts, [1, 2, 6, 11, 21, 51]);
});

test("title-cases model families that are not hardcoded", () => {
  const report = analyzeSessions([{ sessionId: "new-model-family", records: [
    { type: "user", message: { content: "Hello" } },
    { type: "assistant", message: { model: "claude-fable-5", content: "Hi", usage: { input_tokens: 10, output_tokens: 5 } } },
  ] }]);
  assert.equal(report.stats.models[0].name, "Claude Fable 5");
});

test("counts interaction tone and classifies languages and prompt topics locally", () => {
  const report = analyzeSessions([{ sessionId: "classifiers", records: [
    { type: "user", message: { content: "Dude, come on, this is not what I asked for." } },
    { type: "assistant", message: { content: "I understand. Voy a corregir esto porque ahora está claro para mí." } },
    { type: "user", message: { content: "Please fix the React component and run the tests." } },
    { type: "assistant", message: { content: "I fixed the component. ```js\nconst secret = true;\n``` Gracias por explicar el problema con más detalle." } },
    { type: "user", message: { content: "Perfect, thanks!" } },
    { type: "assistant", message: { content: "You are welcome. The implementation and tests are complete." } },
    { type: "user", message: { content: "Draft a short email with a friendlier tone." } },
    { type: "assistant", message: { content: "I drafted a concise email with a warmer opening and a direct close." } },
  ] }]);
  assert.equal(report.stats.interactionTone.frustratedMessages, 1);
  assert.equal(report.stats.interactionTone.gratefulMessages, 1);
  assert.equal(report.stats.interactionTone.analyzedMessages, 4);
  assert.ok(report.stats.outputLanguages.some((item) => item.language === "Spanish" && item.words > 0));
  assert.equal(report.stats.outputLanguages.some((item) => item.language === "English" && item.words === 4), false);
  assert.ok(report.stats.topics.some((item) => item.topic === "Coding"));
  assert.ok(report.stats.topics.some((item) => item.topic === "Writing"));
  assert.equal(report.stats.topics.reduce((sum, item) => sum + item.prompts, 0), 4);
});

test("counts fixed stock phrases only in assistant prose", () => {
  const report = analyzeSessions([{ sessionId: "stock-phrases", records: [
    { type: "user", message: { content: "You're right, genuinely. Say the word. One wrinkle." } },
    { type: "assistant", message: { content: "You're right. You’re right! Genuinely, say the word—there is one wrinkle." } },
    { type: "assistant", message: { content: "`genuinely` ```text\nSay the word.\n```" } },
  ] }]);
  assert.deepEqual(report.stats.stockPhrases, [
    { phrase: "You're right", count: 2 },
    { phrase: "Say the word", count: 1 },
    { phrase: "genuinely", count: 1 },
    { phrase: "one wrinkle", count: 1 },
  ]);
});

test("detects a brief unprompted non-Latin language switch", () => {
  const report = analyzeSessions([{ sessionId: "language-anomaly", records: [
    { type: "user", message: { content: "Please summarize the result briefly." } },
    { type: "assistant", message: { content: "I can summarize the result clearly in English. 你好 世界. Everything else remains in English." } },
  ] }]);
  assert.equal(report.stats.languageAnomaly.language, "Chinese");
  assert.equal(report.stats.languageAnomaly.words, 2);
  assert.equal(report.stats.languageAnomaly.occurrences, 1);

  const prompted = analyzeSessions([{ sessionId: "prompted-language", records: [
    { type: "user", message: { content: "Please answer with 你好 世界." } },
    { type: "assistant", message: { content: "Here is the requested phrase: 你好 世界. Everything else remains in English." } },
  ] }]);
  assert.equal(prompted.stats.languageAnomaly, null);
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

test("does not mistake redaction markers or ordinary prose for credential values", () => {
  const sample = "Done. No API key: [CODE REMOVED] is needed. **Password: the** password you entered is no longer needed. Password: authentication is handled elsewhere.";
  const result = redactText(sample);
  assert.equal(result.text, sample);
  assert.deepEqual(result.detections, []);

  const sensitive = redactText('Password: "hunter2" and token=sk-test_12345678901234567890');
  assert.equal(sensitive.text, "[REDACTED CREDENTIAL] and [REDACTED CREDENTIAL]");
  assert.equal(sensitive.detections.length, 2);
});

test("keeps high-entropy identifiers, Git SSH identities, and secret-looking slugs", () => {
  const sample = "Clone git@github.com:openai/codex.git and open api-reference-models with ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef0123456789.";
  const bundle = makeDonationPreview([{ sessionId: "context-session", records: [
    { type: "user", message: { content: sample } },
  ] }], new Map([["context-session", { label: "Session 1" }]]));
  assert.equal(bundle.sessions[0].messages[0].text, sample);
  assert.deepEqual(bundle.redactions, []);
});

test("donation preview contains only message text, with secrets and PII removed", () => {
  const catalog = discoverSessions(root);
  const entries = [...catalog.index].map(([sessionId, session]) => ({ sessionId, records: readRecords(session.file) }));
  const labels = new Map(catalog.sessions.map((s, index) => [s.id, { label: `Session ${index + 1}` }]));
  const bundle = makeDonationPreview(entries, labels);
  const serialized = JSON.stringify(bundle.sessions);
  assert.equal(bundle.createdLocally, true);
  assert.ok(bundle.detectionCount >= 2);
  assert.ok(bundle.redactions.some((item) => item.replacement === "[REDACTED EMAIL]" && item.matches.some((match) => match.value === "demo.person@example.com")));
  assert.equal(bundle.redactions.reduce((sum, item) => sum + item.count, 0), bundle.detectionCount);
  assert.ok(!serialized.includes("demo.person@example.com"));
  assert.ok(!serialized.includes("sk-test_demo"));
  assert.ok(!serialized.includes("tool_result"));
});

test("donation preview keeps code, URLs, and paths while masking home-directory usernames", () => {
  const bundle = makeDonationPreview([{ sessionId: "private-session", records: [
    { type: "user", message: { content: "See https://example.com/private and /Users/ada/project/file.ts with `secretCall()`" } },
  ] }], new Map([["private-session", { label: "Session 1" }]]));
  const serialized = JSON.stringify(bundle.sessions);
  assert.equal(serialized.includes("https://example.com/private"), true);
  assert.equal(serialized.includes("/Users/ada"), false);
  assert.equal(serialized.includes("/Users/[REDACTED USER]/project/file.ts"), true);
  assert.equal(serialized.includes("`secretCall()`"), true);
  assert.deepEqual(bundle.redactions.map((item) => item.replacement), ["/Users/[REDACTED USER]"]);
});

test("donation preview can keep an unchecked automatic redaction category", () => {
  const records = [{ sessionId: "review-session", records: [
    { type: "user", message: { content: 'Email demo.person@example.com with password: "hunter2"' } },
  ] }];
  const labels = new Map([["review-session", { label: "Session 1" }]]);
  const initial = makeDonationPreview(records, labels);
  const email = initial.redactions.find((item) => item.replacement === "[REDACTED EMAIL]");
  assert.equal(email.enabled, true);

  const customized = makeDonationPreview(records, labels, { disabledRedactions: [email.kind] });
  const serialized = JSON.stringify(customized.sessions);
  assert.equal(serialized.includes("demo.person@example.com"), true);
  assert.equal(serialized.includes("hunter2"), false);
  assert.equal(customized.redactions.find((item) => item.kind === email.kind).enabled, false);
  assert.equal(customized.detectionCount, initial.detectionCount - 1);
});
