import crypto from "node:crypto";
import { safeEvidenceText, redactText } from "./privacy.mjs";

const wordSegmenter = new Intl.Segmenter("en", { granularity: "word" });

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

function displayModelName(value) {
  const raw = String(value || "Unknown model");
  if (raw === "<synthetic>") return "Synthetic model";
  const claude = raw.match(/^claude-([a-z]+)-(\d+)-(\d+)$/i);
  if (claude) return `Claude ${claude[1][0].toUpperCase()}${claude[1].slice(1).toLowerCase()} ${claude[2]}.${claude[3]}`;
  const gpt = raw.match(/^gpt-(\d+)[.-](\d+)(?:-([a-z]+))?$/i);
  if (gpt) return `GPT-${gpt[1]}.${gpt[2]}${gpt[3] ? ` ${gpt[3][0].toUpperCase()}${gpt[3].slice(1).toLowerCase()}` : ""}`;
  return raw
    .replace(/^claude-/i, "Claude ")
    .replace(/^gpt-/i, "GPT-")
    .replace(/-(\d+)-(\d+)(?=$|-)/g, "$1.$2")
    .replace(/-/g, " ")
    .replace(/\b(opus|sonnet|haiku|sol|luna)\b/gi, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase());
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
  const agentCounts = new Map([["claude", 0], ["codex", 0]]);
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
  for (const { records, agent = "claude" } of sessionRecords) {
    agentCounts.set(agent, (agentCounts.get(agent) || 0) + 1);
    const timestamps = records.map((r) => r.timestamp).filter(Boolean).map((value) => new Date(value).getTime()).filter(Number.isFinite);
    if (timestamps.length > 1) totalDurationMs += Math.max(...timestamps) - Math.min(...timestamps);
    let currentResponseWords = 0;
    let hasCurrentPrompt = false;
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
      } else if (record.type === "assistant" && hasCurrentPrompt && text) {
        currentResponseWords += wordCount(text);
      }
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
  }
  const tools = [...toolCounts].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, count]) => ({ name, count }));
  const totalSessions = sessionRecords.length;
  const claudePercentage = totalSessions ? Number(((agentCounts.get("claude") || 0) / totalSessions * 100).toFixed(1)) : 0;
  const agents = [
    { agent: "claude", name: "Claude Code", count: agentCounts.get("claude") || 0, percentage: claudePercentage },
    { agent: "codex", name: "Codex", count: agentCounts.get("codex") || 0, percentage: totalSessions ? Number((100 - claudePercentage).toFixed(1)) : 0 },
  ];
  const models = [...modelTokens].sort((left, right) => right[1] - left[1]).map(([model, modelTokenCount]) => ({
    model: String(model),
    name: displayModelName(model),
    tokens: modelTokenCount,
    percentage: tokens ? Number((modelTokenCount / tokens * 100).toFixed(1)) : 0,
  }));
  const stats = { sessions: totalSessions, activeDays: activeDays.size, durationMinutes: Math.round(totalDurationMs / 60000), prompts, toolCalls, interruptions, tokens, averageAgentResponseWords: agentResponseCount ? Math.round(agentResponseWords / agentResponseCount) : 0, averageUserInputWords: userInputCount ? Math.round(userInputWords / userInputCount) : 0, tools, agents, models, estimatedCostUsd: Number(estimatedCostUsd.toFixed(2)), costEstimateMethod: "API-equivalent estimate using a local, inspectable model-family rate table." };
  return { stats, findings: analyzeBehavior(sessionRecords) };
}

export function makeDonationPreview(sessionRecords, metadataById) {
  let detectionCount = 0;
  const sessions = sessionRecords.map(({ sessionId, records }) => {
    const messages = records.flatMap((record) => {
      if (record.type !== "user" && record.type !== "assistant") return [];
      const value = visibleText(record);
      if (!value) return [];
      const redacted = redactText(value.replace(/```[\s\S]*?```/g, "[CODE REMOVED FROM DONATION PREVIEW]"));
      detectionCount += redacted.detections.length;
      return [{ role: record.type, timestamp: record.timestamp || null, text: redacted.text }];
    });
    return { sessionId, label: metadataById.get(sessionId)?.label || `Session ${sessionId.slice(0, 6)}`, messages };
  });
  return { format: "behavior-wrapped-donation-v0", createdLocally: true, detectionCount, sessions };
}
