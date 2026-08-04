import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

const canonicalClaudeRoot = path.join(os.homedir(), ".claude", "projects");
const canonicalCodexRoots = [path.join(os.homedir(), ".codex", "sessions"), path.join(os.homedir(), ".codex", "archived_sessions")];
const DEFAULT_WINDOW_DAYS = 30;

function opaqueId(value) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function friendlyProjectName(directory, cwd, fallback = "Agent project") {
  const candidate = cwd ? path.basename(cwd) : directory.replace(/^-+/, "").split("-").filter(Boolean).at(-1);
  return (candidate || fallback).replace(/[-_.]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function sampledRecords(file) {
  const stat = fs.statSync(file);
  const fd = fs.openSync(file, "r");
  const buffer = Buffer.alloc(Math.min(stat.size, 1024 * 1024));
  const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
  fs.closeSync(fd);
  return {
    stat,
    records: buffer.subarray(0, bytes).toString("utf8").split("\n").flatMap((line) => {
      if (!line.trim()) return [];
      try { return [JSON.parse(line)]; } catch { return []; }
    }),
  };
}

function baseMetadata({ file, stat, cwd, startedAt, endedAt, promptCount, recordCount, agent, projectFallback }) {
  const projectKey = cwd || `${agent}:${path.dirname(file)}`;
  return {
    id: opaqueId(file),
    file,
    agent,
    agentName: agent === "codex" ? "Codex" : "Claude Code",
    projectId: opaqueId(projectKey),
    projectName: friendlyProjectName(path.basename(path.dirname(file)), cwd, projectFallback),
    startedAt: startedAt || stat.birthtime.toISOString(),
    endedAt: endedAt || stat.mtime.toISOString(),
    promptCount,
    recordCount,
    sizeBytes: stat.size,
    synthetic: false,
  };
}

function readClaudeSessionMetadata(file, projectDirectory) {
  const { stat, records } = sampledRecords(file);
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
  const { stat, records } = sampledRecords(file);
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

export function discoverAllSessions({ claudeRoot = canonicalClaudeRoot, codexRoots = canonicalCodexRoots } = {}) {
  const claude = discoverSessions(claudeRoot);
  const codex = discoverCodexSessions(codexRoots);
  return finishCatalog([...claude.index.values(), ...codex.index.values()], claude.rootAvailable || codex.rootAvailable);
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

function normalizeCodexRecords(records) {
  const normalized = [];
  let currentModel = "Codex model";
  let previousUsage = { input_tokens: 0, output_tokens: 0, cache_write_input_tokens: 0, cached_input_tokens: 0 };
  for (const record of records) {
    const payload = record?.payload || {};
    if (record.type === "turn_context" && typeof payload.model === "string") {
      currentModel = payload.model;
    } else if (record.type === "response_item" && payload.type === "message" && (payload.role === "user" || payload.role === "assistant")) {
      const content = textBlocks(payload.content);
      if (content.length) normalized.push({ type: payload.role, timestamp: record.timestamp, message: { content } });
    } else if (record.type === "response_item" && (payload.type === "function_call" || payload.type === "custom_tool_call")) {
      normalized.push({ type: "assistant", timestamp: record.timestamp, message: { content: [{ type: "tool_use", name: payload.name || "Unknown tool" }] } });
    } else if (record.type === "response_item" && (payload.type === "function_call_output" || payload.type === "custom_tool_call_output")) {
      const output = typeof payload.output === "string" ? payload.output : "";
      normalized.push({ type: "user", isMeta: true, timestamp: record.timestamp, message: { content: [{ type: "tool_result", is_error: /(?:^|\b)(?:error|failed|failure)(?:\b|:)/i.test(output) }] } });
    } else if (record.type === "event_msg" && payload.type === "turn_aborted") {
      normalized.push({ type: "system", subtype: "interrupt", timestamp: record.timestamp, content: "interrupt" });
    } else if (record.type === "event_msg" && payload.type === "token_count" && payload.info?.total_token_usage) {
      const total = payload.info.total_token_usage;
      const usage = Object.fromEntries(Object.keys(previousUsage).map((key) => [key, Math.max(0, (Number(total[key]) || 0) - previousUsage[key])]));
      previousUsage = Object.fromEntries(Object.keys(previousUsage).map((key) => [key, Number(total[key]) || 0]));
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

export function readRecords(file, agent = "claude") {
  const records = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
  return agent === "codex" ? normalizeCodexRecords(records) : records;
}

const canonicalRoot = canonicalClaudeRoot;
export { canonicalRoot, canonicalClaudeRoot, canonicalCodexRoots, DEFAULT_WINDOW_DAYS, opaqueId };
