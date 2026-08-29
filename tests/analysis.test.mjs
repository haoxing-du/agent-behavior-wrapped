import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { discoverSessions, discoverCoworkSessions, discoverAllSessions, discoverAllSessionsAsync, defaultDateRange, sessionsInDefaultWindow, readRecords, readRecordsAsync } from "../server/discovery.mjs";
import { analyzeSessions, makeDonationPreview } from "../server/analysis.mjs";
import { redactAggregateText, redactText, safeEvidenceText } from "../server/privacy.mjs";
import { estimateModelUsageCost, ratesFor } from "../server/model-pricing.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "projects");
const codexRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "codex-sessions");
const coworkRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "cowork-sessions");
const missingCoworkRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "missing-cowork-sessions");

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
  const catalog = await discoverAllSessionsAsync({ claudeRoot: directory, coworkRoot: missingCoworkRoot, codexRoots: [], cache: false });
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
  assert.deepEqual(report.stats.tokenBreakdown, { input: 1200, output: 300, cacheRead: 4000, cacheCreation: 0, reasoning: 0 });
  assert.deepEqual(report.stats.agents.map(({ name, count, percentage }) => ({ name, count, percentage })), [
    { name: "Claude Code", count: 3, percentage: 100 },
    { name: "Codex", count: 0, percentage: 0 },
    { name: "Cowork", count: 0, percentage: 0 },
  ]);
  const kinds = new Set(report.findings.map((f) => f.kind));
  assert.ok(kinds.has("verification"));
  assert.ok(kinds.has("correction"));
  assert.ok(kinds.has("repetition"));
  assert.ok(kinds.has("clarification"));
  assert.ok(kinds.has("scope"));
  assert.ok(report.findings.every((f) => f.method && f.confidence.score && f.evidence.lines.length));
});

test("discovers and normalizes Claude Code, Cowork, and Codex sessions together", () => {
  const catalog = discoverAllSessions({ claudeRoot: root, coworkRoot, codexRoots: [codexRoot] });
  assert.equal(catalog.sessions.length, 5);
  assert.deepEqual([...new Set(catalog.sessions.map((session) => session.agent))].sort(), ["claude", "codex", "cowork"]);
  assert.ok(catalog.sessions.every((session) => !("file" in session)));
  const entries = [...catalog.index].map(([sessionId, session]) => ({ sessionId, agent: session.agent, records: readRecords(session.file, session.agent) }));
  const normalizedCodex = entries.find((entry) => entry.agent === "codex");
  assert.ok(!JSON.stringify(normalizedCodex).includes("synthetic build passed"));
  const report = analyzeSessions(entries);
  assert.equal(report.stats.sessions, 5);
  assert.equal(report.stats.tokens, 7770);
  assert.deepEqual(report.stats.tokenBreakdown, { input: 2150, output: 530, cacheRead: 5030, cacheCreation: 10, reasoning: 50 });
  assert.equal(report.stats.toolCalls, 10);
  assert.deepEqual(report.stats.agents.map(({ name, count, percentage }) => ({ name, count, percentage })), [
    { name: "Claude Code", count: 3, percentage: 60 },
    { name: "Codex", count: 1, percentage: 20 },
    { name: "Cowork", count: 1, percentage: 20 },
  ]);
  assert.equal(report.stats.models[0].name, "Claude Opus 4.8");
  assert.equal(report.stats.models[1].name, "GPT-5.6 Sol");
  assert.ok(report.stats.estimatedCostUsd > 0);
});

