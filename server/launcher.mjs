#!/usr/bin/env node
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { discoverAllSessionsAsync, readRecordsAsync, defaultDateRange, DEFAULT_WINDOW_DAYS } from "./discovery.mjs";
import { makeDonationPreview } from "./analysis.mjs";
import { deleteDonationReceipt, getOrCreateClientId, loadDonationReceipt, loadReport, saveDonationReceipt } from "./store.mjs";
import { deleteResearchDonation, RESEARCH_DONATION_URL, submitResearchDonation } from "./research-donation.mjs";
import { MAX_DONATION_BYTES } from "./research-donation-schema.mjs";
import { APP_VERSION, LOCAL_DONATION_PROTOCOL } from "./runtime-version.mjs";
import { makeWorkaroundEvidencePreview } from "./workaround-evidence.mjs";
import { makeInteractionEvidencePreview } from "./interaction-evidence.mjs";
import { publicInteractionFeedback, resolveInteractionFeedback, sanitizeInteractionFeedbackSubmission } from "./interaction-feedback.mjs";
import { donationSessionIntegrityError } from "./donation-session-integrity.mjs";
import { createIdleShutdownController } from "./local-helper-runtime.mjs";
import { canonicalSessionDirectoryLabels, openExternalUrl, supportedAgentNames } from "./platform.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const dist = path.join(root, "dist");
const fixtureRoot = path.join(root, "fixtures", "projects");
const codexFixtureRoot = path.join(root, "fixtures", "codex-sessions");
const coworkFixtureRoot = path.join(root, "fixtures", "cowork-sessions");
const demo = process.argv.includes("--demo");
const portArg = process.argv.find((arg) => arg.startsWith("--port="));
const port = Number(portArg?.split("=")[1] || 4317);
const configuredIdleMs = Number(process.env.BEHAVIOR_WRAPPED_HELPER_IDLE_MS);
const helperIdleMs = Number.isFinite(configuredIdleMs) && configuredIdleMs >= 100 ? configuredIdleMs : 5 * 60 * 1_000;
const configuredTestCatalogDelayMs = process.env.NODE_ENV === "test" ? Number(process.env.BEHAVIOR_WRAPPED_TEST_CATALOG_DELAY_MS) : 0;
const testCatalogDelayMs = Number.isFinite(configuredTestCatalogDelayMs) && configuredTestCatalogDelayMs > 0 ? configuredTestCatalogDelayMs : 0;
let catalog = null;
let catalogPromise = null;

async function loadCatalog() {
  if (testCatalogDelayMs) await new Promise((resolve) => setTimeout(resolve, testCatalogDelayMs));
  const found = await discoverAllSessionsAsync(demo ? { claudeRoot: fixtureRoot, coworkRoot: coworkFixtureRoot, codexRoots: [codexFixtureRoot], cache: false } : undefined);
  if (demo) found.sessions = found.sessions.map((session, index) => ({ ...session, synthetic: true, label: `Demo session ${index + 1}` }));
  return found;
}

async function catalogForRequest({ refresh = false } = {}) {
  if (refresh || !catalogPromise) {
    const loading = loadCatalog();
    catalogPromise = loading;
    try {
      catalog = await loading;
    } catch (error) {
      if (catalogPromise === loading) catalogPromise = null;
      throw error;
    }
  }
  return catalogPromise;
}

function securityHeaders(extra = {}) {
  return {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    ...extra,
  };
}

function json(response, status, body) {
  response.writeHead(status, securityHeaders({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }));
  response.end(JSON.stringify(body));
}

function readBody(request, maximumBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let rejected = false;
    request.on("data", (chunk) => {
      if (rejected) return;
      size += chunk.length;
      if (size > maximumBytes) {
        rejected = true;
        reject(new Error("Request too large"));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (rejected) return;
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); }
      catch { reject(new Error("Invalid JSON")); }
    });
    request.on("error", reject);
  });
}

async function chosenRecords(ids, options = {}, activeCatalog = null) {
  const availableCatalog = activeCatalog || await catalogForRequest();
  const selected = [];
  for (const id of ids) {
    const session = availableCatalog.index.get(id);
    if (session) selected.push({ sessionId: id, agent: session.agent, records: await readRecordsAsync(session.file, session.agent, options) });
  }
  return selected;
}

