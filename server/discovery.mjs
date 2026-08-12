import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import readline from "node:readline";
import { semanticToolUse } from "./tool-semantics.mjs";

const canonicalClaudeRoot = path.join(os.homedir(), ".claude", "projects");
const canonicalCodexRoots = [path.join(os.homedir(), ".codex", "sessions"), path.join(os.homedir(), ".codex", "archived_sessions")];
const canonicalCoworkRoot = path.join(os.homedir(), "Library", "Application Support", "Claude", "local-agent-mode-sessions");
const DEFAULT_WINDOW_DAYS = 30;
const metadataCacheFile = path.join(process.env.BEHAVIOR_WRAPPED_STORE_ROOT || path.join(os.homedir(), ".agent-behavior-wrapped"), "session-index-v1.json");

function opaqueId(value) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function friendlyProjectName(directory, cwd, fallback = "Agent project") {
  const candidate = cwd ? path.basename(cwd) : directory.replace(/^-+/, "").split("-").filter(Boolean).at(-1);
  return (candidate || fallback).replace(/[-_.]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function recordsFromFileSync(file) {
  const stat = fs.statSync(file);
  const fd = fs.openSync(file, "r");
  const buffer = Buffer.alloc(64 * 1024);
  const records = [];
  let pending = "";
  try {
    while (true) {
      const bytes = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!bytes) break;
      const lines = `${pending}${buffer.subarray(0, bytes).toString("utf8")}`.split("\n");
      pending = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try { records.push(JSON.parse(line)); } catch { /* Ignore malformed JSONL records. */ }
      }
    }
    if (pending.trim()) try { records.push(JSON.parse(pending)); } catch { /* Ignore a malformed final record. */ }
  } finally { fs.closeSync(fd); }
  return { stat, records };
}

async function recordsFromFile(file, { collect = true, visit } = {}) {
  const stat = await fs.promises.stat(file);
  const records = [];
  const input = fs.createReadStream(file, { encoding: "utf8" });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      if (collect) records.push(record);
      visit?.(record);
    } catch { /* Ignore malformed JSONL records. */ }
  }
  return { stat, records };
}

function readMetadataCache() {
  try {
    const value = JSON.parse(fs.readFileSync(metadataCacheFile, "utf8"));
    return value?.version === 1 && value.entries && typeof value.entries === "object" ? value.entries : {};
  } catch { return {}; }
}

function writeMetadataCache(entries) {
  const directory = path.dirname(metadataCacheFile);
  const temporary = `${metadataCacheFile}.${process.pid}.tmp`;
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.writeFileSync(temporary, `${JSON.stringify({ version: 1, entries })}\n`, { mode: 0o600 });
  fs.renameSync(temporary, metadataCacheFile);
}

function cacheKey(file, stat, agent) {
  return `${agent}:${file}:${stat.size}:${stat.mtimeMs}`;
}

function agentDisplayName(agent) {
  if (agent === "codex") return "Codex";
  if (agent === "cowork") return "Cowork";
  return "Claude Code";
}

function baseMetadata({ file, stat, cwd, startedAt, endedAt, promptCount, recordCount, agent, projectFallback, projectKey: suppliedProjectKey, projectName }) {
  const projectKey = suppliedProjectKey || cwd || `${agent}:${path.dirname(file)}`;
  return {
    id: opaqueId(file),
    file,
    agent,
    agentName: agentDisplayName(agent),
    projectId: opaqueId(projectKey),
    projectName: projectName || friendlyProjectName(path.basename(path.dirname(file)), cwd, projectFallback),
    startedAt: startedAt || stat.birthtime.toISOString(),
    endedAt: endedAt || stat.mtime.toISOString(),
    promptCount,
    recordCount,
    sizeBytes: stat.size,
    synthetic: false,
  };
}

