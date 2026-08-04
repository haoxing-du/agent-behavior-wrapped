#!/usr/bin/env node
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { discoverAllSessions, readRecords, sessionsInDefaultWindow, DEFAULT_WINDOW_DAYS } from "./discovery.mjs";
import { analyzeSessions } from "./analysis.mjs";
import { buildPhraseCandidates, judgePhraseCard } from "./phrase-card.mjs";
import { createReportId, deleteReport, listReports, saveReport, storeRoot } from "./store.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const fixtureRoot = path.join(root, "fixtures", "projects");
const codexFixtureRoot = path.join(root, "fixtures", "codex-sessions");
const port = Number(process.env.BEHAVIOR_WRAPPED_PORT || 4317);
const baseUrl = `http://127.0.0.1:${port}`;
const command = process.argv[2];
const muted = "\x1b[2m"; const bright = "\x1b[1m"; const lime = "\x1b[38;2;201;242;75m"; const purple = "\x1b[38;2;141;92;255m"; const reset = "\x1b[0m";

const mark = `${lime}
       ◆
      ◆◆◆
    ◆◆◆◆◆◆
   ◆◆◆◆◆◆◆◆
     ◆◆◆◆◆◆
       ◆◆◆
        ◆${reset}`;

function formatNumber(value) {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function formatRange(sessions) {
  const values = sessions.map((s) => new Date(s.startedAt)).filter((d) => !Number.isNaN(d.getTime())).sort((a, b) => a.getTime() - b.getTime());
  if (!values.length) return "Your coding history";
  const format = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: values[0].getFullYear() === values.at(-1).getFullYear() ? undefined : "numeric" });
  const year = values.at(-1).getFullYear();
  return `${format.format(values[0])} – ${format.format(values.at(-1))}, ${year}`;
}

async function serverReady() {
  try {
    const response = await fetch(`${baseUrl}/api/health`);
    return response.ok && (await response.json()).app === "behavior-wrapped";
  } catch { return false; }
}

async function ensureServer() {
  if (await serverReady()) return;
  const child = spawn(process.execPath, [path.join(here, "launcher.mjs"), `--port=${port}`, "--no-open"], { detached: true, stdio: "ignore", env: { ...process.env, BEHAVIOR_WRAPPED_DAEMON: "1" } });
  child.unref();
  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (await serverReady()) return;
  }
  throw new Error(`Could not start the local report viewer on port ${port}.`);
}

function openUrl(url) {
  if (process.argv.includes("--no-open")) return;
  spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
}

function printList() {
  const reports = listReports();
  console.log(`\n${bright}behavior-wrapped reports${reset}\n`);
  if (!reports.length) { console.log(`${muted}No saved reports yet. Run behavior-wrapped to make one.${reset}\n`); return; }
  for (const report of reports) console.log(`${purple}${report.id}${reset}  ${report.rangeLabel}  ·  ${report.stats.sessions} sessions  ·  ${formatNumber(report.stats.tokens || 0)} tokens`);
  console.log(`\n${muted}Open one: behavior-wrapped open <id>${reset}\n`);
}

async function openSaved(id) {
  const report = id ? listReports().find((item) => item.id === id) : listReports()[0];
  if (!report) throw new Error("That saved report was not found.");
  await ensureServer();
  const url = `${baseUrl}/w/${report.id}`;
  console.log(`${purple}${url}${reset}`);
  openUrl(url);
}

