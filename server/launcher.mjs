#!/usr/bin/env node
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { discoverAllSessions, readRecords, defaultDateRange, DEFAULT_WINDOW_DAYS } from "./discovery.mjs";
import { analyzeSessions, makeDonationPreview } from "./analysis.mjs";
import { buildPhraseCandidates, OPENROUTER_MODEL, PHRASE_JUDGE_NAME, PHRASE_JUDGE_RELAY_URL, judgePhraseCard, judgePhraseCardViaRelay } from "./phrase-card.mjs";
import { applyInteractionToneJudgment, buildInteractionToneCandidates, emptyInteractionToneJudgment, INTERACTION_TONE_RELAY_URL, judgeInteractionTone, judgeInteractionToneViaRelay } from "./interaction-tone.mjs";
import { applySessionTopicJudgment, buildSessionTopicCandidates, emptySessionTopicJudgment, judgeSessionTopics, judgeSessionTopicsViaRelay, SESSION_TOPIC_RELAY_URL } from "./session-topics.mjs";
import { applyWorkaroundJudgment, buildWorkaroundTrajectories, emptyWorkaroundJudgment, judgeWorkarounds, judgeWorkaroundsViaRelay, WORKAROUND_RELAY_URL } from "./instrumental-workarounds.mjs";
import { getLeaderboardSnapshot, joinLeaderboard, leaderboardAggregateFromReport, LEADERBOARD_RELAY_ORIGIN, leaveLeaderboard, syntheticLeaderboardSnapshot } from "./leaderboard.mjs";
import { getOrCreateClientId, loadReport } from "./store.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const dist = path.join(root, "dist");
const fixtureRoot = path.join(root, "fixtures", "projects");
const codexFixtureRoot = path.join(root, "fixtures", "codex-sessions");
const demo = process.argv.includes("--demo");
const portArg = process.argv.find((arg) => arg.startsWith("--port="));
const port = Number(portArg?.split("=")[1] || 4317);
let catalog = loadCatalog();
let demoLeaderboardParticipation = null;

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

async function optionalAnalysis(promise) {
  try { return await promise; }
  catch { return null; }
}