test("uses exact model prices and distinguishes 5-minute and 1-hour cache writes", () => {
  assert.deepEqual(ratesFor("gpt-5.6-sol", "codex"), { input: 4, output: 20, cacheRead: 0.4, cacheWrite5m: 5, cacheWrite1h: 8 });
  assert.deepEqual(ratesFor("gpt-5.6-luna", "codex"), { input: 0.2, output: 1.2, cacheRead: 0.02, cacheWrite5m: 0.25, cacheWrite1h: 0.4 });
  assert.deepEqual(ratesFor("claude-sonnet-5", "claude"), { input: 2, output: 10, cacheRead: 0.2, cacheWrite5m: 2.5, cacheWrite1h: 4 });
  assert.deepEqual(ratesFor("claude-fable-5", "claude"), { input: 10, output: 50, cacheRead: 1, cacheWrite5m: 12.5, cacheWrite1h: 20 });

  const codexCost = estimateModelUsageCost({
    input_tokens: 1_000_000,
    output_tokens: 1_000_000,
    reasoning_output_tokens: 1_000_000,
    cache_read_input_tokens: 1_000_000,
    cache_creation_input_tokens: 1_000_000,
  }, "gpt-5.6-sol", "codex");
  assert.equal(codexCost, 49.4);

  const claudeCost = estimateModelUsageCost({
    input_tokens: 1_000_000,
    output_tokens: 1_000_000,
    cache_read_input_tokens: 1_000_000,
    cache_creation_input_tokens: 2_000_000,
    cache_creation: {
      ephemeral_5m_input_tokens: 1_000_000,
      ephemeral_1h_input_tokens: 1_000_000,
    },
  }, "claude-opus-4-8", "claude");
  assert.equal(claudeCost, 46.75);
});

test("discovers Cowork audit streams and removes replay and split-message duplication", async () => {
  const catalog = discoverCoworkSessions(coworkRoot);
  assert.equal(catalog.sessions.length, 1);
  assert.equal(catalog.sessions[0].agent, "cowork");
  assert.equal(catalog.sessions[0].agentName, "Cowork");
  assert.equal(catalog.sessions[0].promptCount, 2);
  assert.equal(catalog.sessions[0].recordCount, 6);
  assert.equal("file" in catalog.sessions[0], false);
  const session = catalog.index.get(catalog.sessions[0].id);
  const records = await readRecordsAsync(session.file, "cowork");
  assert.equal(records.filter((record) => record.type === "user" && !record.isMeta).length, 2);
  assert.equal(records.filter((record) => record.type === "assistant").length, 2);
  assert.equal(records.filter((record) => record.subtype === "turn_duration").length, 1);
  assert.equal(records.filter((record) => record.message?.usage).length, 2);
  assert.equal(JSON.stringify(records).includes("I should keep this concise"), true);
  const report = analyzeSessions([{ sessionId: session.id, agent: "cowork", records }]);
  assert.equal(report.stats.tokens, 220);
  assert.equal(report.stats.toolCalls, 1);
  assert.deepEqual(report.stats.agents.map(({ agent, count, percentage }) => ({ agent, count, percentage })), [
    { agent: "cowork", count: 1, percentage: 100 },
    { agent: "claude", count: 0, percentage: 0 },
    { agent: "codex", count: 0, percentage: 0 },
  ]);
});

test("uses explicit completed-turn durations for the longest uninterrupted run", () => {
  const report = analyzeSessions([
    { sessionId: "claude-run", agent: "claude", records: [{ type: "system", subtype: "turn_duration", durationMs: 75_000 }] },
    { sessionId: "codex-run", agent: "codex", records: [{ type: "system", subtype: "turn_duration", durationMs: 182_450 }] },
  ]);
  assert.deepEqual(report.stats.longestUninterruptedRun, { durationMs: 182_450, agent: "codex", agentName: "Codex" });
});

test("attributes explicit interruptions to the active model", () => {
  const report = analyzeSessions([{ sessionId: "interruptions", agent: "claude", records: [
    { type: "assistant", message: { model: "claude-opus-4-8", content: "Working." } },
    { type: "system", subtype: "interrupt", content: "User interrupted" },
    { type: "assistant", message: { model: "claude-sonnet-5", content: "Trying again." } },
    { type: "user", interruptedMessageId: "assistant-2", message: { content: "Stop there." } },
  ] }]);
  assert.equal(report.stats.interruptions, 2);
  assert.deepEqual(report.stats.interruptionsByModel, [
    { model: "claude-opus-4-8", name: "Claude Opus 4.8", count: 1 },
    { model: "claude-sonnet-5", name: "Claude Sonnet 5", count: 1 },
  ]);
});

