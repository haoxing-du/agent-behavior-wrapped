import { isShareSafeFrustrationQuote } from "./frustration-card.mjs";
import { safeWorkaroundSummary } from "./instrumental-workarounds.mjs";

function safeNumber(value, maximum = 10_000_000_000_000) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= maximum ? number : 0;
}

function safeText(value, maximum = 80) {
  return typeof value === "string" ? value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, maximum) : "";
}

function safeBreakdown(value, labelKey, countKey, allowedLabels) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, allowedLabels.size).flatMap((item) => {
    const label = safeText(item?.[labelKey], 40);
    if (!allowedLabels.has(label)) return [];
    return [{ [labelKey]: label, [countKey]: Math.round(safeNumber(item?.[countKey], 1_000_000_000)), percentage: safeNumber(item?.percentage, 100) }];
  });
}

const stockPhraseLabels = ["You're right", "Say the word", "genuinely", "one wrinkle", "load bearing", "the full picture", "delve"];
const allowedAgents = new Set(["claude", "cowork", "codex"]);

function safeTurnCounts(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 10_000).flatMap((item) => {
    const turns = Number(item);
    return Number.isFinite(turns) && turns >= 1 && turns <= 1_000_000 ? [Math.round(turns)] : [];
  }).sort((left, right) => left - right);
}

function safeStockPhrases(value) {
  if (!Array.isArray(value)) return null;
  const counts = new Map(value.flatMap((item) => stockPhraseLabels.includes(item?.phrase) ? [[item.phrase, Math.round(safeNumber(item?.count, 10_000_000))]] : []));
  return stockPhraseLabels.map((phrase) => ({ phrase, count: counts.get(phrase) || 0 }));
}

