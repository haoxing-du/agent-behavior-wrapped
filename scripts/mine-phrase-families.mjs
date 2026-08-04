#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { redactAggregateText } from "../server/privacy.mjs";

const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
const DEFAULTS = {
  minimumTokens: 3,
  maximumTokens: 30,
  maximumPostingList: 128,
  fingerprintsPerUnit: 12,
  minimumSessions: 2,
  maximumFamilies: 50,
};

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
  return redactAggregateText(String(value)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\[[^\]]+\]\([^\)]+\)/g, " ")
    .replace(/(?:\/Users\/|\/home\/)[^\s,;:]+/g, " [path] ")
    .replace(/\b([A-Z][a-z]{2,})[’']s\b/g, "person's"));
}

function tokenize(value) {
  return value.normalize("NFKC").replace(/[’‘]/g, "'").toLowerCase().match(/[a-z]+(?:'[a-z]+)?|\d+(?:\.\d+)?/g) || [];
}

function normalizedTokens(value) {
  return tokenize(value).map((token) => {
    if (/^\d/.test(token)) return "{number}";
    if (token === "redacted" || token === "credential" || token === "secret") return "{redacted}";
    return token;
  });
}

function displayPhrase(tokens) {
  return tokens.join(" ").replaceAll("{number}", "[number]").replaceAll("{redacted}", "[redacted]");
}

function shingles(tokens) {
  const width = tokens.length <= 3 ? 1 : 2;
  const result = new Set();
  for (let index = 0; index + width <= tokens.length; index++) result.add(tokens.slice(index, index + width).join("\u001f"));
  return result;
}

function tokenEditDistance(left, right, maximumDistance = Infinity) {
  if (Math.abs(left.length - right.length) > maximumDistance) return maximumDistance + 1;
  if (left.length > right.length) return tokenEditDistance(right, left, maximumDistance);
  let previous = Array.from({ length: left.length + 1 }, (_, index) => index);
  for (let row = 1; row <= right.length; row++) {
    const current = [row];
    let rowMinimum = row;
    for (let column = 1; column <= left.length; column++) {
      const value = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (left[column - 1] === right[row - 1] ? 0 : 1),
      );
      current.push(value);
      rowMinimum = Math.min(rowMinimum, value);
    }
    if (rowMinimum > maximumDistance) return maximumDistance + 1;
    previous = current;
  }
  return previous[left.length];
}

function similarityThreshold(leftLength, rightLength) {
  const longest = Math.max(leftLength, rightLength);
  if (longest <= 3) return 2 / 3;
  if (longest <= 5) return 0.7;
  return 0.74;
}

function verifiedSimilarity(left, right) {
  const longest = Math.max(left.length, right.length);
  const threshold = similarityThreshold(left.length, right.length);
  const maximumDistance = Math.floor(longest * (1 - threshold) + 1e-9);
  const distance = tokenEditDistance(left, right, maximumDistance);
  if (distance > maximumDistance) return null;
  return 1 - distance / longest;
}

function commonSubsequence(left, right) {
  const rows = Array.from({ length: left.length + 1 }, () => new Uint16Array(right.length + 1));
  for (let i = left.length - 1; i >= 0; i--) {
    for (let j = right.length - 1; j >= 0; j--) {
      rows[i][j] = left[i] === right[j] ? rows[i + 1][j + 1] + 1 : Math.max(rows[i + 1][j], rows[i][j + 1]);
    }
  }
  const result = [];
  for (let i = 0, j = 0; i < left.length && j < right.length;) {
    if (left[i] === right[j]) { result.push(left[i]); i++; j++; }
    else if (rows[i + 1][j] >= rows[i][j + 1]) i++;
    else j++;
  }
  return result;
}

function templateFor(variants) {
  let common = [...variants[0].tokens];
  for (let index = 1; index < variants.length && common.length; index++) common = commonSubsequence(common, variants[index].tokens);
  if (!common.length) return "[…]";
  const gaps = new Array(common.length + 1).fill(false);
  for (const variant of variants) {
    let cursor = 0;
    for (let index = 0; index < common.length; index++) {
      const found = variant.tokens.indexOf(common[index], cursor);
      if (found > cursor) gaps[index] = true;
      cursor = found + 1;
    }
    if (cursor < variant.tokens.length) gaps[common.length] = true;
  }
  const output = [];
  for (let index = 0; index < common.length; index++) {
    if (gaps[index]) output.push("[…]");
    output.push(common[index]);
  }
  if (gaps[common.length]) output.push("[…]");
  return displayPhrase(output);
}

function entropy(items) {
  if (items.length <= 1) return 0;
  const total = items.reduce((sum, item) => sum + item.occurrences, 0);
  const raw = -items.reduce((sum, item) => {
    const probability = item.occurrences / total;
    return sum + probability * Math.log2(probability);
  }, 0);
  return raw / Math.log2(items.length);
}

function coherentSubgroups(members) {
  const ordered = [...members].sort((a, b) => b.occurrences - a.occurrences || b.sessions.size - a.sessions.size);
  const groups = [];
  for (const member of ordered) {
    let bestGroup = null;
    let bestSimilarity = -1;
    for (const group of groups) {
      const similarity = verifiedSimilarity(member.tokens, group.representative.tokens);
      if (similarity !== null && similarity > bestSimilarity) {
        bestGroup = group;
        bestSimilarity = similarity;
      }
    }
    if (bestGroup) bestGroup.members.push(member);
    else groups.push({ representative: member, members: [member] });
  }
  return groups.map((group) => group.members);
}

function discoverJsonl(root) {
  const files = [];
  let corpusBytes = 0;
  const stack = [root];
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
  return { files, corpusBytes };
}

export async function minePhraseFamilies(inputRoot, options = {}) {
  const config = { ...DEFAULTS, ...options };
  const totalStarted = performance.now();
  const { files, corpusBytes } = discoverJsonl(inputRoot);
  const discoveryFinished = performance.now();
  const variantsByKey = new Map();
  let parsedRecords = 0;
  let modelAssistantMessages = 0;
  let modelAssistantSentences = 0;
  let eligibleUnits = 0;
  let excludedNonModelAssistantRecords = 0;
  let sessionsWithModelResponses = 0;

  for (let sessionIndex = 0; sessionIndex < files.length; sessionIndex++) {
    let hasModelResponse = false;
    const input = fs.createReadStream(files[sessionIndex], { encoding: "utf8" });
    const lines = readline.createInterface({ input, crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line) continue;
      let record;
      try { record = JSON.parse(line); } catch { continue; }
      parsedRecords++;
      if (record.type === "assistant" && !isModelGenerated(record)) { excludedNonModelAssistantRecords++; continue; }
      if (!isModelGenerated(record)) continue;
      const prose = cleanText(visibleText(record));
      if (!prose.trim()) continue;
      hasModelResponse = true;
      modelAssistantMessages++;
      let sentenceIndex = 0;
      for (const segmented of segmenter.segment(prose)) {
        modelAssistantSentences++;
        const clauses = segmented.segment.split(/(?:\n+|\s+[—–]\s+|;\s+)/).filter(Boolean);
        for (const clause of clauses) {
          const tokens = normalizedTokens(clause);
          if (tokens.length < config.minimumTokens || tokens.length > config.maximumTokens) continue;
          eligibleUnits++;
          const key = tokens.join("\u001f");
          let variant = variantsByKey.get(key);
          if (!variant) {
            variant = { tokens, occurrences: 0, sessions: new Set(), openingOccurrences: 0 };
            variantsByKey.set(key, variant);
          }
          variant.occurrences++;
          variant.sessions.add(sessionIndex);
          if (sentenceIndex === 0) variant.openingOccurrences++;
        }
        sentenceIndex++;
      }
    }
    if (hasModelResponse) sessionsWithModelResponses++;
  }
  const parsingFinished = performance.now();

  const variants = [...variantsByKey.values()];
  const postings = new Map();
  for (let id = 0; id < variants.length; id++) {
    variants[id].id = id;
    variants[id].shingles = shingles(variants[id].tokens);
    for (const shingle of variants[id].shingles) {
      let posting = postings.get(shingle);
      if (!posting) postings.set(shingle, posting = []);
      posting.push(id);
    }
  }
  const indexingFinished = performance.now();

  const parent = Int32Array.from({ length: variants.length }, (_, index) => index);
  const rank = new Uint8Array(variants.length);
  const find = (value) => {
    let root = value;
    while (parent[root] !== root) root = parent[root];
    while (parent[value] !== value) { const next = parent[value]; parent[value] = root; value = next; }
    return root;
  };
  const union = (left, right) => {
    left = find(left); right = find(right);
    if (left === right) return;
    if (rank[left] < rank[right]) [left, right] = [right, left];
    parent[right] = left;
    if (rank[left] === rank[right]) rank[left]++;
  };

  let candidatePairs = 0;
  let verifiedPairs = 0;
  let acceptedPairs = 0;
  const postingCap = Math.max(16, Math.min(config.maximumPostingList, Math.ceil(variants.length * 0.05)));
  for (let id = 0; id < variants.length; id++) {
    const variant = variants[id];
    const useful = [...variant.shingles]
      .map((shingle) => postings.get(shingle))
      .filter((posting) => posting.length > 1 && posting.length <= postingCap)
      .sort((a, b) => a.length - b.length)
      .slice(0, config.fingerprintsPerUnit);
    const shared = new Map();
    for (const posting of useful) {
      for (const other of posting) {
        if (other >= id) break;
        shared.set(other, (shared.get(other) || 0) + 1);
      }
    }
    candidatePairs += shared.size;
    for (const [other, sharedShingles] of shared) {
      const otherVariant = variants[other];
      const shortest = Math.min(variant.tokens.length, otherVariant.tokens.length);
      const longest = Math.max(variant.tokens.length, otherVariant.tokens.length);
      if (shortest / longest < 0.65) continue;
      const minimumShared = shortest <= 4 ? 1 : 2;
      if (sharedShingles < minimumShared) continue;
      verifiedPairs++;
      const similarity = verifiedSimilarity(variant.tokens, otherVariant.tokens);
      if (similarity === null) continue;
      acceptedPairs++;
      union(id, other);
    }
  }
  const matchingFinished = performance.now();

  const groups = new Map();
  for (const variant of variants) {
    const root = find(variant.id);
    let group = groups.get(root);
    if (!group) groups.set(root, group = []);
    group.push(variant);
  }
  const coherentGroups = [...groups.values()].flatMap(coherentSubgroups);
  const families = [];
  for (const members of coherentGroups) {
    if (members.length < 2) continue;
    const sessions = new Set(members.flatMap((member) => [...member.sessions]));
    if (sessions.size < config.minimumSessions) continue;
    const occurrences = members.reduce((sum, member) => sum + member.occurrences, 0);
    const openingOccurrences = members.reduce((sum, member) => sum + member.openingOccurrences, 0);
    const representative = members
      .map((member) => ({ member, cost: members.reduce((sum, other) => sum + tokenEditDistance(member.tokens, other.tokens) * other.occurrences, 0) }))
      .sort((a, b) => a.cost - b.cost || b.member.occurrences - a.member.occurrences)[0].member;
    const sortedMembers = [...members].sort((a, b) => b.occurrences - a.occurrences || b.sessions.size - a.sessions.size);
    const template = templateFor(sortedMembers);
    const fixedTemplateTokens = tokenize(template.replaceAll("[…]", " ").replaceAll("[number]", " ")).length;
    if (fixedTemplateTokens < 2) continue;
    families.push({
      representative: displayPhrase(representative.tokens),
      template,
      occurrences,
      distinct_sessions: sessions.size,
      variant_count: members.length,
      opening_rate: Number((openingOccurrences / occurrences).toFixed(4)),
      normalized_variant_entropy: Number(entropy(members).toFixed(4)),
      variants: sortedMembers.slice(0, 8).map((member) => ({
        phrase: displayPhrase(member.tokens),
        occurrences: member.occurrences,
        distinct_sessions: member.sessions.size,
      })),
    });
  }
  families.sort((a, b) => b.distinct_sessions - a.distinct_sessions || b.occurrences - a.occurrences || b.variant_count - a.variant_count);
  const clusteringFinished = performance.now();
  const usage = process.resourceUsage();

  return {
    schema: "behavior-wrapped.near-duplicate-phrase-families.v1",
    generated_at: new Date().toISOString(),
    source: { kind: "claude-code-local", label: path.basename(inputRoot), transcript_content_included: false },
    corpus: {
      session_files: files.length,
      sessions_with_model_responses: sessionsWithModelResponses,
      corpus_bytes: corpusBytes,
      parsed_records: parsedRecords,
      model_assistant_messages: modelAssistantMessages,
      model_assistant_sentences: modelAssistantSentences,
      eligible_sentence_or_clause_units: eligibleUnits,
      unique_normalized_units: variants.length,
      excluded_non_model_assistant_records: excludedNonModelAssistantRecords,
    },
    method: {
      unit: "assistant sentence or semicolon/newline/em-dash clause containing 3-30 tokens",
      normalization: ["Unicode NFKC", "lowercase", "number placeholder", "likely secret/PII redaction", "code/URL/path removal"],
      candidate_generation: `rarest token shingles; up to ${config.fingerprintsPerUnit} postings per unit; posting cap ${postingCap}`,
      verification: "bounded token-level Levenshtein similarity (threshold 0.67-0.74 depending on length)",
      clustering: "union-find connected components split by representative coherence; weighted medoid representative; LCS-derived template",
      minimum_fixed_template_tokens: 2,
      minimum_distinct_sessions: config.minimumSessions,
    },
    candidate_reduction: {
      theoretical_all_pairs: variants.length * (variants.length - 1) / 2,
      generated_candidate_pairs: candidatePairs,
      edit_distance_verified_pairs: verifiedPairs,
      accepted_near_duplicate_pairs: acceptedPairs,
    },
    benchmark: {
      file_discovery_ms: Math.round(discoveryFinished - totalStarted),
      parsing_and_normalization_ms: Math.round(parsingFinished - discoveryFinished),
      shingle_index_ms: Math.round(indexingFinished - parsingFinished),
      candidate_generation_and_verification_ms: Math.round(matchingFinished - indexingFinished),
      clustering_and_ranking_ms: Math.round(clusteringFinished - matchingFinished),
      total_ms: Math.round(clusteringFinished - totalStarted),
      max_rss_mib: Number((usage.maxRSS / 1024).toFixed(2)),
      node_version: process.version,
      platform: process.platform,
      architecture: process.arch,
    },
    privacy: {
      local_only: true,
      raw_transcripts_in_artifact: false,
      review_before_external_upload: true,
      note: "Phrase representatives are model-authored text. Automated redaction is imperfect; review before sharing externally.",
    },
    phrase_families: families.slice(0, config.maximumFamilies).map((family, index) => ({ rank: index + 1, ...family })),
  };
}

async function main() {
  const inputRoot = process.argv[2] ? path.resolve(process.argv[2]) : null;
  const outputFile = process.argv[3] ? path.resolve(process.argv[3]) : null;
  const limitArgument = process.argv.find((argument) => argument.startsWith("--limit="));
  const requestedLimit = limitArgument ? Number.parseInt(limitArgument.slice("--limit=".length), 10) : DEFAULTS.maximumFamilies;
  if (!inputRoot || !outputFile) {
    console.error("Usage: mine-phrase-families.mjs <corpus-directory> <output.json> [--limit=100]");
    process.exitCode = 2;
    return;
  }
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 1000) {
    console.error("--limit must be an integer between 1 and 1000");
    process.exitCode = 2;
    return;
  }
  const artifact = await minePhraseFamilies(inputRoot, { maximumFamilies: requestedLimit });
  fs.mkdirSync(path.dirname(outputFile), { recursive: true, mode: 0o700 });
  fs.writeFileSync(outputFile, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ outputFile, corpus: artifact.corpus, candidates: artifact.candidate_reduction, benchmark: artifact.benchmark, familyCount: artifact.phrase_families.length }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main();