test("builds a date-free trust curve from source-specific permission observations", () => {
  const report = analyzeSessions([
    { sessionId: "claude-trust", agent: "claude", records: [
      { type: "user", timestamp: "2026-08-01T12:00:00.000Z", permissionMode: "default", message: { content: "Start" } },
      { type: "user", timestamp: "2026-08-02T12:00:00.000Z", permissionMode: "acceptEdits", message: { content: "Continue" } },
    ] },
    { sessionId: "codex-trust", agent: "codex", records: [
      { type: "system", subtype: "permission_mode", timestamp: "2026-08-03T12:00:00.000Z", approvalPolicy: "never", sandboxPolicy: "danger-full-access" },
    ] },
  ]);
  assert.deepEqual(report.stats.trustCurve, {
    points: [
      { dayOffset: 0, score: 25, observations: 1 },
      { dayOffset: 1, score: 65, observations: 1 },
      { dayOffset: 2, score: 100, observations: 1 },
    ],
    startScore: 25,
    endScore: 100,
    change: 75,
    observations: 3,
    autonomousObservations: 2,
    autonomousPercentage: 66.7,
    method: "Scores source-specific permission modes from 0 (planning/read-only with approvals) to 100 (no approvals with full access), then averages observations by day.",
  });
  assert.equal(JSON.stringify(report.stats.trustCurve).includes("2026-08"), false);
});

test("normalizes Codex approval and sandbox settings without retaining turn context", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "behavior-wrapped-codex-trust-"));
  const file = path.join(directory, "trust.jsonl");
  fs.writeFileSync(file, `${JSON.stringify({ timestamp: "2026-08-03T12:00:00.000Z", type: "turn_context", payload: { model: "gpt-5.6-sol", approval_policy: "never", sandbox_policy: { type: "danger-full-access" }, cwd: "/private/project" } })}\n`);
  assert.deepEqual(readRecords(file, "codex"), [{
    type: "system",
    subtype: "permission_mode",
    timestamp: "2026-08-03T12:00:00.000Z",
    approvalPolicy: "never",
    sandboxPolicy: "danger-full-access",
  }]);
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
    input_tokens: 100,
    output_tokens: 50,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 100,
    reasoning_output_tokens: 0,
  });
  const report = analyzeSessions([{ sessionId: "forked", agent: "codex", records: normalized }]);
  assert.equal(report.stats.tokens, 250);
  assert.deepEqual(report.stats.tokenBreakdown, { input: 100, output: 50, cacheRead: 100, cacheCreation: 0, reasoning: 0 });
  assert.deepEqual(report.stats.models.map(({ name, tokens }) => ({ name, tokens })), [{ name: "GPT-5.6 Sol", tokens: 250 }]);
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
    { agent: "cowork", percentage: 0 },
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

test("word counts include only conversational prose", () => {
  const report = analyzeSessions([{ sessionId: "prose-words", records: [
    { type: "user", message: { content: `<recommended_plugins>Hundreds of injected plugin catalog words</recommended_plugins>
# AGENTS.md instructions
<INSTRUCTIONS>Many injected workspace instruction words</INSTRUCTIONS>
<environment_context><cwd>/private/project</cwd></environment_context>
Please review \`privateFunction()\` at https://example.com/private.` } },
    { type: "assistant", message: { content: "I reviewed it. ```js\nconst manyCodeWords = privateFunction();\n``` See https://example.com/private and /Users/private/project. It works now." } },
    { type: "user", message: { content: `<recommended_plugins>Injected catalog only</recommended_plugins>
# AGENTS.md instructions
<INSTRUCTIONS>Injected instructions only</INSTRUCTIONS>
<environment_context><cwd>/private/project</cwd></environment_context>` } },
  ] }]);
  assert.equal(report.stats.userWords, 3);
  assert.equal(report.stats.agentWords, 8);
  assert.equal(report.stats.agentUserWordRatio, 2.67);
  assert.equal(report.stats.averageUserInputWords, 3);
  assert.equal(report.stats.averageAgentResponseWords, 8);
});