function publicCatalog() {
  return {
    rootAvailable: catalog.rootAvailable,
    demo,
    projects: catalog.projects,
    sessions: catalog.sessions.map((s, index) => ({ ...s, label: s.label || `Session ${index + 1}` })),
    defaultRange: defaultDateRange(catalog.sessions, { days: DEFAULT_WINDOW_DAYS, anchorLatest: demo }),
    privacy: { canonicalDirectories: ["~/.claude/projects", "~/.codex/sessions", "~/.codex/archived_sessions"], networkRequests: "during-analysis-and-opt-in-leaderboards" },
    phraseJudge: { available: true, model: OPENROUTER_MODEL, name: PHRASE_JUDGE_NAME, provider: "Behavior Wrapped relay + OpenRouter", requiredOnAnalysis: true, freeEndpointDataNotice: true },
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
      const { sessionIds, workaroundReview, ...shareSafeReport } = report;
      shareSafeReport.privacy = { ...shareSafeReport.privacy, shareSafe: true, containsTranscriptText: false };
      return json(response, 200, shareSafeReport);
    }
    const workaroundReviewMatch = url.pathname.match(/^\/api\/reports\/([A-Za-z0-9_-]{8,32})\/workaround-review$/);
    if (request.method === "GET" && workaroundReviewMatch) {
      const report = loadReport(workaroundReviewMatch[1]);
      if (!report) return json(response, 404, { error: "Saved report not found" });
      return json(response, 200, report.workaroundReview || { occurrences: [], borderline: [] });
    }
    const selectionMatch = url.pathname.match(/^\/api\/reports\/([A-Za-z0-9_-]{8,32})\/selection$/);
    if (request.method === "GET" && selectionMatch) {
      const report = loadReport(selectionMatch[1]);
      if (!report) return json(response, 404, { error: "Saved report not found" });
      const available = new Set(catalog.sessions.map((session) => session.id));
      const sessionIds = (report.sessionIds?.length ? report.sessionIds : catalog.sessions.map((session) => session.id)).filter((id) => available.has(id));
      return json(response, 200, { sessionIds, localPrivateSelection: true });
    }
    const leaderboardMatch = url.pathname.match(/^\/api\/reports\/([A-Za-z0-9_-]{8,32})\/leaderboard$/);
    if (leaderboardMatch && new Set(["POST", "DELETE"]).has(request.method)) {
      const report = loadReport(leaderboardMatch[1]);
      if (!report) return json(response, 404, { error: "Saved report not found" });
      const aggregate = leaderboardAggregateFromReport(report);
      if (demo) {
        if (request.method === "DELETE") {
          demoLeaderboardParticipation = null;
          return json(response, 200, { removed: true });
        }
        const body = await readBody(request);
        if (body.action === "join") {
          if (body.consent !== true) return json(response, 400, { error: "Explicit leaderboard consent is required." });
          demoLeaderboardParticipation = {
            joined: true,
            display_name: String(body.displayName || "Anonymous").slice(0, 32),
            public_ranked: body.publicRanked === true,
            shares_phrase: body.includePhrase === true && Boolean(aggregate.favorite_phrase),
          };
        }
        return json(response, 200, syntheticLeaderboardSnapshot(aggregate, demoLeaderboardParticipation));
      }
      const options = {
        clientId: getOrCreateClientId(),
        origin: process.env.BEHAVIOR_WRAPPED_LEADERBOARD_URL || LEADERBOARD_RELAY_ORIGIN,
      };
      if (request.method === "DELETE") return json(response, 200, await leaveLeaderboard(options));
      const body = await readBody(request);
      if (body.action === "snapshot") return json(response, 200, await getLeaderboardSnapshot(aggregate, options));
      if (body.action === "join") {
        return json(response, 200, await joinLeaderboard(aggregate, {
          consent: body.consent === true,
          display_name: typeof body.displayName === "string" ? body.displayName : "",
          public_ranked: body.publicRanked === true,
          include_phrase: body.includePhrase === true,
        }, options));
      }
      return json(response, 400, { error: "Unknown leaderboard action." });
    }
    if (request.method === "POST" && (url.pathname === "/api/analyze" || url.pathname === "/api/donation-preview")) {
      const body = await readBody(request);
      const ids = Array.isArray(body.sessionIds) ? body.sessionIds.filter((id) => catalog.index.has(id)).slice(0, 250) : [];
      const records = chosenRecords(ids);
      if (!records.length) return json(response, 400, { error: "Choose at least one available session." });
      if (url.pathname === "/api/analyze") {
        const candidates = buildPhraseCandidates(records, { maximumCandidates: 100 });
        const interactionCandidates = buildInteractionToneCandidates(records);
        const sessionTopicBundle = buildSessionTopicCandidates(records);
        const workaroundBundle = buildWorkaroundTrajectories(records);
        const phraseCardPromise = process.env.BEHAVIOR_WRAPPED_DIRECT_OPENROUTER === "1"
          ? judgePhraseCard(candidates, process.env.OPENROUTER_API_KEY)
          : judgePhraseCardViaRelay(candidates, { endpoint: process.env.BEHAVIOR_WRAPPED_JUDGE_URL || PHRASE_JUDGE_RELAY_URL, clientId: getOrCreateClientId() });
        const interactionTonePromise = interactionCandidates.length
          ? process.env.BEHAVIOR_WRAPPED_DIRECT_OPENROUTER === "1"
            ? judgeInteractionTone(interactionCandidates, process.env.OPENROUTER_API_KEY)
            : judgeInteractionToneViaRelay(interactionCandidates, { endpoint: process.env.BEHAVIOR_WRAPPED_INTERACTION_TONE_URL || INTERACTION_TONE_RELAY_URL, clientId: getOrCreateClientId() })
          : Promise.resolve(emptyInteractionToneJudgment());
        const sessionTopicsPromise = sessionTopicBundle.candidates.length
          ? process.env.BEHAVIOR_WRAPPED_DIRECT_OPENROUTER === "1"
            ? judgeSessionTopics(sessionTopicBundle, process.env.OPENROUTER_API_KEY)
            : judgeSessionTopicsViaRelay(sessionTopicBundle, { endpoint: process.env.BEHAVIOR_WRAPPED_SESSION_TOPICS_URL || SESSION_TOPIC_RELAY_URL, clientId: getOrCreateClientId() })
          : Promise.resolve(emptySessionTopicJudgment(sessionTopicBundle));
        const workaroundsPromise = workaroundBundle.chunks.length
          ? process.env.BEHAVIOR_WRAPPED_DIRECT_OPENROUTER === "1"
            ? judgeWorkarounds(workaroundBundle, process.env.OPENROUTER_API_KEY)
            : judgeWorkaroundsViaRelay(workaroundBundle, { endpoint: process.env.BEHAVIOR_WRAPPED_WORKAROUND_URL || WORKAROUND_RELAY_URL, clientId: getOrCreateClientId() })
          : Promise.resolve(emptyWorkaroundJudgment(workaroundBundle.coverage));
        const analyzed = analyzeSessions(records);
        const [phraseCard, interactionTone, sessionTopics, workarounds] = await Promise.all([
          phraseCardPromise,
          optionalAnalysis(interactionTonePromise),
          optionalAnalysis(sessionTopicsPromise),
          optionalAnalysis(workaroundsPromise),
        ]);
        analyzed.phraseCard = phraseCard;
        if (interactionTone) applyInteractionToneJudgment(analyzed, interactionTone);
        else delete analyzed.stats.interactionTone;
        if (sessionTopics) applySessionTopicJudgment(analyzed, sessionTopics);
        else analyzed.stats.topics = [];
        applyWorkaroundJudgment(analyzed, workarounds);
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
