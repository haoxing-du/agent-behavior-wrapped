#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { redactText } from "../server/privacy.mjs";

const inputRoot = path.resolve(process.argv[2] || "");
const outputFile = path.resolve(process.argv[3] || "");
if (!process.argv[2] || !process.argv[3]) {
  console.error("Usage: benchmark-ngram-extraction.mjs <corpus-directory> <output.json>");
  process.exit(2);
}

const startedAt = new Date().toISOString();
const totalStarted = performance.now();
const files = [];
let corpusBytes = 0;
const stack = [inputRoot];
while (stack.length) {
  const directory = stack.pop();
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const item = path.join(directory, entry.name);
    if (entry.isDirectory()) stack.push(item);
    else if (entry.isFile() && entry.name.endsWith(".jsonl") && !item.includes(`${path.sep}subagents${path.sep}`)) {
      files.push(item);
      corpusBytes += fs.statSync(item).size;
    }
  }
}
files.sort();
const discoveryFinished = performance.now();

const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
const stopwords = new Set("a an and are as at be been but by can could did do does for from had has have he her here him his how i if in into is it its just may me more my no not of on or our out please she should so some than that the their them then there these they this those to up us was we were what when where which who why will with would you your".split(" "));
const counts = new Map();
let parsedRecords = 0;
let modelAssistantMessages = 0;
let modelAssistantSentences = 0;
let excludedNonModelAssistantRecords = 0;
let sessionsWithModelResponses = 0;

function visibleText(record) {
  const content = record?.message?.content ?? record?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((block) => block?.type === "text").map((block) => block.text || "").join("\n");
}

function isModelGenerated(record) {
  return record.type === "assistant" && !record.isApiErrorMessage && record?.message?.model && record.message.model !== "<synthetic>";
}

function cleanText(value) {
  return redactText(String(value)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\[[^\]]+\]\([^\)]+\)/g, " ")
    .replace(/\b([A-Z][a-z]{2,})[’']s\b/g, "person's")).text;
}

function tokens(value) {
  return value.normalize("NFKC").replace(/[’‘]/g, "'").toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) || [];
}

function add(phrase, sessionIndex) {
  let item = counts.get(phrase);
  if (!item) counts.set(phrase, item = { phrase, occurrences: 0, sessions: 0, lastSession: -1 });
  item.occurrences++;
  if (item.lastSession !== sessionIndex) {
    item.sessions++;
    item.lastSession = sessionIndex;
  }
}

for (let sessionIndex = 0; sessionIndex < files.length; sessionIndex++) {
  let hasModelResponse = false;
  const body = fs.readFileSync(files[sessionIndex], "utf8");
  for (const line of body.split("\n")) {
    if (!line) continue;
    let record;
    try { record = JSON.parse(line); } catch { continue; }
    parsedRecords++;
    if (record.type === "assistant" && !isModelGenerated(record)) {
      excludedNonModelAssistantRecords++;
      continue;
    }
    if (!isModelGenerated(record)) continue;
    const prose = cleanText(visibleText(record));
    if (!prose.trim()) continue;
    hasModelResponse = true;
    modelAssistantMessages++;
    for (const part of segmenter.segment(prose)) {
      const sentenceTokens = tokens(part.segment);
      if (!sentenceTokens.length) continue;
      modelAssistantSentences++;
      for (let n = 3; n <= 8; n++) {
        for (let offset = 0; offset + n <= sentenceTokens.length; offset++) {
          const slice = sentenceTokens.slice(offset, offset + n);
          if (slice.filter((token) => !stopwords.has(token)).length < 2) continue;
          add(slice.join(" "), sessionIndex);
        }
      }
    }
  }
  if (hasModelResponse) sessionsWithModelResponses++;
  if ((sessionIndex + 1) % 10_000 === 0) process.stderr.write(`scanned ${sessionIndex + 1}/${files.length}\n`);
}
const scanFinished = performance.now();

function publicRow(row, rank) {
  return {
    rank,
    phrase: row.phrase,
    token_count: row.phrase.split(" ").length,
    occurrences: row.occurrences,
    distinct_sessions: row.sessions,
    session_rate: Number((row.sessions / Math.max(1, sessionsWithModelResponses)).toFixed(6)),
  };
}