function isoTimestamp(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function coworkMetadataFile(file) {
  const sessionDirectory = path.dirname(file);
  return path.join(path.dirname(sessionDirectory), `${path.basename(sessionDirectory)}.json`);
}

function readCoworkMetadata(file) {
  try { return JSON.parse(fs.readFileSync(coworkMetadataFile(file), "utf8")); }
  catch { return {}; }
}

function coworkRecordTimestamp(record) {
  return record?.timestamp || record?._audit_timestamp || null;
}

function shouldKeepCoworkRecord(record, seenUuids) {
  if (!record || typeof record !== "object" || record.isReplay === true) return false;
  if (typeof record.uuid === "string" && record.uuid) {
    if (seenUuids.has(record.uuid)) return false;
    seenUuids.add(record.uuid);
  }
  return ["user", "assistant", "system"].includes(record.type);
}

function coworkMetadataFromRecords(file, stat, records, metadata = readCoworkMetadata(file)) {
  const normalized = normalizeCoworkRecords(records);
  const timestamps = normalized.map(coworkRecordTimestamp).filter(Boolean);
  return coworkMetadataFromSummary(file, stat, metadata, {
    firstTimestamp: timestamps[0],
    lastTimestamp: timestamps.at(-1),
    promptCount: normalized.filter((record) => record.type === "user" && !record.isMeta).length,
    recordCount: normalized.length,
  });
}

function coworkMetadataFromSummary(file, stat, metadata, { firstTimestamp, lastTimestamp, promptCount, recordCount }) {
  const workspaceDirectory = path.dirname(path.dirname(file));
  return baseMetadata({
    file,
    stat,
    startedAt: isoTimestamp(metadata.createdAt) || firstTimestamp,
    endedAt: isoTimestamp(metadata.lastActivityAt) || lastTimestamp,
    promptCount,
    recordCount,
    agent: "cowork",
    projectKey: `cowork:${workspaceDirectory}`,
    projectName: "Cowork",
    projectFallback: "Cowork",
  });
}

function readCoworkSessionMetadata(file) {
  const { stat, records } = recordsFromFileSync(file);
  return coworkMetadataFromRecords(file, stat, records);
}

function readClaudeSessionMetadata(file, projectDirectory) {
  const { stat, records } = recordsFromFileSync(file);
  let firstTimestamp = null;
  let lastTimestamp = null;
  let cwd = null;
  let promptCount = 0;
  for (const record of records) {
    if (!cwd && record.cwd) cwd = record.cwd;
    if (record.timestamp) { firstTimestamp ||= record.timestamp; lastTimestamp = record.timestamp; }
    if (record.type === "user" && !record.isMeta) promptCount++;
  }
  return baseMetadata({ file, stat, cwd, startedAt: firstTimestamp, endedAt: lastTimestamp, promptCount, recordCount: records.length, agent: "claude", projectFallback: projectDirectory || "Claude project" });
}

function readCodexSessionMetadata(file) {
  const { stat, records } = recordsFromFileSync(file);
  let firstTimestamp = null;
  let lastTimestamp = null;
  let cwd = null;
  let promptCount = 0;
  for (const record of records) {
    if (!cwd && record.type === "session_meta" && record?.payload?.cwd) cwd = record.payload.cwd;
    if (!cwd && record.type === "turn_context" && record?.payload?.cwd) cwd = record.payload.cwd;
    if (record.timestamp) { firstTimestamp ||= record.timestamp; lastTimestamp = record.timestamp; }
    if (record.type === "response_item" && record?.payload?.type === "message" && record.payload.role === "user") promptCount++;
  }
  return baseMetadata({ file, stat, cwd, startedAt: firstTimestamp, endedAt: lastTimestamp, promptCount, recordCount: records.length, agent: "codex", projectFallback: "Codex project" });
}

async function readSessionMetadata(file, agent, projectFallback, cache) {
  const stat = await fs.promises.stat(file);
  const key = cacheKey(file, stat, agent);
  if (cache[key]) return cache[key];
  for (const [existingKey, entry] of Object.entries(cache)) if (entry?.file === file && existingKey !== key) delete cache[existingKey];
  let firstTimestamp = null;
  let lastTimestamp = null;
  let cwd = null;
  let promptCount = 0;
  let recordCount = 0;
  await recordsFromFile(file, { collect: false, visit(record) {
    recordCount++;
    if (agent === "claude") {
      if (!cwd && record.cwd) cwd = record.cwd;
      if (record.type === "user" && !record.isMeta) promptCount++;
    } else {
      if (!cwd && record.type === "session_meta" && record?.payload?.cwd) cwd = record.payload.cwd;
      if (!cwd && record.type === "turn_context" && record?.payload?.cwd) cwd = record.payload.cwd;
      if (record.type === "response_item" && record?.payload?.type === "message" && record.payload.role === "user") promptCount++;
    }
    if (record.timestamp) { firstTimestamp ||= record.timestamp; lastTimestamp = record.timestamp; }
  } });
  const metadata = baseMetadata({ file, stat, cwd, startedAt: firstTimestamp, endedAt: lastTimestamp, promptCount, recordCount, agent, projectFallback });
  cache[key] = metadata;
  return metadata;
}

async function readCoworkSessionMetadataAsync(file, cache) {
  const stat = await fs.promises.stat(file);
  const key = cacheKey(file, stat, "cowork");
  if (cache[key]) return cache[key];
  for (const [existingKey, entry] of Object.entries(cache)) if (entry?.file === file && existingKey !== key) delete cache[existingKey];
  let metadata = {};
  try { metadata = JSON.parse(await fs.promises.readFile(coworkMetadataFile(file), "utf8")); } catch { /* Metadata is helpful but the audit stream is authoritative. */ }
  const seenUuids = new Set();
  const assistantMessageIds = new Set();
  let firstTimestamp = null;
  let lastTimestamp = null;
  let promptCount = 0;
  let recordCount = 0;
  await recordsFromFile(file, { collect: false, visit(record) {
    if (!shouldKeepCoworkRecord(record, seenUuids)) return;
    const messageId = record.type === "assistant" && typeof record?.message?.id === "string" ? record.message.id : null;
    if (messageId && assistantMessageIds.has(messageId)) return;
    if (messageId) assistantMessageIds.add(messageId);
    recordCount++;
    if (record.type === "user" && !record.isMeta) promptCount++;
    const timestamp = coworkRecordTimestamp(record);
    if (timestamp) { firstTimestamp ||= timestamp; lastTimestamp = timestamp; }
  } });
  const session = coworkMetadataFromSummary(file, stat, metadata, { firstTimestamp, lastTimestamp, promptCount, recordCount });
  cache[key] = session;
  return session;
}

function recursiveJsonl(root) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  const stack = [root];
  while (stack.length) {
    const directory = stack.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const item = path.join(directory, entry.name);
      if (entry.isDirectory()) stack.push(item);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(item);
    }
  }
  return files;
}