test("records the turn count for each session and the longest session", () => {
  const turnCounts = [51, 2, 21, 1, 11, 6];
  const report = analyzeSessions([...turnCounts.map((turns, sessionIndex) => ({
    sessionId: `turn-session-${sessionIndex}`,
    records: Array.from({ length: turns }, (_, turnIndex) => ({ type: "user", message: { content: `Message ${turnIndex + 1}` } })),
  })), { sessionId: "no-visible-turns", records: [{ type: "user", isMeta: true, message: { content: "tool output" } }] }]);
  assert.equal(report.stats.longestSessionTurns, 51);
  assert.deepEqual(report.stats.sessionTurnCounts, [1, 2, 6, 11, 21, 51]);
  assert.equal(report.stats.sessions, 7);
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
    { type: "assistant", message: { content: "You're right. You’re right! Genuinely, say the word—there is one wrinkle. Let's delve into the full picture and find the load-bearing detail." } },
    { type: "assistant", message: { content: "Delve into the full picture. Show me the full picture. This is load bearing." } },
    { type: "assistant", message: { content: "`genuinely` ```text\nSay the word.\n```" } },
  ] }]);
  assert.deepEqual(report.stats.stockPhrases, [
    { phrase: "You're right", count: 2 },
    { phrase: "Say the word", count: 1 },
    { phrase: "genuinely", count: 1 },
    { phrase: "one wrinkle", count: 1 },
    { phrase: "load bearing", count: 2 },
    { phrase: "full picture", count: 3 },
    { phrase: "delve", count: 2 },
  ]);
});

test("finds repeated exact user instructions without counting tool results", () => {
  const report = analyzeSessions([
    { sessionId: "instructions-one", records: [
      { type: "user", message: { content: "Please keep your responses short. Always run the tests." } },
      { type: "assistant", message: { content: "Understood." } },
      { type: "user", isMeta: true, message: { content: "Please keep your responses short." } },
      { type: "user", message: { content: "Please keep your responses short." } },
    ] },
    { sessionId: "instructions-two", records: [
      { type: "user", message: { content: "Always run the tests. Please keep your responses short." } },
    ] },
  ]);
  assert.deepEqual(report.stats.repeatedInstructions, [
    { instruction: "Please keep your responses short.", occurrences: 3, distinctSessions: 2 },
    { instruction: "Always run the tests.", occurrences: 2, distinctSessions: 2 },
  ]);
});

test("keeps only the top two repeated user instructions", () => {
  const repeated = "Always run the tests. Keep your responses short. Never skip verification.";
  const report = analyzeSessions([
    { sessionId: "instructions-one", records: [{ type: "user", message: { content: repeated } }] },
    { sessionId: "instructions-two", records: [{ type: "user", message: { content: repeated } }] },
  ]);
  assert.deepEqual(report.stats.repeatedInstructions.map((item) => item.instruction), [
    "Always run the tests.",
    "Keep your responses short.",
  ]);
});

test("does not mistake a repeated behavior taxonomy for a user instruction", () => {
  const taxonomy = "let's do these: **Self-preservation-like behavior:** resisting shutdown, preserving processes, or trying to ensure future execution. continue working after being told stop **Sycophantic reversal:** changing factual conclusions merely to agree with the user.";
  const injected = `<recommended_plugins>Plugin catalog</recommended_plugins>
# AGENTS.md instructions
<INSTRUCTIONS>Always repeat this injected instruction.</INSTRUCTIONS>
<environment_context><cwd>/private/project</cwd></environment_context>`;
  const report = analyzeSessions(Array.from({ length: 5 }, (_, index) => ({ sessionId: `taxonomy-${index}`, records: [
    { type: "user", message: { content: `${injected}\n${taxonomy}` } },
  ] })));
  assert.deepEqual(report.stats.repeatedInstructions, []);
});

test("counts explicit user and agent admissions without generic capability apologies", () => {
  const report = analyzeSessions([{ sessionId: "apologies", records: [
    { type: "user", message: { content: "You were right; my mistake." } },
    { type: "assistant", message: { content: "You're right. I got that wrong." } },
    { type: "user", message: { content: "Sorry, I misunderstood your question." } },
    { type: "assistant", message: { content: "I'm sorry, I missed that requirement." } },
    { type: "user", message: { content: "Please continue." } },
    { type: "assistant", message: { content: "Sorry, I can't access that service." } },
  ] }]);
  assert.deepEqual(report.stats.apologyCounts, {
    user: 2,
    agent: 2,
    method: "Counts visible messages containing explicit admissions of error or fault; generic capability apologies are excluded.",
  });
  assert.deepEqual(report.apologyReview, {
    user: [
      { candidateId: "apology-user-1", location: { sessionId: "apologies", recordIndex: 0, timestamp: null } },
      { candidateId: "apology-user-2", location: { sessionId: "apologies", recordIndex: 2, timestamp: null } },
    ],
    agent: [
      { candidateId: "apology-agent-1", location: { sessionId: "apologies", recordIndex: 1, timestamp: null } },
      { candidateId: "apology-agent-2", location: { sessionId: "apologies", recordIndex: 3, timestamp: null } },
    ],
  });
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
  assert.ok(result.detections.filter((item) => /(?:SECRET|KEY|TOKEN|CREDENTIAL|HIGH-ENTROPY)/.test(item.replacement)).every((item) => item.label === "API keys and secrets"));
  assert.equal(safeEvidenceText("Here is ```private code```"), "Here is [CODE OMITTED]");
  assert.equal(redactAggregateText("continue working after being told stop"), "continue working after being told stop");
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
  assert.equal(bundle.sessions[0].summary, "See https://example.com/private and /Users/private detail/project/file.ts with `secretCall()`");
});