const ranked = [...counts.values()]
  .filter((row) => row.sessions >= 3)
  .sort((a, b) => b.occurrences - a.occurrences || b.sessions - a.sessions || b.phrase.split(" ").length - a.phrase.split(" ").length);
const rawTop50 = ranked.slice(0, 50).map(publicRow);

function containsTokens(container, contained) {
  const outer = container.split(" ");
  const inner = contained.split(" ");
  if (inner.length > outer.length) return false;
  outerLoop: for (let offset = 0; offset + inner.length <= outer.length; offset++) {
    for (let index = 0; index < inner.length; index++) if (outer[offset + index] !== inner[index]) continue outerLoop;
    return true;
  }
  return false;
}

const candidates = [];
for (const row of ranked) {
  const redundant = candidates.some((selected) => {
    const nested = containsTokens(row.phrase, selected.phrase) || containsTokens(selected.phrase, row.phrase);
    const occurrenceRatio = Math.min(row.occurrences, selected.occurrences) / Math.max(row.occurrences, selected.occurrences);
    return nested && occurrenceRatio >= 0.72;
  });
  if (!redundant) candidates.push(row);
  if (candidates.length === 50) break;
}
const candidateTop50 = candidates.map(publicRow);
const finished = performance.now();
const resourceUsage = process.resourceUsage();
const scanSeconds = (scanFinished - discoveryFinished) / 1000;

const artifact = {
  schema: "behavior-wrapped.exact-ngram-analysis.v1",
  generated_at: new Date().toISOString(),
  source: {
    kind: "claude-code-export",
    label: path.basename(inputRoot),
    transcript_content_included: false,
  },
  corpus: {
    session_files: files.length,
    sessions_with_model_responses: sessionsWithModelResponses,
    corpus_bytes: corpusBytes,
    parsed_records: parsedRecords,
    model_assistant_messages: modelAssistantMessages,
    model_assistant_sentences: modelAssistantSentences,
    excluded_non_model_assistant_records: excludedNonModelAssistantRecords,
  },
  extraction: {
    ngram_token_lengths: [3, 4, 5, 6, 7, 8],
    exact_after_normalization: true,
    minimum_distinct_sessions: 3,
    excluded_content: ["thinking blocks", "tool calls", "tool results", "code blocks", "inline code", "URLs", "synthetic/API-error assistant records"],
    normalization: ["Unicode NFKC", "lowercase", "apostrophe normalization", "likely secret/PII redaction", "possessive proper-name placeholder"],
    raw_ranking: "occurrences desc, distinct_sessions desc, token_count desc",
    candidate_ranking: "raw ranking with nested phrases suppressed when occurrence counts are within 72%",
  },
  benchmark: {
    started_at: startedAt,
    file_discovery_ms: Math.round(discoveryFinished - totalStarted),
    extraction_ms: Math.round(scanFinished - discoveryFinished),
    ranking_and_serialization_ms: Math.round(finished - scanFinished),
    total_ms: Math.round(finished - totalStarted),
    input_throughput_mib_per_second: Number((corpusBytes / 1048576 / Math.max(scanSeconds, 0.001)).toFixed(2)),
    max_rss_mib: Number((resourceUsage.maxRSS / 1024).toFixed(2)),
    node_version: process.version,
    platform: process.platform,
    architecture: process.arch,
  },
  privacy: {
    local_only: true,
    raw_transcripts_in_artifact: false,
    review_before_external_upload: true,
    note: "Automated redaction is imperfect. Review phrases before sending this file to an external model.",
  },
  recommended_for_llm: "candidate_top_50",
  candidate_top_50: candidateTop50,
  raw_top_50: rawTop50,
};

fs.mkdirSync(path.dirname(outputFile), { recursive: true, mode: 0o700 });
fs.writeFileSync(outputFile, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ outputFile, corpus: artifact.corpus, benchmark: artifact.benchmark, candidateCount: candidateTop50.length, rawCount: rawTop50.length }, null, 2));
