import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

const canonicalRoot = path.join(os.homedir(), ".claude", "projects");

function opaqueId(value) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function friendlyProjectName(directory, cwd) {
  const candidate = cwd ? path.basename(cwd) : directory.replace(/^-+/, "").split("-").filter(Boolean).at(-1);
  return (candidate || "Claude project").replace(/[-_.]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function readSessionMetadata(file, projectDirectory) {
  const stat = fs.statSync(file);
  const fd = fs.openSync(file, "r");
  const buffer = Buffer.alloc(Math.min(stat.size, 1024 * 1024));
  const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
  fs.closeSync(fd);
  let firstTimestamp = null;
  let lastTimestamp = null;
  let cwd = null;
  let promptCount = 0;
  let recordCount = 0;
  for (const line of buffer.subarray(0, bytes).toString("utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      recordCount++;
      if (!cwd && record.cwd) cwd = record.cwd;
      if (record.timestamp) {
        firstTimestamp ||= record.timestamp;
        lastTimestamp = record.timestamp;
      }
      if (record.type === "user" && !record.isMeta) promptCount++;
    } catch {}
  }
  const sessionId = opaqueId(file);
  return {
    id: sessionId,
    file,
    projectId: opaqueId(path.dirname(file)),
    projectName: friendlyProjectName(projectDirectory, cwd),
    startedAt: firstTimestamp || stat.birthtime.toISOString(),
    endedAt: lastTimestamp || stat.mtime.toISOString(),
    promptCount,
    recordCount,
    sizeBytes: stat.size,
    synthetic: false,
  };
}

export function discoverSessions(root = canonicalRoot) {
  if (!fs.existsSync(root)) return { rootAvailable: false, projects: [], sessions: [], index: new Map() };
  const sessions = [];
  for (const project of fs.readdirSync(root, { withFileTypes: true })) {
    if (!project.isDirectory()) continue;
    const projectPath = path.join(root, project.name);
    for (const entry of fs.readdirSync(projectPath, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      try { sessions.push(readSessionMetadata(path.join(projectPath, entry.name), project.name)); } catch {}
    }
  }
  sessions.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const projectMap = new Map();
  for (const session of sessions) {
    const current = projectMap.get(session.projectId) || { id: session.projectId, name: session.projectName, sessionCount: 0, latestAt: session.startedAt };
    current.sessionCount++;
    if (session.startedAt > current.latestAt) current.latestAt = session.startedAt;
    projectMap.set(session.projectId, current);
  }
  const publicSessions = sessions.map(({ file, ...session }) => session);
  return {
    rootAvailable: true,
    projects: [...projectMap.values()].sort((a, b) => b.latestAt.localeCompare(a.latestAt)),
    sessions: publicSessions,
    index: new Map(sessions.map((session) => [session.id, session])),
  };
}

export function readRecords(file) {
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

export { canonicalRoot, opaqueId };