async function createWrapped() {
  console.log(mark);
  console.log(`\n  ${bright}behavior-wrapped${reset}  ${muted}·  the wrapped for your coding agent${reset}\n`);
  const demo = process.argv.includes("--demo");
  const daysArgument = process.argv.find((argument) => argument.startsWith("--days="));
  const windowDays = daysArgument ? Number(daysArgument.split("=")[1]) : DEFAULT_WINDOW_DAYS;
  if (!Number.isInteger(windowDays) || windowDays < 1 || windowDays > 3650) throw new Error("--days must be a whole number from 1 to 3650.");
  const catalog = discoverAllSessions(demo ? { claudeRoot: fixtureRoot, codexRoots: [codexFixtureRoot] } : undefined);
  const chosenSessions = sessionsInDefaultWindow(catalog.sessions, { days: windowDays, anchorLatest: demo });
  if (!chosenSessions.length) throw new Error(`No Claude Code or Codex sessions found in the last ${windowDays} days.`);
  process.stdout.write(`${muted}◇  Reading ${chosenSessions.length} local Claude Code + Codex sessions from the last ${windowDays} days…${reset}\r`);
  const sessionRecords = chosenSessions.map((publicSession) => {
    const session = catalog.index.get(publicSession.id);
    return { sessionId: session.id, agent: session.agent, records: readRecords(session.file, session.agent) };
  });
  const analyzed = analyzeSessions(sessionRecords);
  const includePhraseCard = process.argv.includes("--with-phrase-card");
  if (includePhraseCard) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("--with-phrase-card needs ANTHROPIC_API_KEY in your environment.");
    const candidates = buildPhraseCandidates(sessionRecords);
    process.stdout.write(`${muted}◇  Asking Haiku to pick from ${candidates.length} redacted aggregate phrases…${reset}\r`);
    analyzed.phraseCard = await judgePhraseCard(candidates, process.env.ANTHROPIC_API_KEY);
  }
  const id = createReportId();
  const safeFindings = analyzed.findings.map(({ evidence, method, ...finding }) => finding);
  const report = { id, createdAt: new Date().toISOString(), rangeLabel: formatRange(chosenSessions), source: "Claude Code + Codex", stats: analyzed.stats, findings: safeFindings, phraseCard: analyzed.phraseCard || null, sessionIds: chosenSessions.map((session) => session.id), privacy: { shareSafe: true, containsTranscriptText: false, externalTransmission: includePhraseCard, transmittedData: includePhraseCard ? "redacted aggregate phrase candidates only" : "none" } };
  saveReport(report);
  await ensureServer();
  const url = `${baseUrl}/w/${id}`;
  const tokenLabel = formatNumber(report.stats.tokens || 0);
  console.log(`◇  ${bright}Wrapped ready${reset} · ${tokenLabel} tokens across ${report.stats.sessions} sessions          `);
  if (report.phraseCard) console.log(`◇  Haiku's pick · “${report.phraseCard.phrase}” × ${report.phraseCard.occurrences}          `);
  console.log(`│\n◇  Your wrapped is live locally ─────────────────────────╮`);
  console.log(`│                                                        │`);
  console.log(`│  ${purple}${bright}${url}${reset}`);
  console.log(`│                                                        │`);
  console.log(`│  ${tokenLabel} tokens  ·  ${report.stats.toolCalls} tool calls  ·  ${report.stats.sessions} sessions`);
  console.log(`│                                                        │`);
  console.log(`├────────────────────────────────────────────────────────╯`);
  console.log(`│\n└  ${muted}saved to ${storeRoot}  ·  behavior-wrapped list / delete <id>${reset}\n`);
  openUrl(url);
}

try {
  if (command === "list") printList();
  else if (command === "open") await openSaved(process.argv[3]);
  else if (command === "delete") {
    const id = process.argv[3];
    if (!id) throw new Error("Usage: behavior-wrapped delete <id>");
    console.log(deleteReport(id) ? `Deleted local report ${id}.` : "That saved report was not found.");
  } else if (command === "help" || command === "--help" || command === "-h") {
    console.log("behavior-wrapped [--demo] [--days=30] [--no-open] [--with-phrase-card]\nbehavior-wrapped list\nbehavior-wrapped open [id]\nbehavior-wrapped delete <id>");
  } else await createWrapped();
} catch (error) {
  console.error(`\n${bright}Could not create your Wrapped.${reset} ${error.message}\n`);
  process.exitCode = 1;
}
