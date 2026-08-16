import crypto from "node:crypto";
import { safeEvidenceText, redactText } from "./privacy.mjs";
import { isFrustratedMessage, isGratefulMessage } from "./frustration-card.mjs";
import { displayModelName } from "./model-names.mjs";

export { displayModelName } from "./model-names.mjs";

const wordSegmenter = new Intl.Segmenter("en", { granularity: "word" });
const stockPhraseDefinitions = [
  { phrase: "You're right", expression: /\byou['’]re right\b/giu },
  { phrase: "Say the word", expression: /\bsay the word\b/giu },
  { phrase: "genuinely", expression: /\bgenuinely\b/giu },
  { phrase: "one wrinkle", expression: /\bone wrinkle\b/giu },
  { phrase: "load bearing", expression: /\bload(?:\s+|-)bearing\b/giu },
  { phrase: "the full picture", expression: /\bthe full picture\b/giu },
  { phrase: "delve", expression: /\bdelve\b/giu },
];
const agentDefinitions = [
  { agent: "claude", name: "Claude Code" },
  { agent: "cowork", name: "Cowork" },
  { agent: "codex", name: "Codex" },
];

const languageLexicons = [
  ["Spanish", new Set("el la los las una unas para pero porque como esto esta este muy más con del quiero puede puedes hacer gracias ahora".split(" "))],
  ["French", new Set("le la les des une pour mais parce avec dans est sont cette ça très plus vous peux peut faire merci maintenant".split(" "))],
  ["German", new Set("der die das den dem ein eine für aber weil mit ist sind diese sehr mehr ich du können bitte danke jetzt".split(" "))],
  ["Portuguese", new Set("uma para mas porque com isso esta este muito mais você pode fazer obrigado agora não".split(" "))],
  ["Italian", new Set("il lo la gli le una per ma perché con questo questa molto più puoi fare grazie adesso non".split(" "))],
];

const topicRules = [
  ["Coding", /\b(?:code|coding|bug|function|class|api|database|component|frontend|backend|deploy|repository|repo|git|test|typescript|javascript|python|react|npm|css|html|sql|terminal|command|build|implement|refactor|debug|package|server|cli|script|compile|lint|endpoint|schema|migration)\b|\.(?:js|jsx|ts|tsx|py|rs|go|java|rb|css|html|sql|json|yaml|yml)\b/gi],
  ["Writing", /\b(?:write|rewrite|edit|draft|copy|essay|article|email|post|tone|grammar|wording|proofread|document|memo|blog|story|resume|cover letter|headline|paragraph)\b/gi],
  ["Personal advice", /\b(?:personal advice|relationship|partner|friend|family|career|life advice|anxious|anxiety|stressed|feel|feeling|should i|help me decide|therapy|therapist|breakup|dating)\b/gi],
  ["Research & search", /\b(?:search|find|look up|research|compare|comparison|what is|who is|when did|sources?|citations?|latest|recommend|recommendation|investigate|explain|overview)\b/gi],
  ["Planning", /\b(?:plan|roadmap|schedule|itinerary|organize|prioritize|steps|strategy|milestones?|timeline|prepare|checklist|agenda|project plan)\b/gi],
  ["Data & analysis", /\b(?:analyze|analysis|data|dataset|spreadsheet|csv|metrics?|chart|statistics?|trend|distribution|correlation|survey|dashboard|visualization)\b/gi],
];

function contentBlocks(record) {
  const content = record?.message?.content ?? record?.content;
  if (Array.isArray(content)) return content;
  if (typeof content === "string") return [{ type: "text", text: content }];
  return [];
}

function visibleText(record) {
  return contentBlocks(record).filter((block) => block?.type === "text").map((block) => block.text || "").join("\n").trim();
}

function wordCount(value) {
  let count = 0;
  for (const part of wordSegmenter.segment(value)) if (part.isWordLike) count++;
  return count;
}

function proseText(value) {
  return String(value || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`\n]+`/g, " ")
    .replace(/^\s*>.*$/gm, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\b(?:[A-Za-z]:)?[/.~][^\s]+/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stockPhraseCounts(texts) {
  return stockPhraseDefinitions.map(({ phrase, expression }) => ({
    phrase,
    count: texts.reduce((sum, value) => {
      expression.lastIndex = 0;
      return sum + [...proseText(value).matchAll(expression)].length;
    }, 0),
  }));
}

const anomalyScripts = [
  { language: "Japanese", locale: "ja", expression: /[\p{Script=Hiragana}\p{Script=Katakana}]/gu },
  { language: "Korean", locale: "ko", expression: /\p{Script=Hangul}/gu },
  { language: "Chinese", locale: "zh", expression: /\p{Script=Han}/gu },
  { language: "Arabic", locale: "ar", expression: /\p{Script=Arabic}/gu },
  { language: "Hebrew", locale: "he", expression: /\p{Script=Hebrew}/gu },
  { language: "Hindi", locale: "hi", expression: /\p{Script=Devanagari}/gu },
  { language: "Thai", locale: "th", expression: /\p{Script=Thai}/gu },
  { language: "Cyrillic", locale: "ru", expression: /\p{Script=Cyrillic}/gu },
];
const anomalySegmenters = new Map(anomalyScripts.map(({ language, locale }) => [language, new Intl.Segmenter(locale, { granularity: "word" })]));

function scriptWords(value, script) {
  script.expression.lastIndex = 0;
  if (!script.expression.test(value)) return 0;
  if (script.language === "Chinese" && /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(value)) return 0;
  let words = 0;
  for (const part of anomalySegmenters.get(script.language).segment(value)) {
    script.expression.lastIndex = 0;
    if (part.isWordLike && script.expression.test(part.segment)) words++;
  }
  return words;
}

function containsScript(value, script) {
  script.expression.lastIndex = 0;
  return script.expression.test(String(value || ""));
}

function languageAnomalyBreakdown(sessionRecords) {
  const totals = new Map();
  for (const { records } of sessionRecords) {
    const allAssistantProse = records.filter((record) => record.type === "assistant").map((record) => proseText(visibleText(record))).filter(Boolean).join(" ");
    const dominantLanguage = languageForChunk(allAssistantProse);
    if (!dominantLanguage) continue;
    let precedingUser = "";
    let responseParts = [];
    const inspectResponse = () => {
      const response = responseParts.join(" ");
      responseParts = [];
      if (!response) return;
      for (const script of anomalyScripts) {
        if (script.language === dominantLanguage || containsScript(precedingUser, script)) continue;
        const words = scriptWords(response, script);
        if (words < 2) continue;
        const item = totals.get(script.language) || { language: script.language, words: 0, occurrences: 0 };
        item.words += words;
        item.occurrences++;
        totals.set(script.language, item);
      }
    };
    for (const record of records) {
      const text = visibleText(record);
      if (record.type === "user" && !record.isMeta && text) {
        inspectResponse();
        precedingUser = proseText(text);
      } else if (record.type === "assistant" && text) responseParts.push(proseText(text));
    }
    inspectResponse();
  }
  const languages = [...totals.values()].sort((left, right) => right.words - left.words || right.occurrences - left.occurrences);
  return languages.length ? { ...languages[0], languages } : null;
}

function scriptCount(value, expression) {
  return value.match(expression)?.length || 0;
}

function languageForChunk(value) {
  const letters = scriptCount(value, /\p{L}/gu);
  if (!letters) return null;
  const scripts = [
    ["Japanese", scriptCount(value, /[\p{Script=Hiragana}\p{Script=Katakana}]/gu)],
    ["Korean", scriptCount(value, /\p{Script=Hangul}/gu)],
    ["Chinese", scriptCount(value, /\p{Script=Han}/gu)],
    ["Arabic", scriptCount(value, /\p{Script=Arabic}/gu)],
    ["Hebrew", scriptCount(value, /\p{Script=Hebrew}/gu)],
    ["Hindi", scriptCount(value, /\p{Script=Devanagari}/gu)],
    ["Thai", scriptCount(value, /\p{Script=Thai}/gu)],
    ["Cyrillic", scriptCount(value, /\p{Script=Cyrillic}/gu)],
  ];
  const [script, count] = scripts.sort((left, right) => right[1] - left[1])[0];
  if (count >= 2 && count / letters >= 0.15) return script;
  const words = value.toLocaleLowerCase().match(/\p{Script=Latin}+(?:['’]\p{Script=Latin}+)*/gu) || [];
  if (!words.length) return null;
  const uniqueWords = new Set(words);
  let best = ["English", 0];
  for (const [language, lexicon] of languageLexicons) {
    const score = [...uniqueWords].reduce((sum, word) => sum + (lexicon.has(word) ? 1 : 0), 0);
    if (score > best[1]) best = [language, score];
  }
  return best[1] >= 2 ? best[0] : "English";
}

function languageBreakdown(texts) {
  const counts = new Map();
  for (const value of texts) {
    const prose = proseText(value);
    if (!prose) continue;
    for (const chunk of prose.split(/(?<=[.!?。！？])\s+|\n+/)) {
      const words = wordCount(chunk);
      const language = words >= 2 ? languageForChunk(chunk) : null;
      if (language) counts.set(language, (counts.get(language) || 0) + words);
    }
  }
  const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
  return [...counts]
    .sort((left, right) => right[1] - left[1])
    .map(([language, words]) => ({ language, words, percentage: total ? Number((words / total * 100).toFixed(1)) : 0 }));
}

function topicScores(value) {
  return topicRules.map(([topic, pattern]) => {
    pattern.lastIndex = 0;
    return [topic, [...String(value || "").matchAll(pattern)].length];
  });
}

function topicBreakdown(sessionRecords) {
  const counts = new Map();
  let total = 0;
  for (const { records } of sessionRecords) {
    let previousTopic = null;
    for (const record of records) {
      if (record.type !== "user" || record.isMeta) continue;
      const text = visibleText(record);
      if (!text) continue;
      const scores = topicScores(text).sort((left, right) => right[1] - left[1]);
      let topic = scores[0][1] > 0 ? scores[0][0] : null;
      if (!topic && wordCount(text) <= 8) topic = previousTopic;
      topic ||= "Other";
      if (topic !== "Other") previousTopic = topic;
      counts.set(topic, (counts.get(topic) || 0) + 1);
      total++;
    }
  }
  return [...counts]
    .sort((left, right) => right[1] - left[1])
    .map(([topic, prompts]) => ({ topic, prompts, percentage: total ? Number((prompts / total * 100).toFixed(1)) : 0 }));
}

function toolUses(record) {
  return contentBlocks(record).filter((block) => block?.type === "tool_use");
}

function isToolError(record) {
  if (record?.type !== "user") return false;
  return contentBlocks(record).some((block) => block?.type === "tool_result" && (block.is_error || block.isError));
}

function day(timestamp) {
  return timestamp ? new Date(timestamp).toISOString().slice(0, 10) : null;
}

function confidence(score) {
  return { score, label: score >= 0.78 ? "High" : score >= 0.56 ? "Medium" : "Low" };
}

function excerptAround(records, center, sessionId) {
  const lines = [];
  for (let i = Math.max(0, center - 1); i <= Math.min(records.length - 1, center + 2); i++) {
    const role = records[i].type;
    if (role !== "user" && role !== "assistant") continue;
    const text = visibleText(records[i]);
    if (!text) continue;
    lines.push({ role, text: safeEvidenceText(text) });
  }
  return { id: crypto.randomUUID(), sessionId, lines };
}

function finding(kind, title, summary, method, score, evidence) {
  return { id: crypto.randomUUID(), kind, title, summary, method, confidence: confidence(score), evidence };
}

function ratesFor(model, agent) {
  const value = String(model || "").toLowerCase();
  if (value.includes("opus")) return { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 };
  if (value.includes("sonnet")) return { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 };
  if (value.includes("haiku")) return { input: 1, output: 5, cacheWrite: 1.25, cacheRead: 0.1 };
  if (agent === "codex" || value.startsWith("gpt")) return { input: 1.25, output: 10, cacheWrite: 1.25, cacheRead: 0.125 };
  return { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 };
}

function analyzeBehavior(sessionRecords) {
  const findings = [];
  for (const { sessionId, records } of sessionRecords) {
    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      const text = visibleText(record);

      if (record.type === "assistant" && /\b(done|completed|fixed|implemented|all set|finished)\b/i.test(text)) {
        const nearby = records.slice(Math.max(0, i - 7), i + 1).flatMap(toolUses).map((t) => String(t.name || "").toLowerCase());
        const verified = nearby.some((name) => /(test|check|lint|build|verify|browser|screenshot)/.test(name));
        if (!verified) findings.push(finding(
          "verification", "Completion claim lacked visible verification", "The agent used completion language without a nearby visible test or verification tool call.",
          "Looks for completion phrases, then checks the preceding seven records for test, build, lint, browser, or verification tools. This can miss verification described only in prose.",
          0.72, excerptAround(records, i, sessionId)
        ));
      }

      if (record.type === "user" && /\b(no[, ]|actually|that(?:'s| is) (?:wrong|not)|stop|you missed|instead)\b/i.test(text)) {
        const next = records.slice(i + 1).findIndex((r) => r.type === "assistant" && visibleText(r));
        if (next >= 0) {
          const index = i + 1 + next;
          const response = visibleText(records[index]);
          const adapted = /\b(sorry|you're right|you are right|understood|thanks for|let me correct|i'll adjust|i will adjust)\b/i.test(response);
          findings.push(finding(
            "correction", adapted ? "Agent visibly reset after pushback" : "Correction received without an explicit reset",
            adapted ? "After user pushback, the next response acknowledged or reframed the approach." : "After user pushback, the next response did not visibly acknowledge the correction.",
            "Detects correction language in a user message and checks the next assistant message for acknowledgment or course-correction phrases. Tone and implicit adaptation are hard to infer.",
            adapted ? 0.81 : 0.58, excerptAround(records, i, sessionId)
          ));
        }
      }

      if (isToolError(record)) {
        const failedUse = [...records.slice(Math.max(0, i - 3), i).flatMap(toolUses)].at(-1);
        if (failedUse) {
          const failedName = failedUse.name;
          const repeatedAt = records.slice(i + 1, i + 7).findIndex((r) => toolUses(r).some((t) => t.name === failedName));
          if (repeatedAt >= 0) findings.push(finding(
            "repetition", "An unsuccessful tool approach was repeated", `After a tool error, the agent used ${failedName || "the same tool"} again within six records.`,
            "Pairs an explicit tool-result error with another call to the same tool shortly afterward. It does not inspect raw tool inputs, so a materially improved retry may be counted.",
            0.66, excerptAround(records, i, sessionId)
          ));
        }
      }

      if (record.type === "user" && /\b(delete|remove|publish|deploy|send|email|pay|purchase|production|all files|everything)\b/i.test(text)) {
        const nextAssistantIndex = records.slice(i + 1, i + 5).findIndex((r) => r.type === "assistant" && visibleText(r));
        if (nextAssistantIndex >= 0) {
          const index = i + 1 + nextAssistantIndex;
          const response = visibleText(records[index]);
          if (/\?/.test(response) && /\b(confirm|which|should|do you want|before i|scope|exactly)\b/i.test(response)) findings.push(finding(
            "clarification", "Clarified before potentially risky work", "The agent asked a scoping or confirmation question before proceeding with a potentially consequential request.",
            "Flags risk-related verbs in the request, then looks for a question with confirmation or scope language in the next assistant response.",
            0.76, excerptAround(records, i, sessionId)
          ));
        }
      }

      if (record.type === "assistant" && /\b(while i(?:'m| am) at it|also went ahead|additionally,? i|beyond that|as a bonus)\b/i.test(text)) findings.push(finding(
        "scope", "Agent signaled a possible scope expansion", "The agent described additional work beyond the immediate task; whether it was helpful or unwanted needs human review.",
        "Looks for explicit phrases that introduce extra work. It does not decide whether that extra work was appropriate.",
        0.61, excerptAround(records, i, sessionId)
      ));
    }
  }
  const deduped = [];
  const counts = new Map();
  for (const item of findings) {
    const count = counts.get(item.kind) || 0;
    if (count < 3) deduped.push(item);
    counts.set(item.kind, count + 1);
  }
  return deduped;
}

export function analyzeSessions(sessionRecords) {
  const toolCounts = new Map();
  const agentCounts = new Map(agentDefinitions.map(({ agent }) => [agent, 0]));
  const modelTokens = new Map();
  const activeDays = new Set();
  let prompts = 0;
  let toolCalls = 0;
  let interruptions = 0;
  let totalDurationMs = 0;
  let tokens = 0;
  let estimatedCostUsd = 0;
  let userInputWords = 0;
  let userInputCount = 0;
  let agentResponseWords = 0;
  let agentResponseCount = 0;
  let frustratedMessages = 0;
  let gratefulMessages = 0;
  const assistantProse = [];
  const sessionTurnCounts = [];
  for (const { records, agent = "claude" } of sessionRecords) {
    agentCounts.set(agent, (agentCounts.get(agent) || 0) + 1);
    const timestamps = records.map((r) => r.timestamp).filter(Boolean).map((value) => new Date(value).getTime()).filter(Number.isFinite);
    if (timestamps.length > 1) totalDurationMs += Math.max(...timestamps) - Math.min(...timestamps);
    let currentResponseWords = 0;
    let hasCurrentPrompt = false;
    let sessionTurns = 0;
    const finishResponse = () => {
      if (hasCurrentPrompt && currentResponseWords > 0) {
        agentResponseWords += currentResponseWords;
        agentResponseCount++;
      }
      currentResponseWords = 0;
    };
    for (const record of records) {
      const text = visibleText(record);
      if (record.type === "user" && !record.isMeta && text) {
        finishResponse();
        hasCurrentPrompt = true;
        userInputWords += wordCount(text);
        userInputCount++;
        sessionTurns++;
        if (isFrustratedMessage(text)) frustratedMessages++;
        if (isGratefulMessage(text)) gratefulMessages++;
      } else if (record.type === "assistant" && hasCurrentPrompt && text) {
        currentResponseWords += wordCount(text);
      }
      if (record.type === "assistant" && text) assistantProse.push(text);
      const d = day(record.timestamp);
      if (d) activeDays.add(d);
      if (record.type === "user" && !record.isMeta && text) prompts++;
      if (record.type === "system" && /interrupt/i.test(`${record.subtype || ""} ${record.content || ""}`)) interruptions++;
      const usage = record?.message?.usage;
      if (usage) {
        const input = Number(usage.input_tokens) || 0;
        const output = Number(usage.output_tokens) || 0;
        const cacheWrite = Number(usage.cache_creation_input_tokens) || 0;
        const cacheRead = Number(usage.cache_read_input_tokens) || 0;
        const recordTokens = input + output + cacheWrite + cacheRead;
        tokens += recordTokens;
        const model = record?.message?.model || `${agent === "codex" ? "Codex" : "Claude"} model`;
        modelTokens.set(model, (modelTokens.get(model) || 0) + recordTokens);
        const rates = ratesFor(model, agent);
        estimatedCostUsd += (input * rates.input + output * rates.output + cacheWrite * rates.cacheWrite + cacheRead * rates.cacheRead) / 1_000_000;
      }
      for (const tool of toolUses(record)) {
        toolCalls++;
        const name = String(tool.name || "Unknown tool");
        toolCounts.set(name, (toolCounts.get(name) || 0) + 1);
      }
    }
    finishResponse();
    if (sessionTurns > 0) sessionTurnCounts.push(sessionTurns);
  }
  const tools = [...toolCounts].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, count]) => ({ name, count }));
  const totalSessions = sessionRecords.length;
  const agents = agentDefinitions.map(({ agent, name }) => {
    const count = agentCounts.get(agent) || 0;
    return { agent, name, count, percentage: totalSessions ? Number((count / totalSessions * 100).toFixed(1)) : 0 };
  }).sort((left, right) => right.percentage - left.percentage || right.count - left.count || left.name.localeCompare(right.name));
  const models = [...modelTokens].sort((left, right) => right[1] - left[1]).map(([model, modelTokenCount]) => ({
    model: String(model),
    name: displayModelName(model),
    tokens: modelTokenCount,
    percentage: tokens ? Number((modelTokenCount / tokens * 100).toFixed(1)) : 0,
  }));
  const stats = {
    sessions: totalSessions,
    activeDays: activeDays.size,
    durationMinutes: Math.round(totalDurationMs / 60000),
    prompts,
    toolCalls,
    interruptions,
    tokens,
    agentWords: agentResponseWords,
    userWords: userInputWords,
    agentUserWordRatio: userInputWords ? Number((agentResponseWords / userInputWords).toFixed(2)) : null,
    averageAgentResponseWords: agentResponseCount ? Math.round(agentResponseWords / agentResponseCount) : 0,
    averageUserInputWords: userInputCount ? Math.round(userInputWords / userInputCount) : 0,
    longestSessionTurns: Math.max(0, ...sessionTurnCounts),
    sessionTurnCounts: [...sessionTurnCounts].sort((left, right) => left - right),
    sessionTurnMethod: "Counts each visible, non-meta user message as one turn.",
    interactionTone: {
      frustratedMessages,
      gratefulMessages,
      analyzedMessages: userInputCount,
      method: "Counts user messages matching conservative frustration or gratitude phrase patterns; this is an approximate tone signal, not a judgment of emotion.",
    },
    stockPhrases: stockPhraseCounts(assistantProse),
    outputLanguages: languageBreakdown(assistantProse),
    languageAnomaly: languageAnomalyBreakdown(sessionRecords),
    languageMethod: "Estimates natural-language word share in assistant text after removing fenced code, inline code, URLs, paths, and markup. Script detection and small Latin-language lexicons are approximate.",
    topics: topicBreakdown(sessionRecords),
    topicMethod: "Assigns each user prompt to its highest-scoring local keyword category; short follow-ups inherit the preceding topic in that session.",
    tools,
    agents,
    models,
    estimatedCostUsd: Number(estimatedCostUsd.toFixed(2)),
    costEstimateMethod: "API-equivalent estimate using a local, inspectable model-family rate table.",
  };
  return { stats, findings: analyzeBehavior(sessionRecords) };
}

function donationRedactionInventory(detections) {
  const categories = new Map();
  for (const detection of detections) {
    const kind = String(detection.kind || detection.replacement).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const item = categories.get(kind) || { kind, label: detection.label, replacement: detection.replacement, count: 0, matches: new Map() };
    item.count++;
    const value = String(detection.value || "");
    const displayValue = value.length > 500 ? `${value.slice(0, 500)}…` : value;
    const match = item.matches.get(value) || { id: detection.matchId, value: displayValue, truncated: displayValue !== value, length: detection.length || value.length, enabled: detection.enabled !== false, count: 0, contexts: [] };
    match.count++;
    if (match.contexts.length < 6 && detection.context) match.contexts.push({
      before: String(detection.context.before || "").replace(/\s+/g, " "),
      match: value.length > 180 ? `${value.slice(0, 180)}…` : value,
      after: String(detection.context.after || "").replace(/\s+/g, " "),
    });
    item.matches.set(value, match);
    categories.set(kind, item);
  }
  return [...categories.values()].map((item) => {
    const matches = [...item.matches.values()].sort((left, right) => right.count - left.count || left.value.localeCompare(right.value));
    const enabledCount = matches.reduce((sum, match) => sum + (match.enabled ? match.count : 0), 0);
    return { ...item, enabled: enabledCount === item.count, enabledCount, matches };
  }).sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

export function localOpeningPrompt(value) {
  let prompt = String(value || "");
  const explicitRequest = prompt.match(/(?:^|\n)## My request:\s*([\s\S]*)$/i);
  if (explicitRequest) prompt = explicitRequest[1];
  prompt = prompt
    .replace(/<recommended_plugins>[\s\S]*?<\/recommended_plugins>/gi, " ")
    .replace(/<environment_context>[\s\S]*?<\/environment_context>/gi, " ")
    .replace(/<skills_instructions>[\s\S]*?<\/skills_instructions>/gi, " ")
    .replace(/<permissions instructions>[\s\S]*?<\/permissions instructions>/gi, " ")
    .replace(/<collaboration_mode>[\s\S]*?<\/collaboration_mode>/gi, " ")
    .replace(/<apps_instructions>[\s\S]*?<\/apps_instructions>/gi, " ")
    .replace(/<plugins_instructions>[\s\S]*?<\/plugins_instructions>/gi, " ")
    .replace(/<multi_agent_mode>[\s\S]*?<\/multi_agent_mode>/gi, " ")
    .replace(/<INSTRUCTIONS>[\s\S]*?<\/INSTRUCTIONS>/gi, " ")
    .replace(/^\s*# AGENTS\.md instructions\s*$/gim, " ")
    .replace(/<image\b[^>]*>[\s\S]*?<\/image>/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return prompt;
}

function donationSessionSummary(messages, suppliedSummary) {
  const provided = String(suppliedSummary || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (provided) return provided.slice(0, 140);
  const opening = messages.filter((message) => message.role === "user").map((message) => localOpeningPrompt(message.text)).find(Boolean)
    || localOpeningPrompt(messages[0]?.text)
    || "Session transcript";
  const compact = opening.replace(/\[(?:REDACTED|REMOVED)[^\]]*\]/g, "private detail").replace(/\s+/g, " ").trim();
  if (compact.length <= 110) return compact;
  const shortened = compact.slice(0, 109);
  return `${shortened.slice(0, Math.max(shortened.lastIndexOf(" "), 1)).trim()}…`;
}

export function makeDonationPreview(sessionRecords, metadataById, { disabledRedactions = [], disabledMatches = [], unredacted = false } = {}) {
  const detections = [];
  const sessions = sessionRecords.map(({ sessionId, records }) => {
    const messages = records.flatMap((record) => {
      if (record.type !== "user" && record.type !== "assistant") return [];
      const value = visibleText(record);
      if (!value) return [];
      const redacted = unredacted
        ? { text: value, detections: [] }
        : redactText(value, [], { disabledKinds: disabledRedactions, disabledMatches, includeHeuristicSecrets: false });
      detections.push(...redacted.detections);
      return [{ role: record.type, timestamp: record.timestamp || null, text: redacted.text }];
    });
    const metadata = metadataById.get(sessionId);
    return { sessionId, label: metadata?.label || `Session ${sessionId.slice(0, 6)}`, summary: donationSessionSummary(messages, metadata?.summary), messages };
  });
  const redactions = donationRedactionInventory(detections);
  const detectionCount = detections.filter((detection) => detection.enabled !== false).length;
  return { format: "behavior-wrapped-donation-preview-v1", createdLocally: true, unredacted, detectionCount, redactions, sessions };
}