export function sanitizePublicReport(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !/^[A-Za-z0-9_-]{8,32}$/.test(value.id || "")) return null;
  const stats = value.stats;
  if (!stats || typeof stats !== "object" || Array.isArray(stats)) return null;
  const safeTokens = Math.round(safeNumber(stats.tokens));
  const suppliedTokenBreakdown = stats.tokenBreakdown;
  const tokenBreakdown = suppliedTokenBreakdown && typeof suppliedTokenBreakdown === "object" && !Array.isArray(suppliedTokenBreakdown) ? {
    input: Math.round(safeNumber(suppliedTokenBreakdown.input)),
    output: Math.round(safeNumber(suppliedTokenBreakdown.output)),
    cacheRead: Math.round(safeNumber(suppliedTokenBreakdown.cacheRead)),
    cacheCreation: Math.round(safeNumber(suppliedTokenBreakdown.cacheCreation)),
    reasoning: Math.round(safeNumber(suppliedTokenBreakdown.reasoning)),
  } : null;
  const safeTokenBreakdown = tokenBreakdown && Object.values(tokenBreakdown).reduce((sum, count) => sum + count, 0) === safeTokens ? tokenBreakdown : null;
  const safeStockPhraseCounts = safeStockPhrases(stats.stockPhrases);
  const safeSessionTurnCounts = safeTurnCounts(stats.sessionTurnCounts);
  const phrase = value.phraseCard?.phrase;
  const safePhrase = typeof phrase === "string" && /^[a-z]+(?:'[a-z]+)?(?: [a-z]+(?:'[a-z]+)?){3,9}$/.test(phrase) ? {
    phrase,
    occurrences: Math.round(safeNumber(value.phraseCard.occurrences, 10_000_000)),
    distinctSessions: Math.round(safeNumber(value.phraseCard.distinctSessions, 1_000_000)),
  } : null;
  const frustrationQuote = value.interactionCard?.frustrationQuote || value.interactionCard?.quote;
  const allowedLanguages = new Set(["English", "Spanish", "French", "German", "Portuguese", "Italian", "Japanese", "Korean", "Chinese", "Arabic", "Hebrew", "Hindi", "Thai", "Cyrillic"]);
  const anomalyLanguage = safeText(stats.languageAnomaly?.language, 40);
  const safeLanguageAnomaly = allowedLanguages.has(anomalyLanguage) ? {
    language: anomalyLanguage,
    words: Math.round(safeNumber(stats.languageAnomaly?.words, 1_000_000_000)),
    occurrences: Math.round(safeNumber(stats.languageAnomaly?.occurrences, 1_000_000)),
  } : null;
  const safeInteractionCard = isShareSafeFrustrationQuote(frustrationQuote) ? { frustrationQuote } : null;
  const safeWorkaroundModels = Array.isArray(value.workaroundCard?.models) ? value.workaroundCard.models.slice(0, 10).flatMap((item) => {
    const name = safeText(item?.name, 80);
    const count = Math.round(safeNumber(item?.count, 1_000_000));
    return name && /^[\p{L}\p{N} ._+-]+$/u.test(name) && count > 0 ? [{ name, count }] : [];
  }) : [];
  const workaroundModelTotal = safeWorkaroundModels.reduce((sum, item) => sum + item.count, 0);
  const safeWorkaroundExample = safeWorkaroundSummary(value.workaroundCard?.example);
  const safeWorkaroundCard = Number.isInteger(value.workaroundCard?.count) && value.workaroundCard.count >= 0 && workaroundModelTotal === value.workaroundCard.count ? {
    count: Math.round(safeNumber(value.workaroundCard.count, 1_000_000)),
    models: safeWorkaroundModels,
    ...(value.workaroundCard.count > 0 && safeWorkaroundExample ? { example: safeWorkaroundExample } : {}),
  } : null;
  const defaultDonationHelperUrl = `http://localhost:4317/donate/${value.id}`;
  const donationHelperUrl = new RegExp(`^http://localhost:[0-9]{2,5}/donate/${value.id}$`).test(value.donationHelperUrl || "") ? value.donationHelperUrl : defaultDonationHelperUrl;
  return {
    id: value.id,
    createdAt: /^\d{4}-\d{2}-\d{2}T/.test(value.createdAt || "") ? value.createdAt : new Date().toISOString(),
    rangeLabel: "Your recent agent history",
    source: safeText(value.source, 40) || "Claude Code + Cowork + Codex",
    stats: {
      sessions: Math.round(safeNumber(stats.sessions, 1_000_000)), activeDays: Math.round(safeNumber(stats.activeDays, 1_000_000)),
      durationMinutes: Math.round(safeNumber(stats.durationMinutes)), prompts: Math.round(safeNumber(stats.prompts)), toolCalls: Math.round(safeNumber(stats.toolCalls)),
      interruptions: Math.round(safeNumber(stats.interruptions)), tokens: safeTokens, ...(safeTokenBreakdown ? { tokenBreakdown: safeTokenBreakdown } : {}), agentWords: Math.round(safeNumber(stats.agentWords)),
      userWords: Math.round(safeNumber(stats.userWords)), agentUserWordRatio: safeNumber(stats.agentUserWordRatio, 10_000),
      averageAgentResponseWords: Math.round(safeNumber(stats.averageAgentResponseWords)), averageUserInputWords: Math.round(safeNumber(stats.averageUserInputWords)),
      longestSessionTurns: Math.max(0, ...safeSessionTurnCounts),
      sessionTurnCounts: safeSessionTurnCounts,
      interactionTone: {
        frustratedMessages: Math.round(safeNumber(stats.interactionTone?.frustratedMessages, 1_000_000)),
        gratefulMessages: Math.round(safeNumber(stats.interactionTone?.gratefulMessages, 1_000_000)),
        analyzedMessages: Math.round(safeNumber(stats.interactionTone?.analyzedMessages, 1_000_000)),
      },
      ...(safeStockPhraseCounts ? { stockPhrases: safeStockPhraseCounts } : {}),
      outputLanguages: safeBreakdown(stats.outputLanguages, "language", "words", allowedLanguages),
      languageAnomaly: safeLanguageAnomaly,
      topics: safeBreakdown(stats.topics, "topic", "tokens", new Set(["Coding", "Writing", "Personal advice", "Research & search", "Planning", "Data & analysis", "Other"])),
      estimatedCostUsd: safeNumber(stats.estimatedCostUsd),
      tools: Array.isArray(stats.tools) ? stats.tools.slice(0, 6).map((item) => ({ name: safeText(item?.name, 40), count: Math.round(safeNumber(item?.count, 100_000_000)) })) : [],
      agents: Array.isArray(stats.agents) ? stats.agents.slice(0, 4).map((item) => ({ agent: allowedAgents.has(item?.agent) ? item.agent : "claude", name: safeText(item?.name, 30), count: Math.round(safeNumber(item?.count, 1_000_000)), percentage: safeNumber(item?.percentage, 100) })) : [],
      models: Array.isArray(stats.models) ? stats.models.slice(0, 10).map((item) => ({ model: safeText(item?.model, 80), name: safeText(item?.name, 80), tokens: Math.round(safeNumber(item?.tokens)), percentage: safeNumber(item?.percentage, 100) })) : [],
    },
    findings: Array.isArray(value.findings) ? value.findings.slice(0, 20).map((item) => ({ id: safeText(item?.id, 40), kind: safeText(item?.kind, 30), title: safeText(item?.title, 120), summary: safeText(item?.summary, 240), confidence: { score: safeNumber(item?.confidence?.score, 1), label: safeText(item?.confidence?.label, 12) } })) : [],
    phraseCard: safePhrase,
    interactionCard: safeInteractionCard,
    workaroundCard: safeWorkaroundCard,
    donationHelperUrl,
    privacy: { shareSafe: true, containsTranscriptText: false, externalTransmission: true },
    hosting: { public: true },
  };
}
