#!/usr/bin/env node
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { discoverAllSessions, readRecords, defaultDateRange, DEFAULT_WINDOW_DAYS } from "./discovery.mjs";
import { analyzeSessions, makeDonationPreview } from "./analysis.mjs";
import { buildPhraseCandidates, OPENROUTER_MODEL, PHRASE_JUDGE_NAME, judgePhraseCard } from "./phrase-card.mjs";
import { loadReport } from "./store.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const dist = path.join(root, "dist");
const fixtureRoot = path.join(root, "fixtures", "projects");
const codexFixtureRoot = path.join(root, "fixtures", "codex-sessions");
const demo = process.argv.includes("--demo");
const portArg = process.argv.find((arg) => arg.startsWith("--port="));
const port = Number(portArg?.split("=")[1] || 4317);
let catalog = loadCatalog();

function loadCatalog() {
  const found = discoverAllSessions(demo ? { claudeRoot: fixtureRoot, codexRoots: [codexFixtureRoot] } : undefined);
  if (demo) {
    found.sessions = found.sessions.map((s, i) => ({ ...s, synthetic: true, label: `Demo session ${i + 1}` }));
  }
  return found;
}

function json(response, status, body) {
  response.writeHead(status, securityHeaders({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }));
  response.end(JSON.stringify(body));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; if (body.length > 1_000_000) reject(new Error("Request too large")); });
    request.on("end", () => { try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error("Invalid JSON")); } });
    request.on("error", reject);
  });
}

function chosenRecords(ids) {
  return ids.flatMap((id) => {
    const session = catalog.index.get(id);
    return session ? [{ sessionId: id, agent: session.agent, records: readRecords(session.file, session.agent) }] : [];
  });
}

function publicCatalog() {
  return {
    rootAvailable: catalog.rootAvailable,
    demo,
    projects: catalog.projects,
    sessions: catalog.sessions.map((s, index) => ({ ...s, label: s.label || `Session ${index + 1}` })),
    defaultRange: defaultDateRange(catalog.sessions, { days: DEFAULT_WINDOW_DAYS, anchorLatest: demo }),
    privacy: { canonicalDirectories: ["~/.claude/projects", "~/.codex/sessions", "~/.codex/archived_sessions"], networkRequests: "during-analysis" },
    phraseJudge: { available: Boolean(process.env.OPENROUTER_API_KEY), model: OPENROUTER_MODEL, name: PHRASE_JUDGE_NAME, provider: "OpenRouter", requiredOnAnalysis: true, freeEndpointDataNotice: true },
  };
}

const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json" };
function securityHeaders(extra = {}) {
  return {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    ...extra,
  };
}
const server = http.createServer(async (request, response) => {
  try {
    if (!new Set([`127.0.0.1:${port}`, `localhost:${port}`]).has(request.headers.host || "")) return json(response, 403, { error: "Local access only" });
    const url = new URL(request.url || "/", `http://${request.headers.host}`);
    if (request.method === "GET" && url.pathname === "/api/discover") {
      catalog = loadCatalog();
      return json(response, 200, publicCatalog());
    }
    if (request.method === "GET" && url.pathname === "/api/health") return json(response, 200, { app: "behavior-wrapped", local: true });
    const reportMatch = url.pathname.match(/^\/api\/reports\/([A-Za-z0-9_-]{8,32})$/);
    if (request.method === "GET" && reportMatch) {
      const report = loadReport(reportMatch[1]);
      if (!report) return json(response, 404, { error: "Saved report not found" });
      const { sessionIds, ...shareSafeReport } = report;
      return json(response, 200, shareSafeReport);
    }
    const selectionMatch = url.pathname.match(/^\/api\/reports\/([A-Za-z0-9_-]{8,32})\/selection$/);
    if (request.method === "GET" && selectionMatch) {
      const report = loadReport(selectionMatch[1]);
      if (!report) return json(response, 404, { error: "Saved report not found" });
      const available = new Set(catalog.sessions.map((session) => session.id));
      const sessionIds = (report.sessionIds?.length ? report.sessionIds : catalog.sessions.map((session) => session.id)).filter((id) => available.has(id));
      return json(response, 200, { sessionIds, localPrivateSelection: true });
    }
    if (request.method === "POST" && (url.pathname === "/api/analyze" || url.pathname === "/api/donation-preview")) {
      const body = await readBody(request);
      const ids = Array.isArray(body.sessionIds) ? body.sessionIds.filter((id) => catalog.index.has(id)).slice(0, 250) : [];
      const records = chosenRecords(ids);
      if (!records.length) return json(response, 400, { error: "Choose at least one available session." });
      if (url.pathname === "/api/analyze") {
        const analyzed = analyzeSessions(records);
        if (!process.env.OPENROUTER_API_KEY) return json(response, 400, { error: "Restart with OPENROUTER_API_KEY set. Every Wrapped includes the Nemotron phrase card." });
        const candidates = buildPhraseCandidates(records, { maximumCandidates: 100 });
        analyzed.phraseCard = await judgePhraseCard(candidates, process.env.OPENROUTER_API_KEY);
        return json(response, 200, analyzed);
      }
      const labels = new Map(publicCatalog().sessions.map((s) => [s.id, s]));
      return json(response, 200, makeDonationPreview(records, labels));
    }
    if (request.method !== "GET" && request.method !== "HEAD") return json(response, 405, { error: "Method not allowed" });
    const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    let file = path.resolve(dist, requested);
    if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, "index.html");
    if (!fs.existsSync(file)) return json(response, 503, { error: "App is not built yet. Run npm run build first." });
    response.writeHead(200, securityHeaders({ "Content-Type": mime[path.extname(file)] || "application/octet-stream", "Cache-Control": file.endsWith("index.html") ? "no-store" : "public, max-age=31536000, immutable" }));
    fs.createReadStream(file).pipe(response);
  } catch (error) {
    json(response, 500, { error: error.message || "Local processing failed" });
  }
});

server.listen(port, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${port}`;
  console.log(`Behavior Wrapped is ready at ${url}`);
  console.log(demo ? "Using synthetic Claude Code + Codex demo sessions." : `Reading Claude Code and Codex sessions locally from ${path.join(os.homedir(), ".claude", "projects")} and ${path.join(os.homedir(), ".codex")}`);
  if (!process.argv.includes("--no-open") && process.env.NODE_ENV !== "test") spawn("open", [url], { stdio: "ignore", detached: true }).unref();
});