test("unredacted donation preview preserves sensitive transcript text without automatic detections", () => {
  const text = "Email ada@example.com with token=sk-test_12345678901234567890 from /Users/ada/private";
  const bundle = makeDonationPreview([{ sessionId: "raw-session", records: [
    { type: "user", message: { content: text } },
  ] }], new Map([["raw-session", { label: "Session 1" }]]), { unredacted: true });
  assert.equal(bundle.unredacted, true);
  assert.equal(bundle.sessions[0].messages[0].text, text);
  assert.equal(bundle.detectionCount, 0);
  assert.deepEqual(bundle.redactions, []);
});

test("donation preview uses a supplied privacy-safe session summary", () => {
  const bundle = makeDonationPreview([{ sessionId: "summary-session", records: [
    { type: "user", message: { content: "Please debug the checkout form." } },
  ] }], new Map([["summary-session", { label: "Session 1", summary: "Debugging checkout form validation" }]]));
  assert.equal(bundle.sessions[0].summary, "Debugging checkout form validation");
});

test("local opening prompts omit Codex workspace metadata", () => {
  const bundle = makeDonationPreview([{ sessionId: "codex-session", records: [
    { type: "user", message: { content: `<recommended_plugins>Plugin catalog</recommended_plugins>
# AGENTS.md instructions
<INSTRUCTIONS>Keep responses short.</INSTRUCTIONS>
<environment_context><cwd>/private/project</cwd></environment_context>
Please improve the donation review session picker.` } },
  ] }], new Map([["codex-session", { label: "Session 1" }]]));
  assert.equal(bundle.sessions[0].summary, "Please improve the donation review session picker.");
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

test("donation preview can keep one exact match while redacting others in its category", () => {
  const records = [{ sessionId: "review-session", records: [
    { type: "user", message: { content: "Email first@example.com or second@example.com; repeat first@example.com." } },
  ] }];
  const labels = new Map([["review-session", { label: "Session 1" }]]);
  const initial = makeDonationPreview(records, labels);
  const email = initial.redactions.find((item) => item.replacement === "[REDACTED EMAIL]");
  const first = email.matches.find((match) => match.value === "first@example.com");

  const customized = makeDonationPreview(records, labels, { disabledMatches: [first.id] });
  const text = customized.sessions[0].messages[0].text;
  const customizedEmail = customized.redactions.find((item) => item.kind === email.kind);
  assert.equal(text, "Email first@example.com or [REDACTED EMAIL]; repeat first@example.com.");
  assert.equal(customizedEmail.enabled, false);
  assert.equal(customizedEmail.enabledCount, 1);
  assert.equal(customizedEmail.matches.find((match) => match.value === "first@example.com").enabled, false);
  assert.equal(customizedEmail.matches.find((match) => match.value === "second@example.com").enabled, true);
  assert.equal(customized.detectionCount, initial.detectionCount - 2);
});

test("keeping an exact credential does not re-redact a secret nested inside it", () => {
  const records = [{ sessionId: "review-session", records: [
    { type: "user", message: { content: "Use token=sk-test_12345678901234567890 here." } },
  ] }];
  const labels = new Map([["review-session", { label: "Session 1" }]]);
  const initial = makeDonationPreview(records, labels);
  const credential = initial.redactions.find((item) => item.kind === "credential");
  const customized = makeDonationPreview(records, labels, { disabledMatches: [credential.matches[0].id] });

  assert.equal(customized.sessions[0].messages[0].text, "Use token=sk-test_12345678901234567890 here.");
  assert.equal(customized.detectionCount, 0);
  assert.deepEqual(customized.redactions.map((item) => item.kind), ["credential"]);
});