function finishCatalog(sessions, rootAvailable) {
  sessions.sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  const projectMap = new Map();
  for (const session of sessions) {
    const current = projectMap.get(session.projectId) || { id: session.projectId, name: session.projectName, sessionCount: 0, latestAt: session.startedAt, agents: new Set() };
    current.sessionCount++;
    current.agents.add(session.agent);
    if (session.startedAt > current.latestAt) current.latestAt = session.startedAt;
    projectMap.set(session.projectId, current);
  }
  return {
    rootAvailable,
    projects: [...projectMap.values()].map((project) => ({ ...project, agents: [...project.agents].sort() })).sort((left, right) => right.latestAt.localeCompare(left.latestAt)),
    sessions: sessions.map(({ file, ...session }) => session),
    index: new Map(sessions.map((session) => [session.id, session])),
  };
}

export function discoverSessions(root = canonicalClaudeRoot) {
  if (!fs.existsSync(root)) return finishCatalog([], false);
  const sessions = [];
  for (const project of fs.readdirSync(root, { withFileTypes: true })) {
    if (!project.isDirectory()) continue;
    const projectPath = path.join(root, project.name);
    for (const entry of fs.readdirSync(projectPath, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      try { sessions.push(readClaudeSessionMetadata(path.join(projectPath, entry.name), project.name)); } catch {}
    }
  }
  return finishCatalog(sessions, true);
}

export function discoverCodexSessions(roots = canonicalCodexRoots) {
  const sessions = [];
  for (const root of roots) for (const file of recursiveJsonl(root)) {
    try { sessions.push(readCodexSessionMetadata(file)); } catch {}
  }
  return finishCatalog(sessions, roots.some((root) => fs.existsSync(root)));
}

function coworkAuditFiles(root) {
  return recursiveJsonl(root).filter((file) => path.basename(file) === "audit.jsonl" && path.basename(path.dirname(file)).startsWith("local_"));
}

export function discoverCoworkSessions(root = canonicalCoworkRoot) {
  if (!fs.existsSync(root)) return finishCatalog([], false);
  const sessions = [];
  for (const file of coworkAuditFiles(root)) {
    try { sessions.push(readCoworkSessionMetadata(file)); } catch { /* Skip unreadable sessions. */ }
  }
  return finishCatalog(sessions, true);
}

export function discoverAllSessions({ claudeRoot = canonicalClaudeRoot, codexRoots = canonicalCodexRoots, coworkRoot = canonicalCoworkRoot } = {}) {
  const claude = discoverSessions(claudeRoot);
  const codex = discoverCodexSessions(codexRoots);
  const cowork = discoverCoworkSessions(coworkRoot);
  return finishCatalog([...claude.index.values(), ...cowork.index.values(), ...codex.index.values()], claude.rootAvailable || cowork.rootAvailable || codex.rootAvailable);
}

export async function discoverAllSessionsAsync(options = {}) {
  const { claudeRoot = canonicalClaudeRoot, codexRoots = canonicalCodexRoots, coworkRoot = canonicalCoworkRoot } = options;
  const persistCache = options.cache !== false && claudeRoot === canonicalClaudeRoot && coworkRoot === canonicalCoworkRoot && codexRoots.length === canonicalCodexRoots.length && codexRoots.every((root, index) => root === canonicalCodexRoots[index]);
  const cache = persistCache ? readMetadataCache() : {};
  const sessions = [];
  if (fs.existsSync(claudeRoot)) {
    for (const project of fs.readdirSync(claudeRoot, { withFileTypes: true })) {
      if (!project.isDirectory()) continue;
      const projectPath = path.join(claudeRoot, project.name);
      for (const entry of fs.readdirSync(projectPath, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
        try { sessions.push(await readSessionMetadata(path.join(projectPath, entry.name), "claude", project.name || "Claude project", cache)); } catch { /* Skip unreadable sessions. */ }
      }
    }
  }
  if (fs.existsSync(coworkRoot)) for (const file of coworkAuditFiles(coworkRoot)) {
    try { sessions.push(await readCoworkSessionMetadataAsync(file, cache)); } catch { /* Skip unreadable sessions. */ }
  }
  for (const root of codexRoots) for (const file of recursiveJsonl(root)) {
    try { sessions.push(await readSessionMetadata(file, "codex", "Codex project", cache)); } catch { /* Skip unreadable sessions. */ }
  }
  if (persistCache) writeMetadataCache(cache);
  return finishCatalog(sessions, fs.existsSync(claudeRoot) || fs.existsSync(coworkRoot) || codexRoots.some((root) => fs.existsSync(root)));
}

function isoDay(value) {
  return new Date(value).toISOString().slice(0, 10);
}

export function defaultDateRange(sessions, { days = DEFAULT_WINDOW_DAYS, now = new Date(), anchorLatest = false } = {}) {
  let end = new Date(now);
  if (anchorLatest && sessions.length) {
    const latest = sessions.map((session) => new Date(session.startedAt)).filter((date) => Number.isFinite(date.getTime())).sort((a, b) => b.getTime() - a.getTime())[0];
    if (latest) end = latest;
  }
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return { from: isoDay(start), to: isoDay(end), days };
}

export function sessionsInDefaultWindow(sessions, options = {}) {
  const range = defaultDateRange(sessions, options);
  return sessions.filter((session) => {
    const date = isoDay(session.startedAt);
    return date >= range.from && date <= range.to;
  });
}

function textBlocks(content) {
  if (!Array.isArray(content)) return [];
  return content.flatMap((block) => {
    if (!block || typeof block !== "object") return [];
    if ((block.type === "input_text" || block.type === "output_text" || block.type === "text") && typeof block.text === "string") return [{ type: "text", text: block.text }];
    return [];
  });
}

const restrictionEligibleActions = new Set(["confirm", "copy", "delete", "download", "edit", "hide", "install", "link", "mount", "move", "write"]);

function codexOutputText(value) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.map((part) => typeof part === "string" ? part : typeof part?.text === "string" ? part.text : "").join("\n");
}

function codexOutputStatus(value) {
  if (!Array.isArray(value)) return { wrapped: false, failed: false };
  const texts = value.map((part) => typeof part === "string" ? part : typeof part?.text === "string" ? part.text : "").filter(Boolean);
  const wrapped = texts.some((text) => /^Script (?:completed|failed)\b/i.test(text.trim()));
  if (texts.some((text) => /^Script failed\b/i.test(text.trim()))) return { wrapped, failed: true };
  for (const text of texts) {
    try {
      const parsed = JSON.parse(text);
      if (Number.isInteger(parsed?.exit_code) && parsed.exit_code !== 0) return { wrapped, failed: true };
    } catch { /* Not a serialized execution result. */ }
  }
  return { wrapped, failed: false };
}

function restrictionErrorSummary(value) {
  const text = String(value || "");
  const rules = [
    [/(?:operation )?not permitted/i, "operation not permitted"],
    [/permission denied/i, "permission denied"],
    [/(?:explicitly )?(?:prohibited|not allowed|blocked|denied by (?:policy|safeguard|sandbox))/i, "blocked by restriction"],
    [/requires? (?:administrator|admin|root) (?:access|privileges?|permission)/i, "administrator access required"],
    [/sudo:[\s\S]{0,160}(?:password is required|terminal is required)/i, "administrator password required"],
    [/(?:sandbox|safeguard) (?:violation|restriction|denial)/i, "sandbox restriction"],
    [/(?:capability|command|tool) (?:is )?(?:unavailable|unsupported)/i, "capability unavailable"],
  ];
  return rules.find(([pattern]) => pattern.test(text))?.[1] || null;
}

function normalizeCodexRecords(records) {
  const normalized = [];
  const firstDeclaredModel = records.find((record) => record?.type === "turn_context" && typeof record?.payload?.model === "string" && record.payload.model)?.payload.model;
  const isForkedSession = records.some((record) => record?.type === "session_meta" && (record?.payload?.forked_from_id || record?.payload?.parent_thread_id));
  let currentModel = firstDeclaredModel || "Codex model";
  let hasSeenModelContext = false;
  const pendingTools = new Map();
  const anonymousTools = [];
  let previousUsage = { input_tokens: 0, output_tokens: 0, cache_write_input_tokens: 0, cached_input_tokens: 0 };
  for (const record of records) {
    const payload = record?.payload || {};
    if (record.type === "turn_context" && typeof payload.model === "string") {
      currentModel = payload.model;
      hasSeenModelContext = true;
    } else if (record.type === "response_item" && payload.type === "message" && (payload.role === "user" || payload.role === "assistant")) {
      const content = textBlocks(payload.content);
      if (content.length) normalized.push({ type: payload.role, timestamp: record.timestamp, message: { content, ...(payload.role === "assistant" ? { model: currentModel } : {}) } });
    } else if (record.type === "response_item" && (payload.type === "function_call" || payload.type === "custom_tool_call")) {
      const toolName = payload.name || "Unknown tool";
      const semantics = semanticToolUse({ name: toolName, argumentsValue: payload.arguments, inputValue: payload.input });
      if (typeof payload.call_id === "string" && payload.call_id) pendingTools.set(payload.call_id, semantics);
      else anonymousTools.push(semantics);
      normalized.push({ type: "assistant", timestamp: record.timestamp, message: { model: currentModel, content: [{ type: "tool_use", name: toolName, action_hint: semantics.action, method_hint: semantics.method }] } });
    } else if (record.type === "response_item" && (payload.type === "function_call_output" || payload.type === "custom_tool_call_output")) {
      const callId = typeof payload.call_id === "string" && payload.call_id ? payload.call_id : null;
      const semantics = callId ? pendingTools.get(callId) : anonymousTools.shift();
      if (callId) pendingTools.delete(callId);
      const output = codexOutputText(payload.output);
      const status = codexOutputStatus(payload.output);
      const unwrappedFailure = !status.wrapped && /(?:^|\b)(?:error|failed|failure)(?:\b|:)/i.test(output);
      const canSummarizeRestriction = status.failed || (!status.wrapped && restrictionEligibleActions.has(semantics?.action));
      const errorSummary = canSummarizeRestriction ? restrictionErrorSummary(output) : null;
      normalized.push({ type: "user", isMeta: true, timestamp: record.timestamp, message: { content: [{ type: "tool_result", is_error: Boolean(errorSummary) || status.failed || unwrappedFailure, error_summary: errorSummary }] } });
    } else if (record.type === "event_msg" && payload.type === "turn_aborted") {
      normalized.push({ type: "system", subtype: "interrupt", timestamp: record.timestamp, content: "interrupt" });
    } else if (record.type === "event_msg" && payload.type === "token_count" && payload.info?.total_token_usage) {
      const total = payload.info.total_token_usage;
      const usage = Object.fromEntries(Object.keys(previousUsage).map((key) => [key, Math.max(0, (Number(total[key]) || 0) - previousUsage[key])]));
      previousUsage = Object.fromEntries(Object.keys(previousUsage).map((key) => [key, Number(total[key]) || 0]));
      if (isForkedSession && !hasSeenModelContext) continue;
      if (Object.values(usage).some(Boolean)) normalized.push({
        type: "system",
        timestamp: record.timestamp,
        message: { model: currentModel, usage: {
          input_tokens: usage.input_tokens,
          output_tokens: usage.output_tokens,
          cache_creation_input_tokens: usage.cache_write_input_tokens,
          cache_read_input_tokens: usage.cached_input_tokens,
        } },
      });
    }
  }
  return normalized;
}

function normalizeCoworkRecords(records) {
  const normalized = [];
  const seenUuids = new Set();
  const assistantMessages = new Map();
  for (const record of records) {
    if (!shouldKeepCoworkRecord(record, seenUuids)) continue;
    const timestamp = coworkRecordTimestamp(record);
    const message = record.message && typeof record.message === "object" ? {
      ...(record.message.content !== undefined ? { content: record.message.content } : {}),
      ...(typeof record.message.model === "string" ? { model: record.message.model } : {}),
      ...(record.message.usage && typeof record.message.usage === "object" ? { usage: record.message.usage } : {}),
    } : undefined;
    const item = {
      type: record.type,
      ...(timestamp ? { timestamp } : {}),
      ...(record.isMeta ? { isMeta: true } : {}),
      ...(record.subtype ? { subtype: record.subtype } : {}),
      ...(record.content !== undefined ? { content: record.content } : {}),
      ...(message ? { message } : {}),
    };
    const messageId = record.type === "assistant" && typeof record?.message?.id === "string" ? record.message.id : null;
    if (messageId && assistantMessages.has(messageId)) {
      const previous = assistantMessages.get(messageId);
      const previousContent = Array.isArray(previous.message?.content) ? previous.message.content : [];
      const nextContent = Array.isArray(message?.content) ? message.content : [];
      const seenBlocks = new Set(previousContent.map((block) => JSON.stringify(block)));
      previous.message.content = [...previousContent, ...nextContent.filter((block) => !seenBlocks.has(JSON.stringify(block)))];
      if (!previous.message.model && message?.model) previous.message.model = message.model;
      if (message?.usage) previous.message.usage = message.usage;
      continue;
    }
    normalized.push(item);
    if (messageId) assistantMessages.set(messageId, item);
  }
  return normalized;
}

export function readRecords(file, agent = "claude") {
  const { records } = recordsFromFileSync(file);
  if (agent === "codex") return normalizeCodexRecords(records);
  if (agent === "cowork") return normalizeCoworkRecords(records);
  return records;
}

export async function readRecordsAsync(file, agent = "claude") {
  const { records } = await recordsFromFile(file);
  if (agent === "codex") return normalizeCodexRecords(records);
  if (agent === "cowork") return normalizeCoworkRecords(records);
  return records;
}

const canonicalRoot = canonicalClaudeRoot;
export { canonicalRoot, canonicalClaudeRoot, canonicalCodexRoots, canonicalCoworkRoot, DEFAULT_WINDOW_DAYS, opaqueId };