function publicCatalog(availableCatalog) {
  const agentNames = supportedAgentNames(process.platform, { includeCowork: demo || process.platform === "darwin" });
  return {
    rootAvailable: availableCatalog.rootAvailable,
    demo,
    projects: availableCatalog.projects,
    sessions: availableCatalog.sessions.map((session, index) => ({ ...session, label: session.label || `Session ${index + 1}` })),
    defaultRange: defaultDateRange(availableCatalog.sessions, { days: DEFAULT_WINDOW_DAYS, anchorLatest: demo }),
    agentNames,
    privacy: { canonicalDirectories: canonicalSessionDirectoryLabels(), networkRequests: "only-after-final-donation-consent" },
  };
}

const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json" };
const server = http.createServer(async (request, response) => {
  try {
    if (!new Set([`127.0.0.1:${port}`, `localhost:${port}`]).has(request.headers.host || "")) return json(response, 403, { error: "Local access only" });
    idleShutdown.touch();
    const url = new URL(request.url || "/", `http://${request.headers.host}`);
    if (request.method === "GET" && url.pathname === "/api/health") return json(response, 200, { app: "behavior-wrapped", version: APP_VERSION, local: true, purpose: "research-donation", donationProtocol: LOCAL_DONATION_PROTOCOL, pid: process.pid, demo, catalogState: catalog ? "ready" : catalogPromise ? "loading" : "not-loaded" });
    if (request.method === "GET" && url.pathname === "/api/discover") {
      const availableCatalog = await catalogForRequest({ refresh: true });
      return json(response, 200, publicCatalog(availableCatalog));
    }
    const reportMatch = url.pathname.match(/^\/api\/reports\/([A-Za-z0-9_-]{8,32})$/);
    if (request.method === "GET" && reportMatch) {
      const report = loadReport(reportMatch[1]);
      if (!report) return json(response, 404, { error: "Saved report not found" });
      const { sessionIds, workaroundReview, interactionReview, apologyReview, ...shareSafeReport } = report;
      shareSafeReport.privacy = { ...shareSafeReport.privacy, shareSafe: true, containsTranscriptText: false };
      return json(response, 200, shareSafeReport);
    }
    const selectionMatch = url.pathname.match(/^\/api\/reports\/([A-Za-z0-9_-]{8,32})\/selection$/);
    if (request.method === "GET" && selectionMatch) {
      const report = loadReport(selectionMatch[1]);
      if (!report) return json(response, 404, { error: "Saved report not found" });
      const availableCatalog = await catalogForRequest();
      const available = new Set(availableCatalog.sessions.map((session) => session.id));
      return json(response, 200, { sessionIds: (report.sessionIds || []).filter((id) => available.has(id)), localPrivateSelection: true });
    }
    const workaroundEvidenceMatch = url.pathname.match(/^\/api\/reports\/([A-Za-z0-9_-]{8,32})\/workarounds$/);
    if (request.method === "GET" && workaroundEvidenceMatch) {
      const report = loadReport(workaroundEvidenceMatch[1]);
      if (!report) return json(response, 404, { error: "Saved report not found" });
      const availableCatalog = await catalogForRequest();
      const allowed = new Set(report.sessionIds || []);
      const ids = [...new Set((report.workaroundReview?.occurrences || []).map((occurrence) => occurrence?.location?.sessionId).filter((id) => allowed.has(id) && availableCatalog.index.has(id)))].slice(0, 100);
      const records = await chosenRecords(ids, { includePrivateToolDetails: true }, availableCatalog);
      const labels = new Map(publicCatalog(availableCatalog).sessions.map((session) => [session.id, session]));
      return json(response, 200, makeWorkaroundEvidencePreview(report, records, labels));
    }
    const interactionEvidenceMatch = url.pathname.match(/^\/api\/reports\/([A-Za-z0-9_-]{8,32})\/interactions$/);
    if (request.method === "GET" && interactionEvidenceMatch) {
      const report = loadReport(interactionEvidenceMatch[1]);
      if (!report) return json(response, 404, { error: "Saved report not found" });
      const availableCatalog = await catalogForRequest();
      const allowed = new Set(report.sessionIds || []);
      const references = [...(report.interactionReview?.frustrated || []), ...(report.interactionReview?.grateful || []), ...(report.apologyReview?.user || []), ...(report.apologyReview?.agent || [])];
      const ids = [...new Set(references.map((reference) => reference?.location?.sessionId).filter((id) => allowed.has(id) && availableCatalog.index.has(id)))].slice(0, 200);
      const records = await chosenRecords(ids, {}, availableCatalog);
      const labels = new Map(publicCatalog(availableCatalog).sessions.map((session) => [session.id, session]));
      return json(response, 200, makeInteractionEvidencePreview(report, records, labels));
    }
    const interactionFeedbackMatch = url.pathname.match(/^\/api\/reports\/([A-Za-z0-9_-]{8,32})\/interaction-feedback\/(yelling|thanking)-([1-9][0-9]{0,2})$/);
    if (request.method === "GET" && interactionFeedbackMatch) {
      const report = loadReport(interactionFeedbackMatch[1]);
      if (!report) return json(response, 404, { error: "Saved report not found" });
      const feedbackId = `${interactionFeedbackMatch[2]}-${interactionFeedbackMatch[3]}`;
      const reference = resolveInteractionFeedback(report, feedbackId);
      if (!reference) return json(response, 404, { error: "That interaction classification is no longer available." });
      const availableCatalog = await catalogForRequest();
      if (!availableCatalog.index.has(reference.sessionId)) return json(response, 404, { error: "The source session is no longer available on this device." });
      const records = await chosenRecords([reference.sessionId], {}, availableCatalog);
      const trusted = resolveInteractionFeedback(report, feedbackId, new Map(records.map((session) => [session.sessionId, session.records])));
      return json(response, 200, { sessionIds: [reference.sessionId], feedback: publicInteractionFeedback(trusted), localPrivateSelection: true });
    }
    if (request.method === "POST" && url.pathname === "/api/donation-preview") {
      const body = await readBody(request);
      const report = loadReport(body.reportId);
      if (!report) return json(response, 404, { error: "Saved report not found" });
      const availableCatalog = await catalogForRequest();
      const feedback = body.feedbackId ? resolveInteractionFeedback(report, body.feedbackId) : null;
      if (body.feedbackId && !feedback) return json(response, 400, { error: "Invalid classifier-feedback selection." });
      const allowed = new Set(report.sessionIds || []);
      const ids = feedback
        ? [feedback.sessionId].filter((id) => availableCatalog.index.has(id))
        : Array.isArray(body.sessionIds) ? body.sessionIds.filter((id) => allowed.has(id) && availableCatalog.index.has(id)).slice(0, 250) : [];
      const records = await chosenRecords(ids, {}, availableCatalog);
      if (!records.length) return json(response, 400, { error: "Choose at least one available session." });
      const labels = new Map(publicCatalog(availableCatalog).sessions.map((session) => [session.id, session]));
      const disabledRedactions = Array.isArray(body.disabledRedactions) ? body.disabledRedactions.filter((kind) => typeof kind === "string" && /^[a-z0-9-]{1,64}$/.test(kind)).slice(0, 20) : [];
      const disabledMatches = Array.isArray(body.disabledMatches) ? body.disabledMatches.filter((id) => typeof id === "string" && /^[a-f0-9]{24}$/.test(id)).slice(0, 5_000) : [];
      const unredacted = body.previewMode === "unredacted";
      return json(response, 200, makeDonationPreview(records, labels, { disabledRedactions, disabledMatches, unredacted }));
    }
    if (request.method === "POST" && url.pathname === "/api/research-donations") {
      const body = await readBody(request, MAX_DONATION_BYTES + 1_000_000);
      const report = loadReport(body?.donation?.reportId);
      if (!report) return json(response, 404, { error: "Saved report not found" });
      let donation = body.donation;
      const suppliedSessions = Array.isArray(donation?.sessions) ? donation.sessions : [];
      const suppliedIds = suppliedSessions.map((session) => session?.sessionId);
      const allowed = new Set(report.sessionIds || []);
      const uniqueIds = new Set(suppliedIds);
      if (!suppliedIds.length || uniqueIds.size !== suppliedIds.length || suppliedIds.some((id) => !allowed.has(id))) return json(response, 400, { error: "Donated sessions must come from this report." });
      const feedbackReference = body.feedback ? resolveInteractionFeedback(report, body.feedback.feedbackId) : null;
      if (body.feedback && (!feedbackReference || suppliedSessions.length !== 1 || suppliedIds[0] !== feedbackReference.sessionId)) return json(response, 400, { error: "Classifier feedback must contain only its original session." });
      const availableCatalog = await catalogForRequest();
      if (suppliedIds.some((id) => !availableCatalog.index.has(id))) return json(response, 404, { error: "A selected source session is no longer available on this device." });
      const records = await chosenRecords(suppliedIds, {}, availableCatalog);
      const sourceSessions = makeDonationPreview(records, new Map(), { unredacted: true }).sessions;
      const integrityError = donationSessionIntegrityError(suppliedSessions, sourceSessions);
      if (integrityError) return json(response, 400, { error: integrityError });
      if (body.feedback) {
        const trusted = resolveInteractionFeedback(report, body.feedback.feedbackId, new Map(records.map((session) => [session.sessionId, session.records])));
        const classifierFeedback = sanitizeInteractionFeedbackSubmission(body.feedback, trusted);
        if (!classifierFeedback) return json(response, 400, { error: "Choose a valid corrected classification before donating." });
        donation = {
          ...donation,
          purpose: "classifier_feedback",
          classifierFeedback,
          consent: { ...donation.consent, classifierFeedback: true },
        };
      } else donation = { ...donation, purpose: "general_research", classifierFeedback: undefined };
      if (demo) return json(response, 201, { accepted: true, donation_id: "demo-not-transmitted", demo: true });
      const result = await submitResearchDonation(donation, {
        clientId: getOrCreateClientId(),
        endpoint: process.env.BEHAVIOR_WRAPPED_DONATION_URL || RESEARCH_DONATION_URL,
      });
      saveDonationReceipt(result);
      return json(response, 201, { accepted: true, donation_id: result.donation_id, encrypted: true });
    }
    const donationMatch = url.pathname.match(/^\/api\/research-donations\/([0-9a-f-]{36})$/);
    if (request.method === "DELETE" && donationMatch) {
      const receipt = loadDonationReceipt(donationMatch[1]);
      if (!receipt) return json(response, 404, { error: "Local deletion receipt not found." });
      if (demo) { deleteDonationReceipt(donationMatch[1]); return json(response, 200, { deleted: true, demo: true }); }
      const result = await deleteResearchDonation(receipt.donationId, receipt.deletionToken, { endpoint: process.env.BEHAVIOR_WRAPPED_DONATION_URL || RESEARCH_DONATION_URL });
      deleteDonationReceipt(donationMatch[1]);
      return json(response, 200, result);
    }
    if (request.method !== "GET" && request.method !== "HEAD") return json(response, 405, { error: "Method not allowed" });
    const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    let file = path.resolve(dist, requested);
    if (!file.startsWith(`${dist}${path.sep}`) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, "index.html");
    if (!fs.existsSync(file)) return json(response, 503, { error: "App is not built yet. Run npm run build first." });
    response.writeHead(200, securityHeaders({ "Content-Type": mime[path.extname(file)] || "application/octet-stream", "Cache-Control": file.endsWith("index.html") ? "no-store" : "public, max-age=31536000, immutable" }));
    fs.createReadStream(file).pipe(response);
  } catch (error) {
    if (!response.headersSent) json(response, error.message === "Request too large" ? 413 : 500, { error: error.message || "Local processing failed" });
  }
});

const idleShutdown = createIdleShutdownController({
  enabled: process.env.BEHAVIOR_WRAPPED_DAEMON === "1",
  idleMs: helperIdleMs,
  onIdle: () => server.close(() => process.exit(0)),
});

server.listen(port, "127.0.0.1", () => {
  const url = `http://localhost:${port}`;
  console.log(`Behavior Wrapped donation helper is ready at ${url}`);
  const sessionDirectories = canonicalSessionDirectoryLabels().join(", ");
  console.log(demo ? "Using synthetic demo sessions." : `Donation review reads selected sessions locally from ${sessionDirectories}.`);
  if (!process.argv.includes("--no-open") && process.env.NODE_ENV !== "test") openExternalUrl(url);
});
