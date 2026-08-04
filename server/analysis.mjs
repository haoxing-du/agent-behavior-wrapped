import crypto from "node:crypto";
import { safeEvidenceText, redactText } from "./privacy.mjs";

function contentBlocks(record) {
  const content = record?.message?.content ?? record?.content;
  if (Array.isArray(content)) return content;
  if (typeof content === "string") return [{ type: "text", text: content }];
  return [];
}

function visibleText(record) {
  return contentBlocks(record).filter((block) => block?.type === "text").map((block) => block.text || "").join("\n").trim();
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
  const activeDays = new Set();
  let prompts = 0;
  let toolCalls = 0;
  let interruptions = 0;
  let totalDurationMs = 0;
  let tokens = 0;
  for (const { records } of sessionRecords) {
    const timestamps = records.map((r) => r.timestamp).filter(Boolean).map((value) => new Date(value).getTime()).filter(Number.isFinite);
    if (timestamps.length > 1) totalDurationMs += Math.max(...timestamps) - Math.min(...timestamps);
    for (const record of records) {
      const d = day(record.timestamp);
      if (d) activeDays.add(d);
      if (record.type === "user" && !record.isMeta && visibleText(record)) prompts++;
      if (record.type === "system" && /interrupt/i.test(`${record.subtype || ""} ${record.content || ""}`)) interruptions++;
      const usage = record?.message?.usage;
      if (usage) tokens += ["input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"].reduce((sum, key) => sum + (Number(usage[key]) || 0), 0);
      for (const tool of toolUses(record)) {
        toolCalls++;
        const name = String(tool.name || "Unknown tool");
        toolCounts.set(name, (toolCounts.get(name) || 0) + 1);
      }
    }
  }
  const tools = [...toolCounts].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, count]) => ({ name, count }));
  const stats = { sessions: sessionRecords.length, activeDays: activeDays.size, durationMinutes: Math.round(totalDurationMs / 60000), prompts, toolCalls, interruptions, tokens, tools };
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
