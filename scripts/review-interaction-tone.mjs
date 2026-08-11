#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { discoverAllSessions, readRecords, sessionsInDefaultWindow } from "../server/discovery.mjs";
import { buildInteractionToneCandidates, judgeInteractionToneViaRelay } from "../server/interaction-tone.mjs";
import { getOrCreateClientId } from "../server/store.mjs";

const outputFile = path.resolve(process.argv[2] || "analysis-output/private-interaction-tone-review.md");
const catalog = discoverAllSessions();
const sessions = sessionsInDefaultWindow(catalog.sessions);
if (!sessions.length) throw new Error("No Claude Code or Codex sessions found in the last 30 days.");
const sessionRecords = sessions.map((item) => {
  const session = catalog.index.get(item.id);
  return { sessionId: session.id, agent: session.agent, records: readRecords(session.file, session.agent) };
});
const candidates = buildInteractionToneCandidates(sessionRecords);
if (!candidates.length) throw new Error("No share-safe interaction candidates were found.");
const result = await judgeInteractionToneViaRelay(candidates, { clientId: getOrCreateClientId() });

function section(title, matches) {
  const total = matches.reduce((sum, item) => sum + item.occurrences, 0);
  const rows = matches.length ? matches.map((item) => `- **${Math.round(item.confidence * 100)}% confidence · ${item.occurrences} occurrence${item.occurrences === 1 ? "" : "s"}**\n\n  > ${item.text.replace(/\n/g, " ")}`).join("\n\n") : "_No messages were classified in this category._";
  return `## ${title} — ${total}\n\n${rows}`;
}

const markdown = `# Private interaction-tone review

Generated locally from ${sessions.length} sessions in the latest 30-day window. GPT-5.6 Luna classified ${result.candidateMessages} occurrences represented by ${candidates.length} redacted, deduplicated candidates. Repeated identical excerpts appear once with an occurrence count.

This file is private, gitignored, and may contain excerpts from your session history.

${section("Flagged as yelled", result.privateMatches.frustrated)}

${section("Flagged as thanked", result.privateMatches.grateful)}
`;

fs.mkdirSync(path.dirname(outputFile), { recursive: true, mode: 0o700 });
fs.writeFileSync(outputFile, markdown, { mode: 0o600 });
fs.chmodSync(outputFile, 0o600);
console.log(JSON.stringify({ outputFile, sessions: sessions.length, candidates: candidates.length, frustratedMessages: result.frustratedMessages, gratefulMessages: result.gratefulMessages }));
