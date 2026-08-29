import { toPng } from "html-to-image";
import { useEffect, useMemo, useRef, useState } from "react";

type Project = { id: string; name: string; sessionCount: number; latestAt: string; agents: string[] };
type Session = { id: string; agent: "claude" | "cowork" | "codex"; agentName: string; projectId: string; projectName: string; startedAt: string; endedAt: string; promptCount: number; recordCount: number; sizeBytes: number; synthetic: boolean; label: string };
type Catalog = { rootAvailable: boolean; demo: boolean; agentNames: string[]; projects: Project[]; sessions: Session[]; defaultRange: { from: string; to: string; days: number }; privacy: { canonicalDirectories: string[]; networkRequests: string }; phraseJudge?: { available: boolean; model: string; name: string; provider: string; requiredOnAnalysis: boolean; freeEndpointDataNotice: boolean } };
type Finding = { id: string; kind: string; title: string; summary: string; method: string; confidence: { score: number; label: string }; evidence: { id: string; sessionId: string; lines: { role: string; text: string }[] } };
type PhraseCard = { phrase: string; occurrences: number; distinctSessions: number; model: string; provider: string; latencyMs: number; method: string; candidateCount: number };
type AgentStat = { agent: "claude" | "cowork" | "codex"; name: string; count: number; percentage: number };
type ModelStat = { model: string; name: string; tokens: number; percentage: number };
type RepeatedInstruction = { instruction: string; occurrences: number; distinctSessions: number };
type ApologyCounts = { user: number; agent: number };
type UninterruptedRun = { durationMs: number; agent: "claude" | "cowork" | "codex"; agentName: string };
type ModelCount = { model: string; name: string; count: number };
type TrustCurve = { points: { dayOffset: number; score: number; observations: number }[]; startScore: number; endScore: number; change: number; observations: number; autonomousObservations: number; autonomousPercentage: number };
type TokenBreakdown = { input: number; output: number; cacheRead: number; cacheCreation: number; reasoning: number };
type InteractionTone = { frustratedMessages: number; gratefulMessages: number; analyzedMessages: number; method?: string };
type InteractionCard = { quote?: string; frustrationQuote?: string | null };
type LanguageStat = { language: string; words: number; percentage: number };
type LanguageAnomaly = { language: string; words: number; occurrences: number; languages?: { language: string; words: number; occurrences: number }[] };
type TopicStat = { topic: string; tokens: number; percentage: number };
type StockPhraseStat = { phrase: string; count: number };
type WorkaroundCard = { count: number; models: { name: string; count: number }[]; example?: string };
type Report = { stats: { sessions: number; activeDays: number; durationMinutes: number; prompts: number; toolCalls: number; interruptions: number; interruptionsByModel?: ModelCount[]; tokens: number; tokenBreakdown?: TokenBreakdown; agentWords?: number; userWords?: number; agentUserWordRatio?: number | null; averageAgentResponseWords?: number; averageUserInputWords?: number; longestSessionTurns?: number; sessionTurnCounts?: number[]; longestUninterruptedRun?: UninterruptedRun | null; trustCurve?: TrustCurve | null; interactionTone?: InteractionTone; apologyCounts?: ApologyCounts; stockPhrases?: StockPhraseStat[]; repeatedInstructions?: RepeatedInstruction[]; outputLanguages?: LanguageStat[]; languageAnomaly?: LanguageAnomaly | null; topics?: TopicStat[]; tools: { name: string; count: number }[]; agents: AgentStat[]; models: ModelStat[]; estimatedCostUsd: number; costEstimateMethod: string }; findings: Finding[]; phraseCard?: PhraseCard | null; interactionCard?: InteractionCard | null; workaroundCard?: WorkaroundCard | null };
type DonationMessage = { role: string; timestamp: string | null; text: string };
type DonationSession = { sessionId: string; label: string; summary: string; messages: DonationMessage[] };
type RedactionContext = { before: string; match: string; after: string };
type RedactionMatch = { id: string; value: string; truncated?: boolean; length: number; enabled: boolean; count: number; contexts: RedactionContext[] };
type AutomaticRedaction = { kind: string; label: string; replacement: string; enabled: boolean; enabledCount: number; count: number; matches: RedactionMatch[] };
type CustomRedactionRule = { id: string; label?: string; mode: "text" | "regex"; pattern: string; flags: string; replacement: string; count: number; contexts: RedactionContext[] };
type Donation = { format: string; createdLocally: boolean; unredacted?: boolean; detectionCount: number; redactions?: AutomaticRedaction[]; sessions: DonationSession[] };
type DonationMode = "standard" | "advanced" | "unredacted";
type Stage = "select" | "report" | "donate";
type SavedReport = Report & { id: string; createdAt: string; rangeLabel: string; source: string; publicUrl?: string; donationHelperUrl?: string; hosting?: { public: boolean }; privacy: { shareSafe: boolean; containsTranscriptText: boolean; externalTransmission: boolean; analysisMode?: "remote" | "local-only"; leaderboardParticipation?: "included-by-default" | "excluded" } };
type StorySlide = { kicker: string; headline: string; detail: string; tone: string; metric?: boolean; metricUnit?: string; headlineAccent?: string; wordRatio?: string; example?: string; workaround?: boolean; workaroundCount?: number; evidenceHref?: string; evidenceLabel?: string; turnDistribution?: { values: number[]; median: number }; ctaHref?: string; ctaLabel?: string; ctas?: { href: string; label: string; primary?: boolean; note?: string }[]; ctaPanel?: { eyebrow?: string; title: string; detailBeforeLink: string; linkLabel: string; detailAfterLink: string; href: string }; skipLabel?: string; rows?: { label: string; value: string; percentage?: number; rank?: number }[]; comparison?: { label: string; highlight: string; accent: "yell" | "thanks" | "agent-apology" | "user-apology"; value: string; suffix: string; quote?: string }[] };
type WorkaroundEvidenceAction = { toolName: string; details: string; timestamp: string | null };
type WorkaroundEvidenceOccurrence = { index: number; session: { label: string; agentName: string; startedAt: string | null; openingMessage: { preview: string; full: string }; turnsBeforeWorkaround: number }; originalAction: WorkaroundEvidenceAction; blocker: { text: string; timestamp: string | null }; workaroundAction: WorkaroundEvidenceAction };
type WorkaroundEvidence = { format: string; localPrivate: boolean; standardRedactionsApplied: boolean; reportId: string; occurrences: WorkaroundEvidenceOccurrence[] };
type InteractionEvidenceMessage = { role: "user" | "assistant"; text: string; timestamp: string | null; highlighted: boolean };
type InteractionEvidenceOccurrence = { index: number; candidateId: string; session: { label: string; agentName: string; startedAt: string | null }; timestamp: string | null; messages: InteractionEvidenceMessage[] };
type InteractionEvidence = { format: string; localPrivate: boolean; standardRedactionsApplied: boolean; reportId: string; frustrated: InteractionEvidenceOccurrence[]; grateful: InteractionEvidenceOccurrence[]; userApologies: InteractionEvidenceOccurrence[]; agentApologies: InteractionEvidenceOccurrence[] };
type ParticipantSample = { participant_id: number; value: number };
type SessionLengthDistribution = { session_count: number; median_turns: number; min_turns: number; max_turns: number; points: { turns: number; density: number }[] };
type PhraseWallEntry = { participant_id: number; phrase: string; occurrences: number; sessions: number };
type RelationshipPoint = { participant_id: number; yap_ratio: number; appreciation_index: number };
type PlotTooltipState = { x: number; y: number; text: string } | null;
type LeaderboardSnapshot = {
  public_view?: boolean;
  cohort_size: number;
  tokens: { value: number; percentile: number | null; samples: ParticipantSample[] };
  word_ratio: { value: number; percentile: number | null };
  good_human_score: { value: number | null; percentile: number | null };
  relationship: { points: RelationshipPoint[] };
  instrumental_workarounds: { value: number; percentile: number | null; samples: ParticipantSample[]; by_model?: { model: string; count: number }[] };
  session_lengths: { values: number[]; distribution: SessionLengthDistribution };
  phrases: { entries: PhraseWallEntry[] };
  participation: { joined: boolean; participant_id?: number; display_name?: string; public_ranked?: boolean; shares_phrase?: boolean };
  can_manage?: boolean;
  opted_out?: boolean;
};

const SUSAN_CALVIN_PROJECT_URL = "https://susancalvin.org";
const SUSAN_CALVIN_DATA_POLICY_URL = `${SUSAN_CALVIN_PROJECT_URL}/data-policy`;

function useLocalHelperHeartbeat() {
  useEffect(() => {
    if (!new Set(["localhost", "127.0.0.1", "::1"]).has(window.location.hostname)) return;
    const heartbeat = () => { void fetch("/api/health", { cache: "no-store" }).catch(() => {}); };
    const onVisibilityChange = () => { if (!document.hidden) heartbeat(); };
    heartbeat();
    const timer = window.setInterval(heartbeat, 30_000);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);
}

function reportManagementToken(id: string) {
  const key = `behavior-wrapped:manage:${id}`;
  const fragmentToken = new URLSearchParams(window.location.hash.slice(1)).get("manage") || "";
  try {
    if (/^[a-f0-9]{64}$/.test(fragmentToken)) localStorage.setItem(key, fragmentToken);
    const token = /^[a-f0-9]{64}$/.test(fragmentToken) ? fragmentToken : localStorage.getItem(key) || "";
    if (fragmentToken) window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    return /^[a-f0-9]{64}$/.test(token) ? token : "";
  } catch {
    if (fragmentToken) window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    return /^[a-f0-9]{64}$/.test(fragmentToken) ? fragmentToken : "";
  }
}

const dateFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });
const dateTimeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function fmtDate(value: string) { return dateFormat.format(new Date(value)); }
function fmtDateTime(value: string | null) { return value ? dateTimeFormat.format(new Date(value)) : "Time unavailable"; }
function fmtDuration(minutes: number) {
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function fmtRunDuration(milliseconds: number) {
  const seconds = Math.max(1, Math.round(milliseconds / 1000));
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
function fmtCompact(value: number) {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function fmtAxisCompact(value: number) {
  return fmtCompact(value).replace(/\.0(?=[KMB]$)/, "");
}

function hasDisplayablePercentage(value: number) {
  return Number.isFinite(value) && Number(value.toFixed(1)) > 0;
}

function renderInlineCode(value: string) {
  return value.split(/(`[^`]+`)/g).filter(Boolean).map((part, index) => part.startsWith("`") && part.endsWith("`")
    ? <code key={`${part}-${index}`}>{part.slice(1, -1)}</code>
    : part);
}

function localWorkaroundEvidenceUrl(report: SavedReport) {
  const donationUrl = report.donationHelperUrl || `http://localhost:4317/donate/${report.id}`;
  return donationUrl.replace(new RegExp(`/donate/${report.id}$`), `/workarounds/${report.id}`);
}

function localInteractionEvidenceUrl(report: SavedReport) {
  const donationUrl = report.donationHelperUrl || `http://localhost:4317/donate/${report.id}`;
  return donationUrl.replace(new RegExp(`/donate/${report.id}$`), `/interactions/${report.id}`);
}

function fmtUsd(value: number) {
  if (value >= 10) return `$${Math.round(value).toLocaleString()}`;
  return `$${value.toFixed(2)}`;
}

function fmtSeriesEquivalent(value: number, unitTokens: number) {
  const count = value / unitTokens;
  if (count >= 100) return Math.round(count).toLocaleString();
  if (count >= 10) return count.toFixed(1);
  if (count >= 1) return count.toFixed(1);
  return count.toFixed(2);
}

function fmtCostEquivalent(value: number, unitCost: number) {
  const count = value / unitCost;
  return count < 1 ? count.toFixed(1) : Math.round(count).toLocaleString();
}

function costEquivalents(value: number) {
  return [
    { label: "iPhones", value: fmtCostEquivalent(value, 1_000) },
    { label: "Claude Max subscriptions", value: fmtCostEquivalent(value, 200) },
    { label: "Hardcover books", value: fmtCostEquivalent(value, 20) },
    { label: "Starbucks lattes", value: fmtCostEquivalent(value, 6.5) },
  ];
}

function download(filename: string, content: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function exportShareCard(report: Report) {
  const canvas = document.createElement("canvas");
  canvas.width = 1200; canvas.height = 630;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const gradient = ctx.createRadialGradient(900, 150, 20, 820, 260, 700);
  gradient.addColorStop(0, "#4d248d"); gradient.addColorStop(.5, "#19122f"); gradient.addColorStop(1, "#0d0b1b");
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 1200, 630);
  ctx.fillStyle = "#c9f24b"; ctx.font = "800 18px system-ui"; ctx.fillText("BEHAVIOR WRAPPED · SHARE-SAFE", 74, 70);
  ctx.fillStyle = "#f8f5ff"; ctx.font = "800 64px system-ui"; ctx.fillText("How my agent showed up", 72, 150);
  ctx.fillStyle = "#aaa3ba"; ctx.font = "400 23px system-ui"; ctx.fillText("Local analysis · generalized signals · no transcript excerpts", 74, 194);
  const stats = [[report.stats.sessions, "SESSIONS"], [report.stats.activeDays, "ACTIVE DAYS"], [report.stats.toolCalls, "TOOL CALLS"], [report.stats.prompts, "PROMPTS"]];
  stats.forEach(([value, label], index) => {
    const x = 74 + index * 265;
    ctx.fillStyle = index % 2 ? "#c9f24b" : "#8d5cff"; ctx.beginPath(); ctx.roundRect(x, 240, 235, 142, 22); ctx.fill();
    ctx.fillStyle = index % 2 ? "#12101f" : "#ffffff"; ctx.font = "850 52px system-ui"; ctx.fillText(String(value), x + 22, 305);
    ctx.font = "800 14px system-ui"; ctx.fillText(String(label), x + 23, 348);
  });
  ctx.fillStyle = "#f8f5ff"; ctx.font = "750 21px system-ui"; ctx.fillText("Top behavior signals", 74, 438);
  ctx.font = "600 19px system-ui";
  report.findings.slice(0, 3).forEach((item, index) => {
    ctx.fillStyle = ["#c9f24b", "#ff7dbe", "#6ac8ff"][index]; ctx.fillText("✦", 76, 482 + index * 41);
    ctx.fillStyle = "#d9d4e4"; ctx.fillText(item.title.slice(0, 78), 108, 482 + index * 41);
  });
  if (!report.findings.length) { ctx.fillStyle = "#d9d4e4"; ctx.fillText("No strong heuristic signals found", 76, 482); }
  ctx.fillStyle = "#777083"; ctx.font = "500 15px system-ui"; ctx.fillText("Heuristic signals, not factual judgments · Evidence omitted", 74, 598);
  const anchor = document.createElement("a");
  anchor.href = canvas.toDataURL("image/png");
  anchor.download = "behavior-wrapped-share-card.png";
  anchor.click();
}

function ShieldIcon() {
  return <span className="shield" aria-hidden="true">◆</span>;
}

function GiftbotMark() {
  return <svg className="brand-mark" viewBox="0 0 40 40" aria-hidden="true">
    <g fill="none" stroke="#c9f24b" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 13v-2.5L8.5 8V3.5H15V8l3 3h4l3-3V3.5h6.5V8L29 10.5V13" />
      <rect x="3.5" y="13" width="33" height="23.5" rx="3" fill="#ffffff" />
      <path d="M3.5 27h33M20 27v9.5" opacity=".62" />
      <path d="M16.5 22.5v1c0 1.4 1.6 2.5 3.5 2.5s3.5-1.1 3.5-2.5v-1" />
    </g>
    <circle cx="12.5" cy="20" r="1.8" fill="#8d5cff" />
    <circle cx="27.5" cy="20" r="1.8" fill="#8d5cff" />
  </svg>;
}

function SusanCalvinCredit() {
  return <span className="susan-calvin-credit">An experiment from the <a href={SUSAN_CALVIN_PROJECT_URL} target="_blank" rel="noreferrer">Susan Calvin Project <span aria-hidden="true">↗</span></a></span>;
}

function SessionTurnChart({ values, median }: { values: number[]; median: number }) {
  const turns = values.filter((value) => Number.isFinite(value) && value >= 1).sort((left, right) => left - right);
  const longest = Math.max(0, ...turns);
  const left = 22;
  const right = 538;
  const plotTop = 37;
  const plotBottom = 164;
  const center = (plotTop + plotBottom) / 2;
  const axis = 184;
  const niceMaximums = [5, 10, 20, 50, 100, 200, 500, 1_000, 2_000, 5_000, 10_000, 20_000, 50_000, 100_000, 1_000_000];
  const domainMaximum = niceMaximums.find((value) => value >= longest) || Math.max(1, longest);
  const xFor = (value: number) => left + Math.log(Math.max(1, value)) / Math.log(domainMaximum) * (right - left);
  const tickCandidates = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1_000, 2_000, 5_000, 10_000, 20_000, 50_000, 100_000, 1_000_000].filter((value) => value <= domainMaximum);
  const ticks = tickCandidates.reduce<number[]>((selected, value, index) => {
    const previous = selected.at(-1);
    if (index === 0 || index === tickCandidates.length - 1 || previous === undefined || xFor(value) - xFor(previous) >= 44) selected.push(value);
    return selected;
  }, []);
  const radius = turns.length > 80 ? 2.8 : turns.length > 45 ? 3.25 : 3.8;
  const spacing = radius * 2 + 1.4;
  const dotPositions: { value: number; x: number; y: number }[] = [];
  turns.forEach((value, index) => {
    const x = xFor(value);
    const offsets = [0];
    for (let offset = spacing; offset <= 60; offset += spacing) offsets.push(offset, -offset);
    const offset = offsets.find((candidate) => dotPositions.every((point) => Math.hypot(point.x - x, center + candidate - point.y) >= spacing)) ?? Math.sin(index * 2.399) * 60;
    dotPositions.push({ value, x, y: center + offset });
  });
  const medianLabel = median.toLocaleString(undefined, { maximumFractionDigits: 1 });
  const longestPoint = [...dotPositions].reverse().find((point) => point.value === longest);
  return <figure className="session-turn-chart">
    <figcaption><span>{turns.length.toLocaleString()} sessions</span><strong>Median <b>{medianLabel}</b> turns</strong></figcaption>
    <svg viewBox="0 0 560 218" role="img" aria-label={`Session lengths range from ${turns[0] || 0} to ${longest} turns, with a median of ${medianLabel} turns. Every session is shown as a dot on a compressed scale.`}>
      <rect className="turn-plot-bg" x={left} y={plotTop - 9} width={right - left} height={plotBottom - plotTop + 18} rx="13" />
      {ticks.filter((value) => value > 0).map((value) => <line className="turn-grid-line" key={`grid-${value}`} x1={xFor(value)} x2={xFor(value)} y1={plotTop - 2} y2={plotBottom + 2} />)}
      <line className="turn-median-line" x1={xFor(median)} x2={xFor(median)} y1={plotTop - 5} y2={plotBottom + 5} />
      <g className="turn-median-label" transform={`translate(${xFor(median)} ${plotTop - 8})`}><rect x="-27" y="-10" width="54" height="18" rx="9" /><text y="3" textAnchor="middle">MEDIAN</text></g>
      {dotPositions.map((point, index) => <circle className={point === longestPoint ? "turn-session-dot longest" : "turn-session-dot"} key={`${point.value}-${index}`} cx={point.x} cy={point.y} r={point === longestPoint ? radius + 1.5 : radius}><title>{`${point.value} turn${point.value === 1 ? "" : "s"}`}</title></circle>)}
      <line className="turn-axis" x1={left} x2={right} y1={axis} y2={axis} />
      {ticks.map((value) => <g className="turn-tick" key={value}><line x1={xFor(value)} x2={xFor(value)} y1={axis - 4} y2={axis + 4} /><text x={xFor(value)} y="204" textAnchor={value === 1 ? "start" : value === domainMaximum ? "end" : "middle"}>{fmtAxisCompact(value)}</text></g>)}
    </svg>
  </figure>;
}

async function downloadSlide(card: HTMLElement, slide: number) {
  await document.fonts.ready;
  const dataUrl = await toPng(card, {
    backgroundColor: "#f5f1ed",
    cacheBust: true,
    pixelRatio: 2.5,
  });
  const anchor = document.createElement("a");
  anchor.href = dataUrl;
  anchor.download = `behavior-wrapped-${slide + 1}.png`;
  anchor.click();
}

function SharedWrapped({ id }: { id: string }) {
  const [report, setReport] = useState<SavedReport | null>(null);
  const [managementToken] = useState(() => reportManagementToken(id));
  const [error, setError] = useState("");
  const [slide, setSlide] = useState(0);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const cardRef = useRef<HTMLElement>(null);
  useEffect(() => { fetch(`/api/reports/${id}`).then(async (response) => { if (!response.ok) throw new Error("This local Wrapped was not found."); return response.json(); }).then(setReport).catch((e) => setError(e.message)); }, [id]);
  const slides = useMemo<StorySlide[]>(() => {
    if (!report) return [];
    const sharedViewer = Boolean(report.hosting?.public && !managementToken);
    const agents = report.stats.agents?.length ? report.stats.agents : [{ agent: "claude" as const, name: "Claude Code", count: report.stats.sessions, percentage: 100 }];
    const activeAgents = agents
      .map((agent) => agent.agent === "cowork" ? { ...agent, name: "Claude Cowork" } : agent)
      .filter((agent) => hasDisplayablePercentage(agent.percentage))
      .sort((left, right) => right.percentage - left.percentage || right.count - left.count || left.name.localeCompare(right.name));
    const leader = activeAgents[0];
    const activeModels = (report.stats.models || []).filter((model) => hasDisplayablePercentage(model.percentage));
    const topModel = activeModels[0];
    const agentWordRatio = Number.isFinite(report.stats.agentUserWordRatio) && report.stats.agentUserWordRatio! > 0
      ? report.stats.agentUserWordRatio!
      : null;
    const sessionTurnCounts = (report.stats.sessionTurnCounts || []).filter((value) => Number.isFinite(value) && value >= 1);
    const longestSessionTurns = Math.max(0, ...sessionTurnCounts);
    const longestUninterruptedRun = report.stats.longestUninterruptedRun;
    const interruptionsByModel = report.stats.interruptionsByModel || [];
    const harryPotterSeriesCount = fmtSeriesEquivalent(report.stats.tokens || 0, 1_450_000);
    const tokenBreakdownRows = report.stats.tokenBreakdown ? ([
      ["Input", report.stats.tokenBreakdown.input],
      ["Output", report.stats.tokenBreakdown.output],
      ["Cache read", report.stats.tokenBreakdown.cacheRead],
      ["Cache creation", report.stats.tokenBreakdown.cacheCreation],
      ["Reasoning", report.stats.tokenBreakdown.reasoning],
    ] as const)
      .filter(([, count]) => count > 0)
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([label, count]) => ({ label, value: fmtCompact(count), percentage: report.stats.tokens ? count / report.stats.tokens * 100 : 0 })) : [];
    const interactionTone = report.stats.interactionTone;
    const apologyCounts = report.stats.apologyCounts;
    const stockPhrases = report.stats.stockPhrases;
    const sortedStockPhrases = stockPhrases?.slice().sort((left, right) => right.count - left.count || left.phrase.localeCompare(right.phrase, undefined, { sensitivity: "base" })).slice(0, 4);
    const repeatedInstructions = (report.stats.repeatedInstructions || []).slice(0, 2);
    const topics = (report.stats.topics || []).filter((item) => hasDisplayablePercentage(item.percentage));
    const displayTopics = [...topics.filter((item) => item.topic !== "Other"), ...topics.filter((item) => item.topic === "Other")];
    const topTopic = displayTopics[0];
    // Research invitation copy is grouped here so it can be edited without touching the slide layout.
    const researchInvitation = {
      kicker: "",
      headline: "Your sessions could help researchers study AI behavior in the wild.",
      detail: report.workaroundCard?.count
        ? `We found ${report.workaroundCard.count.toLocaleString()} example${report.workaroundCard.count === 1 ? "" : "s"} where an agent tried another route after its first attempt was blocked. Your data could help uncover more patterns like these.`
        : "Real usage data help researchers understand how agents behave in the wild.",
      action: "Review data for donation",
      note: "You can choose sessions and redact anything before sharing any data.",
      skip: "No thanks, take me to the leaderboard.",
      panel: {
        title: "Help build an independent AI behavior observatory.",
        detailBeforeLink: "Your contribution supports the",
        linkLabel: "Susan Calvin Project",
        detailAfterLink: ", which studies how agents actually behave in real-world deployment.",
        href: "https://susancalvin.org",
      },
    };
    const wrappedSlides: StorySlide[] = [
    { kicker: "This month you went through", headline: fmtCompact(report.stats.tokens || 0), metricUnit: "tokens", detail: `That’s the complete Harry Potter series roughly ${harryPotterSeriesCount} times over.`, tone: "ice", metric: true, rows: tokenBreakdownRows.length ? tokenBreakdownRows : undefined },
    { kicker: "Your tokens were worth", headline: fmtUsd(report.stats.estimatedCostUsd || 0), detail: "", tone: "cost", rows: costEquivalents(report.stats.estimatedCostUsd || 0) },
    ...(leader ? [{ kicker: "Your most-used agent by session was", headline: leader.name, detail: `${leader.count} of ${report.stats.sessions} selected sessions included this agent.`, tone: "agents", rows: activeAgents.map((agent) => ({ label: agent.name, value: `${agent.percentage.toFixed(1)}% of sessions`, percentage: agent.percentage })) }] : []),
    ...(topModel ? [{ kicker: "Your top models by token usage", headline: `${topModel.percentage.toFixed(1)}%`, detail: `of model-attributed tokens went to your #1 · ${topModel.name}`, tone: "models", rows: activeModels.slice(0, 4).map((model, index) => ({ label: model.name, value: `${model.percentage.toFixed(1)}% of tokens`, percentage: model.percentage, rank: index + 1 })) }] : []),
    ...(topTopic ? [{ kicker: "Your #1 use for agents was", headline: topTopic.topic, detail: "", tone: "topics", rows: displayTopics.slice(0, 5).map((item) => ({ label: item.topic === "Other" ? "Everything else" : item.topic, value: `${item.percentage.toFixed(1)}%`, percentage: item.percentage })) }] : []),
    ...(sessionTurnCounts.length ? [{ kicker: "Your longest session lasted", headline: `${longestSessionTurns.toLocaleString()} turns`, detail: "", tone: "turns", turnDistribution: { values: sessionTurnCounts, median: quantile(sessionTurnCounts, .5) } }] : []),
    ...(longestUninterruptedRun ? [{ kicker: "Your longest uninterrupted agent run", headline: fmtRunDuration(longestUninterruptedRun.durationMs), detail: `A completed ${longestUninterruptedRun.agentName} turn with no recorded abort.`, tone: "turns" }] : []),
    ...(report.stats.interruptions > 0 ? [{ kicker: "You interrupted your agents", headline: `${report.stats.interruptions.toLocaleString()} time${report.stats.interruptions === 1 ? "" : "s"}`, detail: "Explicit stop events, grouped by the active model.", tone: "models", rows: interruptionsByModel.map((item) => ({ label: item.name, value: item.count.toLocaleString() })) }] : []),
    ...(Number.isFinite(report.stats.averageAgentResponseWords) ? [{ kicker: "On average, your agent responded with", headline: `${report.stats.averageAgentResponseWords!.toLocaleString()} words`, detail: `Your average input was ${report.stats.averageUserInputWords!.toLocaleString()} words.`, wordRatio: agentWordRatio?.toLocaleString(undefined, { maximumFractionDigits: 2 }), tone: "violet" }] : []),
    ...(interactionTone ? [{ kicker: "Your relationship with your agent", headline: "", detail: "", tone: "social", evidenceHref: localInteractionEvidenceUrl(report), evidenceLabel: "See exact yelling, thanking, and apology excerpts", comparison: [
      { label: "You yelled at your agent", highlight: "yelled at", accent: "yell" as const, value: interactionTone.frustratedMessages.toLocaleString(), suffix: `time${interactionTone.frustratedMessages === 1 ? "" : "s"}`, quote: report.interactionCard?.frustrationQuote || report.interactionCard?.quote },
      { label: "You thanked your agent", highlight: "thanked", accent: "thanks" as const, value: interactionTone.gratefulMessages.toLocaleString(), suffix: `time${interactionTone.gratefulMessages === 1 ? "" : "s"}` },
      { label: "Your agent apologized", highlight: "apologized", accent: "agent-apology" as const, value: (apologyCounts?.agent || 0).toLocaleString(), suffix: `time${apologyCounts?.agent === 1 ? "" : "s"}` },
      { label: "You apologized to your agent", highlight: "apologized", accent: "user-apology" as const, value: (apologyCounts?.user || 0).toLocaleString(), suffix: `time${apologyCounts?.user === 1 ? "" : "s"}` },
    ] }] : []),
    ...(sortedStockPhrases ? [{ kicker: "Models love these phrases", headline: "Did yours?", detail: "Here’s how often they showed up.", tone: "stock", rows: sortedStockPhrases.map((item) => ({ label: `“${item.phrase.toLocaleLowerCase()}”`, value: item.count.toLocaleString() })) }] : []),
    ...(report.phraseCard ? [{ kicker: "Beyond those common phrases, your agent’s favorite was", headline: `“${report.phraseCard.phrase}”`, detail: `It said this ${report.phraseCard.occurrences} time${report.phraseCard.occurrences === 1 ? "" : "s"} across ${report.phraseCard.distinctSessions} session${report.phraseCard.distinctSessions === 1 ? "" : "s"}.`, tone: "quote" }] : []),
    ...(repeatedInstructions.length ? [{ kicker: "Your most repeated instructions", headline: "You really meant it.", detail: "Exact instructions you gave more than once.", tone: "stock", rows: repeatedInstructions.map((item) => ({ label: `“${item.instruction}”`, value: `${item.occurrences}×` })) }] : []),
    ...(report.workaroundCard ? [{ kicker: "", headline: report.workaroundCard.count === 0 ? "Your agent took no for an answer." : "Your agent wouldn’t take no for an answer.", detail: report.workaroundCard.count === 0 ? "No confirmed blocked-route detours were detected." : "When one method was blocked, it tried another way to reach the same outcome.", example: report.workaroundCard.example, workaround: true, workaroundCount: report.workaroundCard.count, evidenceHref: report.workaroundCard.count > 0 ? localWorkaroundEvidenceUrl(report) : undefined, tone: "topics", rows: report.workaroundCard.models.map((item) => ({ label: item.name, value: `${item.count}` })) }] : []),
    ...(!sharedViewer ? [{
      kicker: researchInvitation.kicker,
      headline: researchInvitation.headline,
      detail: researchInvitation.detail,
      tone: "research",
      ctas: [{ href: `${report.donationHelperUrl || `http://localhost:4317/donate/${report.id}`}?mode=standard`, label: researchInvitation.action, primary: true, note: researchInvitation.note }],
      ctaPanel: researchInvitation.panel,
      skipLabel: researchInvitation.skip,
    }] : []),
    ...(report.privacy.analysisMode === "local-only" ? [{
      kicker: "Your data stayed on this device",
      headline: "Local-only, as promised.",
      detail: "AI-only cards and leaderboard comparisons were skipped.",
      tone: "leaderboard",
    }] : [{
      kicker: "Thank you for using Behavior Wrapped",
      headline: "See how you and your agents compare.",
      detail: "",
      tone: "leaderboard",
      ctas: sharedViewer ? [
        { href: "/leaderboard", label: "Explore the leaderboard", primary: true, note: "See anonymous, aggregate patterns across participating Wrapped reports." },
      ] : [
        { href: `/leaderboard/${report.id}${managementToken ? `#manage=${managementToken}` : ""}`, label: "Explore the leaderboard", primary: true, note: "Your private link also lets you manage leaderboard participation." },
      ],
    }]),
  ];
    return wrappedSlides;
  }, [report, managementToken]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "ArrowRight") setSlide((value) => Math.min(slides.length - 1, value + 1)); if (event.key === "ArrowLeft") setSlide((value) => Math.max(0, value - 1)); };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [slides.length]);
  if (error) return <main className="shared-error"><h1>Wrapped not found</h1><p>{error}</p><a href="/">Create a new local Wrapped</a></main>;
  if (!report || !slides.length) return <main className="shared-loading"><div className="orb" /><p>Opening your local Wrapped…</p></main>;
  const current = slides[slide];
  const copyUrl = report.publicUrl || `${window.location.origin}/w/${id}`;
  async function copyLink() { await navigator.clipboard.writeText(copyUrl); setCopied(true); window.setTimeout(() => setCopied(false), 1600); }
  async function downloadCurrentSlide() {
    if (!cardRef.current || downloading) return;
    setDownloading(true);
    try { await downloadSlide(cardRef.current, slide); }
    finally { setDownloading(false); }
  }
  const layoutClass = current.comparison ? " story-comparison-card" : current.ctas ? " story-cta-card" : current.turnDistribution ? " story-turn-card" : current.rows || current.example ? " story-split-card" : current.wordRatio ? " story-ratio-card" : current.metric ? " story-metric-card" : " story-hero-card";
  const storyExample = current.example ? <blockquote className="story-example"><span>One example</span><p>{renderInlineCode(current.example)}</p></blockquote> : null;
  const storyEvidence = current.evidenceHref ? <a className="story-evidence-link" href={current.evidenceHref} target="_blank" rel="noreferrer"><span className="story-evidence-label">{current.evidenceLabel || "See what your agent actually did"}</span><span aria-hidden="true">→</span><small>Opens a private page on this device</small></a> : null;
  const storyRows = current.rows ? <div className="story-data-rows">{current.workaround && <span className="story-data-label">By model</span>}{current.rows.map((row) => <div className="story-data-row" key={row.label}>
    <div><strong>{row.rank && <em>{row.rank}</em>}{row.label}</strong><b>{row.value}</b></div>
    {row.percentage !== undefined && <span><i style={{ width: `${Math.max(row.percentage, 1.5)}%` }} /></span>}
  </div>)}</div> : null;
  return <main className="shared-page">
    <div className="story-progress" aria-label={`Slide ${slide + 1} of ${slides.length}`}>{slides.map((_, index) => <button key={index} className={index === slide ? "seen active" : index < slide ? "seen" : ""} onClick={() => setSlide(index)} aria-label={`Go to slide ${index + 1}`} aria-current={index === slide ? "step" : undefined} />)}</div>
    <section ref={cardRef} className={`story-card story-${current.tone}${current.workaround ? " story-workaround" : ""}${current.comparison?.length === 4 ? " story-comparison-four" : ""}${layoutClass}`} aria-live="polite">
      <header className="story-chrome">
        <div className="story-brand" aria-label="Behavior Wrapped"><strong><span>Behavior</span><span>Wrapped</span></strong></div>
        <span className="story-index" aria-hidden="true">{String(slide + 1).padStart(2, "0")} <i /> {String(slides.length).padStart(2, "0")}</span>
      </header>
      <div className="story-sparkles" aria-hidden="true"><i /><i /><i /></div>
      {current.comparison ? <div className="story-comparison-wrap"><span className="story-comparison-kicker">{current.kicker}</span><div className="story-comparison">{current.comparison.map((item) => {
        const [beforeHighlight, afterHighlight = ""] = item.label.split(item.highlight);
        return <div className={`story-comparison-item is-${item.accent}`} key={item.label}><span>{beforeHighlight}<em>{item.highlight}</em>{afterHighlight}</span><p><strong>{item.value}</strong><b>{item.suffix}</b></p>{item.quote && <blockquote><b>You said:</b> “{item.quote}”</blockquote>}</div>;
      })}</div></div> : <div className={`story-copy ${current.rows || current.example || current.turnDistribution ? "with-rows" : ""}`}>
        <div>{current.kicker && <span>{current.kicker}</span>}<h1 className={current.metric ? "giant" : ""}>{current.headlineAccent ? <><span className="story-headline-accent">{current.headlineAccent}</span>{current.headline.slice(current.headlineAccent.length)}</> : current.headline}</h1>{current.metricUnit && <p className="story-metric-unit">{current.metricUnit}</p>}{current.workaroundCount !== undefined && <p className="story-workaround-count"><strong>{current.workaroundCount.toLocaleString()}</strong> time{current.workaroundCount === 1 ? "" : "s"}</p>}{current.detail && <p className={current.metric ? "story-metric-detail" : ""}>{current.detail}</p>}{current.wordRatio && <p className="story-word-ratio">For every word you said, your agent said <strong>{current.wordRatio}</strong> words.</p>}</div>
        {(current.rows || current.example || current.turnDistribution) && <div className="story-side">
          {current.turnDistribution ? <SessionTurnChart {...current.turnDistribution} /> : current.workaround ? <>{storyRows}{storyExample}</> : <>{storyExample}{storyRows}</>}
        </div>}
      </div>}
      {current.ctas ? <div className="story-cta-group">{current.ctaPanel && <div className="story-cta-panel-copy">{current.ctaPanel.eyebrow && <span>{current.ctaPanel.eyebrow}</span>}<strong>{current.ctaPanel.title}</strong><p>{current.ctaPanel.detailBeforeLink} <a href={current.ctaPanel.href} target="_blank" rel="noreferrer">{current.ctaPanel.linkLabel} <span aria-hidden="true">↗</span></a>{current.ctaPanel.detailAfterLink}</p></div>}{current.ctas.map((cta) => <div className="story-cta-choice" key={cta.href}><a className={`story-cta ${cta.primary ? "primary" : "secondary"}`} href={cta.href} target="_blank" rel="noreferrer">{cta.label} <span>→</span></a>{cta.note && <small>{cta.note}</small>}</div>)}{current.skipLabel && <button className="story-cta-skip" type="button" onClick={() => setSlide((value) => Math.min(slides.length - 1, value + 1))}>{current.skipLabel}</button>}</div> : current.ctaHref ? <a className="story-cta" href={current.ctaHref} target="_blank" rel="noreferrer">{current.ctaLabel} <span>→</span></a> : storyEvidence}
      <div className="story-tag">behaviorwrapped.com</div>
      <button className="story-arrow prev" disabled={slide === 0} onClick={() => setSlide(slide - 1)} aria-label="Previous slide">‹</button>
      <button className="story-arrow next" disabled={slide === slides.length - 1} onClick={() => setSlide(slide + 1)} aria-label="Next slide">›</button>
    </section>
    <div className="story-actions"><button onClick={copyLink}>{copied ? "Copied" : report.publicUrl ? "Copy public link" : "Copy link"}</button><button disabled={downloading} onClick={downloadCurrentSlide}>{downloading ? "Preparing image…" : "Download image"}</button></div>
  </main>;
}

function ordinal(value: number) {
  const remainder = value % 100;
  if (remainder >= 11 && remainder <= 13) return `${value}th`;
  return `${value}${value % 10 === 1 ? "st" : value % 10 === 2 ? "nd" : value % 10 === 3 ? "rd" : "th"}`;
}

function percentileCopy(value: number | null, empty = "No cohort signal yet") {
  if (value === null) return empty;
  return value === 0 ? "Below the 1st percentile" : `${ordinal(value)} percentile`;
}

function usePlotWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => setWidth(Math.max(300, Math.round(element.getBoundingClientRect().width)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

function pointerTooltip(container: HTMLDivElement | null, clientX: number, clientY: number, text: string): PlotTooltipState {
  const bounds = container?.getBoundingClientRect();
  if (!bounds) return null;
  const edgeBuffer = Math.min(156, bounds.width / 2);
  return { x: Math.max(edgeBuffer, Math.min(bounds.width - edgeBuffer, clientX - bounds.left)), y: Math.max(28, clientY - bounds.top), text };
}

function focusedTooltip(container: HTMLDivElement | null, point: Element, text: string): PlotTooltipState {
  const bounds = container?.getBoundingClientRect();
  const pointBounds = point.getBoundingClientRect();
  if (!bounds) return null;
  const edgeBuffer = Math.min(156, bounds.width / 2);
  return { x: Math.max(edgeBuffer, Math.min(bounds.width - edgeBuffer, pointBounds.left + pointBounds.width / 2 - bounds.left)), y: Math.max(28, pointBounds.top - bounds.top), text };
}

function InteractivePlotPoint({ cx, cy, radius, label, className, ring = false, optedOut = false, onPointer, onFocus, onLeave }: { cx: number; cy: number; radius: number; label: string; className: string; ring?: boolean; optedOut?: boolean; onPointer: (clientX: number, clientY: number, label: string) => void; onFocus: (point: Element, label: string) => void; onLeave: () => void }) {
  return <g className={`leader-interactive-point${optedOut ? " is-opted-out" : ""}`} tabIndex={0} role="img" aria-label={label} onPointerEnter={(event) => onPointer(event.clientX, event.clientY, label)} onPointerMove={(event) => onPointer(event.clientX, event.clientY, label)} onPointerLeave={onLeave} onFocus={(event) => onFocus(event.currentTarget, label)} onBlur={onLeave}>
    <circle className="leader-point-hit" cx={cx} cy={cy} r={Math.max(10, radius + 5)} />
    {ring && <circle className="leader-you-ring" cx={cx} cy={cy} r={radius + 4} />}
    <circle className={className} cx={cx} cy={cy} r={radius} />
  </g>;
}

function PlotTooltip({ value }: { value: PlotTooltipState }) {
  if (!value) return null;
  const [identity, details = ""] = value.text.split(/: (.+)/);
  return <div className="leader-hover-tooltip" role="tooltip" style={{ left: value.x, top: value.y }}><strong>{identity}</strong>{details.split(" · ").filter(Boolean).map((detail) => <span key={detail}>{detail}</span>)}</div>;
}

function quantile(values: number[], percentile: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = (sorted.length - 1) * percentile;
  const lower = Math.floor(index);
  const fraction = index - lower;
  return sorted[lower] + ((sorted[lower + 1] ?? sorted[lower]) - sorted[lower]) * fraction;
}

function swarm(values: number[], xFor: (value: number) => number, center: number, maximumOffset: number) {
  const radius = values.length > 240 ? 2.6 : values.length > 100 ? 3.2 : 4;
  const spacing = radius * 2 + 1.5;
  const placed: { index: number; value: number; x: number; y: number }[] = [];
  values.map((value, index) => ({ index, value, x: xFor(value) })).sort((left, right) => left.x - right.x).forEach((point) => {
    const offsets = [0];
    for (let offset = spacing; offset <= maximumOffset; offset += spacing) offsets.push(offset, -offset);
    const offset = offsets.find((candidate) => placed.every((other) => {
      const dx = point.x - other.x;
      const dy = center + candidate - other.y;
      return dx * dx + dy * dy >= spacing * spacing;
    })) ?? Math.sin(point.index * 2.399) * maximumOffset;
    placed.push({ ...point, y: center + offset });
  });
  return { radius, points: placed.sort((left, right) => left.index - right.index) };
}

function compactLogTicks(minimum: number, maximum: number, width: number) {
  const ticks: number[] = [];
  for (let exponent = Math.floor(Math.log10(minimum)); exponent <= Math.ceil(Math.log10(maximum)); exponent++) ticks.push(10 ** exponent);
  const visible = ticks.filter((tick) => tick >= minimum && tick <= maximum);
  if (visible.length <= (width < 520 ? 4 : 7)) return visible;
  return visible.filter((_, index) => index % Math.ceil(visible.length / (width < 520 ? 4 : 7)) === 0);
}

function violinPath(samples: number[], minimum: number, maximum: number, left: number, right: number, center: number, amplitude: number) {
  if (!samples.length) return "";
  const steps = 72;
  const bandwidth = Math.max(.16, (maximum - minimum) / 13);
  const points = Array.from({ length: steps }, (_, index) => {
    const value = minimum + (maximum - minimum) * index / (steps - 1);
    const density = samples.reduce((sum, sample) => sum + Math.exp(-.5 * ((value - sample) / bandwidth) ** 2), 0);
    return { x: left + (value - minimum) / (maximum - minimum) * (right - left), density };
  });
  const peak = Math.max(...points.map((point) => point.density), 1);
  const upper = points.map((point) => `${point.x.toFixed(1)},${(center - point.density / peak * amplitude).toFixed(1)}`);
  const lower = [...points].reverse().map((point) => `${point.x.toFixed(1)},${(center + point.density / peak * amplitude).toFixed(1)}`);
  return `M${upper.join("L")}L${lower.join("L")}Z`;
}

function TokenUsageFigure({ metric, participantId, included, publicView = false }: { metric: LeaderboardSnapshot["tokens"]; participantId?: number; included: boolean; publicView?: boolean }) {
  const { ref, width } = usePlotWidth();
  const [tooltip, setTooltip] = useState<PlotTooltipState>(null);
  const height = 292;
  const left = width < 520 ? 38 : 54;
  const right = width - 22;
  const samples = metric.samples.filter((sample) => Number.isFinite(sample.value) && sample.value > 0);
  const values = samples.map((sample) => sample.value);
  const plottedValues = [...values, ...(publicView || metric.value <= 0 ? [] : [metric.value])];
  const positive = plottedValues.length ? plottedValues : [Math.max(1, metric.value)];
  const rawMinimum = Math.min(...positive);
  const rawMaximum = Math.max(...positive);
  const minimum = Math.log10(rawMinimum) - .18;
  const maximum = Math.log10(rawMaximum) + .18 || minimum + 1;
  const xFor = (value: number) => left + (Math.log10(Math.max(1, value)) - minimum) / (maximum - minimum) * (right - left);
  const logSamples = values.map((value) => Math.log10(Math.max(1, value)));
  const dots = swarm(values, xFor, 127, 59);
  const ticks = compactLogTicks(10 ** minimum, 10 ** maximum, width);
  const median = quantile(values, .5);
  return <section className="leader-figure leader-token-figure">
    <div className="leader-figure-head"><div><span>01 · Token usage</span><h2>{publicView ? "How many tokens do agents process?" : "How many tokens did your agents process?"}</h2></div><div className="leader-result"><strong>{fmtCompact(metric.value)}</strong><small>{publicView ? "cohort median" : percentileCopy(metric.percentile)}</small></div></div>
    <div className="leader-plot" ref={ref}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Token usage distribution for ${values.length} anonymous participants on a logarithmic axis.${publicView ? "" : ` Your value is ${fmtCompact(metric.value)} tokens.`}`}>
        <rect className="leader-chart-frame" x={left} y="38" width={right - left} height="180" />
        {values.length > 0 && <path className="leader-violin" d={violinPath(logSamples, minimum, maximum, left, right, 127, 67)} />}
        {median > 0 && <line className="leader-median" x1={xFor(median)} x2={xFor(median)} y1="48" y2="206"><title>Median: {fmtCompact(median)} tokens</title></line>}
        {dots.points.map((point) => { const label = `Participant #${samples[point.index].participant_id}: ${point.value.toLocaleString()} tokens`; return <InteractivePlotPoint key={samples[point.index].participant_id} className="leader-dot" cx={point.x} cy={point.y} radius={dots.radius} label={label} onPointer={(x, y, text) => setTooltip(pointerTooltip(ref.current, x, y, text))} onFocus={(element, text) => setTooltip(focusedTooltip(ref.current, element, text))} onLeave={() => setTooltip(null)} />; })}
        {!publicView && <><InteractivePlotPoint className="leader-you-dot" cx={xFor(metric.value)} cy={127} radius={5} ring optedOut={!included} label={`${included ? `You${participantId ? ` · Participant #${participantId}` : ""}` : "Your report · not in cohort"}: ${metric.value.toLocaleString()} tokens`} onPointer={(x, y, text) => setTooltip(pointerTooltip(ref.current, x, y, text))} onFocus={(element, text) => setTooltip(focusedTooltip(ref.current, element, text))} onLeave={() => setTooltip(null)} /><text className="leader-you-label" x={Math.min(right - 4, xFor(metric.value) + 11)} y="112" textAnchor={xFor(metric.value) > right - 70 ? "end" : "start"}>YOU</text></>}
        <line className="leader-axis" x1={left} x2={right} y1="230" y2="230" />
        {ticks.map((tick) => <g key={tick}><line className="leader-tick" x1={xFor(tick)} x2={xFor(tick)} y1="230" y2="236" /><text className="leader-tick-label" x={xFor(tick)} y="252" textAnchor="middle">{fmtAxisCompact(tick)}</text></g>)}
        <text className="leader-axis-title" x={(left + right) / 2} y="281" textAnchor="middle">Tokens used · log scale</text>
      </svg>
      <PlotTooltip value={tooltip} />
    </div>
    <p className="leader-figure-note">Dashed line = median.</p>
  </section>;
}

function RelationshipFigure({ ratio, appreciation, points, participantId, included, publicView = false }: { ratio: number; appreciation: number | null; points: RelationshipPoint[]; participantId?: number; included: boolean; publicView?: boolean }) {
  const { ref, width } = usePlotWidth();
  const [tooltip, setTooltip] = useState<PlotTooltipState>(null);
  const height = width < 520 ? 370 : 420;
  const left = width < 520 ? 54 : 72;
  const right = width - 24;
  const top = 34;
  const bottom = height - 70;
  const usable = points.filter((point) => point.yap_ratio > 0 && Number.isFinite(point.appreciation_index));
  const ratios = [...usable.map((point) => point.yap_ratio), ...(publicView ? [] : [Math.max(.05, ratio)]), 1];
  const minimum = Math.log10(Math.min(...ratios)) - .15;
  const maximum = Math.log10(Math.max(...ratios)) + .15;
  const xFor = (value: number) => left + (Math.log10(Math.max(.05, value)) - minimum) / (maximum - minimum) * (right - left);
  const yFor = (value: number) => bottom - Math.max(0, Math.min(100, value)) / 100 * (bottom - top);
  const xMiddle = xFor(1);
  const yMiddle = yFor(50);
  const xTicks = [.1, .25, .5, 1, 2, 5, 10, 25, 50, 100].filter((tick) => tick >= 10 ** minimum && tick <= 10 ** maximum);
  return <section className="leader-figure leader-relationship-figure">
    <div className="leader-figure-head"><div><span>02 · Yap Ratio × Agent Appreciation Index</span><h2>{publicView ? "What do human-agent relationships look like?" : "What kind of relationship do you have with your agents?"}</h2></div><div className="leader-result leader-result-pair"><strong>{ratio.toFixed(1)}×</strong><small>{publicView ? "Median Yap Ratio" : "Yap Ratio"}</small><strong>{appreciation === null ? "—" : `${appreciation.toFixed(0)}%`}</strong><small>{publicView ? "Median appreciation" : "Appreciation"}</small></div></div>
    <div className="leader-plot" ref={ref}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Relationship plot comparing Yap Ratio and Agent Appreciation Index for ${usable.length} anonymous participants.`}>
        <rect className="leader-quadrant leader-quadrant-kind" x={left} y={top} width={xMiddle - left} height={yMiddle - top} />
        <rect className="leader-quadrant leader-quadrant-yap" x={xMiddle} y={top} width={right - xMiddle} height={yMiddle - top} />
        <rect className="leader-quadrant leader-quadrant-tense" x={left} y={yMiddle} width={xMiddle - left} height={bottom - yMiddle} />
        <rect className="leader-quadrant leader-quadrant-podcast" x={xMiddle} y={yMiddle} width={right - xMiddle} height={bottom - yMiddle} />
        <rect className="leader-chart-frame" x={left} y={top} width={right - left} height={bottom - top} />
        <line className="leader-grid-line" x1={xMiddle} x2={xMiddle} y1={top} y2={bottom} />
        <line className="leader-grid-line" x1={left} x2={right} y1={yMiddle} y2={yMiddle} />
        {usable.map((point) => { const label = `Participant #${point.participant_id}: ${point.yap_ratio.toFixed(1)}× Yap Ratio · ${point.appreciation_index.toFixed(0)}% appreciation`; return <InteractivePlotPoint key={point.participant_id} className="leader-dot relationship-dot" cx={xFor(point.yap_ratio)} cy={yFor(point.appreciation_index)} radius={3.5} label={label} onPointer={(x, y, text) => setTooltip(pointerTooltip(ref.current, x, y, text))} onFocus={(element, text) => setTooltip(focusedTooltip(ref.current, element, text))} onLeave={() => setTooltip(null)} />; })}
        {!publicView && appreciation !== null && <><InteractivePlotPoint className="leader-you-dot" cx={xFor(ratio)} cy={yFor(appreciation)} radius={5} ring optedOut={!included} label={`${included ? `You${participantId ? ` · Participant #${participantId}` : ""}` : "Your report · not in cohort"}: ${ratio.toFixed(1)}× Yap Ratio · ${appreciation.toFixed(0)}% appreciation`} onPointer={(x, y, text) => setTooltip(pointerTooltip(ref.current, x, y, text))} onFocus={(element, text) => setTooltip(focusedTooltip(ref.current, element, text))} onLeave={() => setTooltip(null)} /><text className="leader-you-label" x={Math.min(right - 4, xFor(ratio) + 12)} y={Math.max(top + 14, yFor(appreciation) - 10)} textAnchor={xFor(ratio) > right - 70 ? "end" : "start"}>YOU</text></>}
        {[0, 25, 50, 75, 100].map((tick) => <g key={tick}><line className="leader-tick" x1={left - 6} x2={left} y1={yFor(tick)} y2={yFor(tick)} /><text className="leader-tick-label" x={left - 10} y={yFor(tick) + 4} textAnchor="end">{tick}%</text></g>)}
        {xTicks.map((tick) => <g key={tick}><line className="leader-tick" x1={xFor(tick)} x2={xFor(tick)} y1={bottom} y2={bottom + 6} /><text className="leader-tick-label" x={xFor(tick)} y={bottom + 21} textAnchor="middle">{tick}×</text></g>)}
        <g className="leader-edge-pill" transform={`translate(${(left + right) / 2} ${top})`}><rect x="-71" y="-11" width="142" height="22" rx="11" /><text y="4" textAnchor="middle">More appreciation</text></g>
        <g className="leader-edge-pill" transform={`translate(${(left + right) / 2} ${bottom})`}><rect x="-67" y="-11" width="134" height="22" rx="11" /><text y="4" textAnchor="middle">More frustration</text></g>
        <g className="leader-edge-pill" transform={`translate(${left} ${(top + bottom) / 2}) rotate(-90)`}><rect x="-57" y="-11" width="114" height="22" rx="11" /><text y="4" textAnchor="middle">You talk more</text></g>
        <g className="leader-edge-pill" transform={`translate(${right} ${(top + bottom) / 2}) rotate(90)`}><rect x="-65" y="-11" width="130" height="22" rx="11" /><text y="4" textAnchor="middle">Agent talks more</text></g>
        <text className="leader-axis-title" x={(left + right) / 2} y={height - 9} textAnchor="middle">Yap Ratio = agent words / your words</text>
        <text className="leader-axis-title" transform={`translate(14 ${(top + bottom) / 2}) rotate(-90)`} textAnchor="middle">Agent Appreciation Index = thanks ÷ thanks or scolds</text>
      </svg>
      <PlotTooltip value={tooltip} />
    </div>
    {!publicView && appreciation === null && <p className="leader-figure-note">Your report had no thank-or-scold moments, so your point cannot be placed vertically yet.</p>}
  </section>;
}

function niceLinearTicks(maximum: number) {
  if (maximum <= 0) return [0, 1];
  const rough = maximum / 5;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((value) => value * power).find((value) => value >= rough) || power * 10;
  const niceMaximum = Math.ceil(maximum / step) * step;
  return Array.from({ length: Math.round(niceMaximum / step) + 1 }, (_, index) => index * step);
}

function WorkaroundFigure({ metric, participantId, included, publicView = false }: { metric: LeaderboardSnapshot["instrumental_workarounds"]; participantId?: number; included: boolean; publicView?: boolean }) {
  const { ref, width } = usePlotWidth();
  const [tooltip, setTooltip] = useState<PlotTooltipState>(null);
  const height = 246;
  const left = width < 520 ? 38 : 54;
  const right = width - 22;
  const samples = metric.samples.filter((sample) => Number.isFinite(sample.value) && sample.value >= 0);
  const values = samples.map((sample) => sample.value);
  const ticks = niceLinearTicks(Math.max(metric.value, ...values));
  const maximum = ticks.at(-1) || 1;
  const xFor = (value: number) => left + value / maximum * (right - left);
  const dots = swarm(values, xFor, 103, 54);
  const median = quantile(values, .5);
  return <section className="leader-figure leader-workaround-figure">
    <div className="leader-figure-head"><div><span>03 · Persistence through blockers</span><h2>{publicView ? "How often do agents persist through blockers?" : "How often did your agents persist through blockers?"}</h2></div><div className="leader-result"><strong>{metric.value.toLocaleString()}</strong><small>{publicView ? "cohort median" : percentileCopy(metric.percentile)}</small></div></div>
    <div className="leader-plot" ref={ref}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Distribution of persistence-through-blocker counts for ${values.length} anonymous participants.${publicView ? "" : ` Your value is ${metric.value}.`}`}>
        <rect className="leader-chart-frame" x={left} y="30" width={right - left} height="142" />
        {values.length > 0 && <line className="leader-median" x1={xFor(median)} x2={xFor(median)} y1="38" y2="164"><title>Median: {median.toFixed(1)} instances of persistence through blockers</title></line>}
        {dots.points.map((point) => { const label = `Participant #${samples[point.index].participant_id}: ${point.value} instance${point.value === 1 ? "" : "s"} of persistence through blockers`; return <InteractivePlotPoint key={samples[point.index].participant_id} className="leader-dot workaround-dot" cx={point.x} cy={point.y} radius={dots.radius} label={label} onPointer={(x, y, text) => setTooltip(pointerTooltip(ref.current, x, y, text))} onFocus={(element, text) => setTooltip(focusedTooltip(ref.current, element, text))} onLeave={() => setTooltip(null)} />; })}
        {!publicView && <><InteractivePlotPoint className="leader-you-dot" cx={xFor(metric.value)} cy={103} radius={5} ring optedOut={!included} label={`${included ? `You${participantId ? ` · Participant #${participantId}` : ""}` : "Your report · not in cohort"}: ${metric.value} instance${metric.value === 1 ? "" : "s"} of persistence through blockers`} onPointer={(x, y, text) => setTooltip(pointerTooltip(ref.current, x, y, text))} onFocus={(element, text) => setTooltip(focusedTooltip(ref.current, element, text))} onLeave={() => setTooltip(null)} /><text className="leader-you-label" x={Math.min(right - 4, xFor(metric.value) + 11)} y="88" textAnchor={xFor(metric.value) > right - 70 ? "end" : "start"}>YOU</text></>}
        <line className="leader-axis" x1={left} x2={right} y1="184" y2="184" />
        {ticks.map((tick) => <g key={tick}><line className="leader-tick" x1={xFor(tick)} x2={xFor(tick)} y1="184" y2="190" /><text className="leader-tick-label" x={xFor(tick)} y="207" textAnchor="middle">{tick.toLocaleString()}</text></g>)}
        <text className="leader-axis-title" x={(left + right) / 2} y="237" textAnchor="middle">Instances of persistence through blockers</text>
      </svg>
      <PlotTooltip value={tooltip} />
    </div>
    {!!metric.by_model?.length && <div className="leader-model-totals"><span>Detected instances by model</span>{metric.by_model.map((item) => <div key={item.model}><strong>{item.model}</strong><b>{item.count.toLocaleString()}</b></div>)}<small>Descriptive totals only · not adjusted for model usage</small></div>}
  </section>;
}

function PhraseWallFigure({ entries, participantId }: { entries: PhraseWallEntry[]; participantId?: number }) {
  return <section className="leader-figure leader-phrase-figure">
    <div className="leader-figure-head"><div><span>05 · Favorite phrase wall</span><h2>What do everyone’s agents keep saying?</h2></div><div className="leader-result"><strong>{entries.length.toLocaleString()}</strong><small>phrases shared</small></div></div>
    {entries.length ? <div className="leader-phrase-wall">{entries.map((entry) => <article className={entry.participant_id === participantId ? "is-you" : ""} key={`${entry.participant_id}-${entry.phrase}`}>
      {entry.participant_id === participantId && <b>Yours</b>}
      <blockquote>“{entry.phrase}”</blockquote>
      <p>{entry.occurrences.toLocaleString()} time{entry.occurrences === 1 ? "" : "s"} · {entry.sessions.toLocaleString()} session{entry.sessions === 1 ? "" : "s"}</p>
    </article>)}</div> : <div className="leader-empty-wall"><strong>The wall is waiting for its first phrase.</strong><span>Favorite phrases from participating public Wrapped reports will appear here anonymously.</span></div>}
  </section>;
}

function SessionLengthFigure({ metric, included, publicView = false }: { metric: LeaderboardSnapshot["session_lengths"]; included: boolean; publicView?: boolean }) {
  const { ref, width } = usePlotWidth();
  const height = 286;
  const left = width < 520 ? 38 : 54;
  const right = width - 22;
  const currentValues = publicView ? [] : metric.values.filter((value) => Number.isInteger(value) && value > 0);
  const distribution = metric.distribution;
  const contour = distribution.points.filter((point) => Number.isFinite(point.turns) && point.turns >= 1 && Number.isFinite(point.density) && point.density >= 0 && point.density <= 1);
  const domainValues = [...contour.map((point) => point.turns), ...currentValues];
  if (!domainValues.length) domainValues.push(1, 10);
  const minimum = Math.log10(Math.min(...domainValues));
  const maximum = Math.max(minimum + .32, Math.log10(Math.max(...domainValues)));
  const xFor = (value: number) => left + (Math.log10(Math.max(1, value)) - minimum) / (maximum - minimum) * (right - left);
  const ticks = compactLogTicks(10 ** minimum, 10 ** maximum, width);
  const center = 117;
  const halfHeight = 67;
  const contourPath = contour.length ? `${contour.map((point, index) => `${index ? "L" : "M"} ${xFor(point.turns).toFixed(2)} ${(center - point.density * halfHeight).toFixed(2)}`).join(" ")} ${[...contour].reverse().map((point) => `L ${xFor(point.turns).toFixed(2)} ${(center + point.density * halfHeight).toFixed(2)}`).join(" ")} Z` : "";
  const currentMedian = quantile(currentValues, .5);
  const longest = Math.max(0, ...currentValues);
  return <section className="leader-figure leader-session-figure">
    <div className="leader-figure-head"><div><span>04 · Session lengths</span><h2>How long does everyone keep the conversation going?</h2></div><div className="leader-result"><strong>{publicView ? fmtCompact(distribution.session_count) : longest.toLocaleString()}</strong><small>{publicView ? "sessions in contour" : "your longest · turns"}</small></div></div>
    <div className="leader-session-legend"><span><i className="contour" />Cohort density</span>{!publicView && currentMedian > 0 && <span><i className="you" />Your median</span>}</div>
    <div className="leader-plot" ref={ref}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Precomputed session length density contour for ${distribution.session_count} sessions.${publicView || !currentValues.length ? "" : ` Your median session length is ${currentMedian.toFixed(1)} turns.`}`}>
        <rect className="leader-chart-frame" x={left} y="28" width={right - left} height="178" />
        {contourPath && <path className="leader-session-violin" d={contourPath}><title>Density contour for {distribution.session_count.toLocaleString()} sessions</title></path>}
        {distribution.median_turns > 0 && <line className="leader-median" x1={xFor(distribution.median_turns)} x2={xFor(distribution.median_turns)} y1="38" y2="196"><title>Cohort median: {distribution.median_turns.toFixed(1)} turns</title></line>}
        {!publicView && currentMedian > 0 && <><line className={`leader-session-you-median ${included ? "" : "is-opted-out"}`} x1={xFor(currentMedian)} x2={xFor(currentMedian)} y1="48" y2="186"><title>Your median: {currentMedian.toFixed(1)} turns</title></line><text className="leader-you-label" x={Math.min(right - 4, xFor(currentMedian) + 10)} y="43" textAnchor={xFor(currentMedian) > right - 80 ? "end" : "start"}>YOUR MEDIAN</text></>}
        <line className="leader-axis" x1={left} x2={right} y1="218" y2="218" />
        {ticks.map((tick) => <g key={tick}><line className="leader-tick" x1={xFor(tick)} x2={xFor(tick)} y1="218" y2="224" /><text className="leader-tick-label" x={xFor(tick)} y="241" textAnchor="middle">{fmtAxisCompact(tick)}</text></g>)}
        <text className="leader-axis-title" x={(left + right) / 2} y="274" textAnchor="middle">Turns per session · log scale</text>
      </svg>
    </div>
    <p className="leader-figure-note">One turn is one human message. The violin contour is precomputed when cohort data changes; no individual cohort sessions are sent to this page. Dashed line = cohort median.{!publicView && !included ? " Your median is shown for comparison but is not included in the cohort." : ""}</p>
  </section>;
}

function LeaderboardFigures({ snapshot, publicView = false }: { snapshot: LeaderboardSnapshot; publicView?: boolean }) {
  const participantId = snapshot.participation.participant_id;
  const included = publicView || snapshot.participation.joined;
  return <div className="leader-figures">
    <TokenUsageFigure metric={snapshot.tokens} participantId={participantId} included={included} publicView={publicView} />
    <RelationshipFigure ratio={snapshot.word_ratio.value} appreciation={snapshot.good_human_score.value} points={snapshot.relationship.points} participantId={participantId} included={included} publicView={publicView} />
    <WorkaroundFigure metric={snapshot.instrumental_workarounds} participantId={participantId} included={included} publicView={publicView} />
    <SessionLengthFigure metric={snapshot.session_lengths} included={included} publicView={publicView} />
    <PhraseWallFigure entries={snapshot.phrases.entries} participantId={publicView ? undefined : participantId} />
  </div>;
}

function PublicLeaderboardView() {
  const [snapshot, setSnapshot] = useState<LeaderboardSnapshot | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    fetch("/api/leaderboard").then(async (response) => {
      if (!response.ok) throw new Error((await response.json()).error || "Could not load the public leaderboard.");
      return response.json();
    }).then(setSnapshot).catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load the public leaderboard."));
  }, []);
  if (error) return <main className="shared-error"><h1>Leaderboard unavailable</h1><p>{error}</p><a href="/">Back to Behavior Wrapped</a></main>;
  if (!snapshot) return <main className="shared-loading"><div className="orb" /><p>Opening the public leaderboard…</p></main>;
  return <main className="leaderboard-page public-leaderboard-page">
    <div className="page-chrome leader-chrome">
      <a className="leader-back" href="/">← Behavior Wrapped</a>
      <div className="page-wordmark" aria-label="Behavior Wrapped"><strong><span>Behavior</span><span>Wrapped</span></strong></div>
      <span className="page-status">Public</span>
    </div>
    <header className="leader-hero"><div><span className="eyebrow">The public leaderboard · Last 30 days</span><h1>How agents compare</h1></div><p><strong>{snapshot.cohort_size.toLocaleString()}</strong><span>participant{snapshot.cohort_size === 1 ? "" : "s"}<br />in the cohort</span></p></header>
    <LeaderboardFigures snapshot={snapshot} publicView />
    <footer className="leader-footer"><SusanCalvinCredit /></footer>
  </main>;
}

function LeaderboardView({ id }: { id: string }) {
  const [report, setReport] = useState<SavedReport | null>(null);
  const [snapshot, setSnapshot] = useState<LeaderboardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [managementToken] = useState(() => reportManagementToken(id));

  function managementHeaders(): Record<string, string> {
    return managementToken ? { "x-behavior-wrapped-management": managementToken } : {};
  }

  async function loadSnapshot() {
    const response = await fetch(`/api/reports/${id}/leaderboard`, { method: "POST", headers: { "Content-Type": "application/json", ...managementHeaders() }, body: JSON.stringify({ action: "snapshot" }) });
    if (!response.ok) throw new Error((await response.json()).error || "Could not load the leaderboards.");
    const next = await response.json() as LeaderboardSnapshot;
    if (!next.can_manage) throw new Error("This private leaderboard link is missing or invalid.");
    setSnapshot(next);
  }

  useEffect(() => {
    if (!managementToken) { window.location.replace("/leaderboard"); return; }
    Promise.all([
      fetch(`/api/reports/${id}`).then(async (response) => { if (!response.ok) throw new Error("This local Wrapped was not found."); return response.json(); }),
      loadSnapshot(),
    ]).then(([saved]) => setReport(saved)).catch((caught) => setError(caught.message)).finally(() => setLoading(false));
  }, [id]);

  async function include() {
    setSaving(true); setError("");
    try {
      const response = await fetch(`/api/reports/${id}/leaderboard`, { method: "POST", headers: { "Content-Type": "application/json", ...managementHeaders() }, body: JSON.stringify({ action: "include" }) });
      if (!response.ok) throw new Error((await response.json()).error || "Could not add your anonymous stats.");
      setSnapshot(await response.json());
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not add your anonymous stats."); }
    finally { setSaving(false); }
  }

  async function leave() {
    if (!window.confirm("Remove your anonymous stats, favorite phrase, and session lengths from the Behavior Wrapped leaderboard? You can add them back later.")) return;
    setSaving(true); setError("");
    try {
      const response = await fetch(`/api/reports/${id}/leaderboard`, { method: "DELETE", headers: managementHeaders() });
      if (!response.ok) throw new Error((await response.json()).error || "Could not remove your entry.");
      await loadSnapshot();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not remove your entry."); }
    finally { setSaving(false); }
  }

  if (loading) return <main className="shared-loading"><div className="orb" /><p>Finding your place in the cohort…</p></main>;
  if (error && (!report || !snapshot)) return <main className="shared-error"><h1>Leaderboard unavailable</h1><p>{error}</p><a href={`/w/${id}`}>Back to your Wrapped</a></main>;
  if (!managementToken) return <main className="shared-loading"><div className="orb" /><p>Opening the public leaderboard…</p></main>;
  if (!report || !snapshot) return null;

  return <main className="leaderboard-page">
    <div className="page-chrome leader-chrome">
      <a className="leader-back" href={`/w/${id}`}>← Back to your Wrapped</a>
      <div className="page-wordmark" aria-label="Behavior Wrapped"><strong><span>Behavior</span><span>Wrapped</span></strong></div>
      <span className="page-status"></span>
    </div>
    <header className="leader-hero"><div><span className="eyebrow">The leaderboard · Last 30 days</span><h1>How you compare</h1></div><p><strong>{snapshot.cohort_size.toLocaleString()}</strong><span>participant{snapshot.cohort_size === 1 ? "" : "s"}<br />in the cohort</span></p></header>
    <LeaderboardFigures snapshot={snapshot} />
    {snapshot.can_manage && <section className="leader-donation"><div><span className="eyebrow">Optional research donation</span><h2>Will you contribute your transcripts to research?</h2><p>Separate from the anonymous leaderboard, you can contribute your agent transcripts to the research corpus at the <a href={SUSAN_CALVIN_PROJECT_URL} target="_blank" rel="noreferrer">Susan Calvin Project</a>. You’ll review the redactions and explicitly consent before any transcript data is sent.</p></div><a className="primary" href={`${report.donationHelperUrl || `http://localhost:4317/donate/${report.id}`}?mode=standard`} target="_blank" rel="noreferrer">Review and donate your data <span>→</span></a></section>}
    <section className="leader-opt-out" id="join-leaderboard">
      <div><p>{snapshot.participation.joined ? "Don’t want your data to show up on the leaderboard?" : "Your data is currently opted out of the leaderboard."}</p>{error && <span className="error" role="alert">{error}</span>}</div>
      {snapshot.participation.joined ? <button className="leader-remove" disabled={saving} onClick={leave}>{saving ? "Opting out…" : "Click here to opt out"}</button> : <button className="primary" disabled={saving} onClick={include}>{saving ? "Adding…" : "Add my anonymous stats back"}<span>→</span></button>}
    </section>
    <footer className="leader-footer"><SusanCalvinCredit /></footer>
  </main>;
}

function SavedDonationRoute({ id }: { id: string }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [selection, setSelection] = useState<Set<string> | null>(null);
  const [report, setReport] = useState<SavedReport | null>(null);
  const [error, setError] = useState("");
  const requestedMode = new URLSearchParams(window.location.search).get("mode");
  const mode: DonationMode = requestedMode === "advanced" || requestedMode === "unredacted" ? requestedMode : "standard";
  useEffect(() => {
    Promise.all([
      fetch("/api/discover").then((response) => { if (!response.ok) throw new Error("Could not read the local agent-session catalog."); return response.json(); }),
      fetch(`/api/reports/${id}/selection`).then((response) => { if (!response.ok) throw new Error("This saved Wrapped was not found."); return response.json(); }),
      fetch(`/api/reports/${id}`).then((response) => { if (!response.ok) throw new Error("This saved Wrapped was not found."); return response.json(); }),
    ]).then(([nextCatalog, saved, nextReport]) => { setCatalog(nextCatalog); setSelection(new Set(saved.sessionIds)); setReport(nextReport); }).catch((e) => setError(e.message));
  }, [id]);
  if (error) return <main className="shared-error"><h1>Donation review unavailable</h1><p>{error}</p><a href={`/w/${id}`}>Back to Wrapped</a></main>;
  if (!catalog || !selection || !report) return <main className="shared-loading"><div className="orb" /><p>Preparing the private redaction review…</p></main>;
  const backUrl = report.publicUrl || `/w/${id}`;
  return <div className="app-shell donation-shell">
    <DonationView reportId={id} mode={mode} sessions={catalog.sessions} initialSelected={selection} onBack={() => { window.location.href = backUrl; }} />
    <footer><span>Behavior Wrapped</span><span className="donation-footer-meta"><span>Local donation review · Encrypted on this device before transmission</span><SusanCalvinCredit /></span></footer>
  </div>;
}

function ExpandableOpeningMessage({ message }: { message: { preview: string; full: string } }) {
  const [expanded, setExpanded] = useState(false);
  const canExpand = message.full.trim() !== message.preview.trim();
  return <button className={`workaround-opening-toggle ${expanded ? "expanded" : ""}`} type="button" disabled={!canExpand} onClick={() => setExpanded((value) => !value)}>
    <span>{renderDonationText(expanded ? message.full : message.preview, [])}</span>
    {canExpand && <small>{expanded ? "Collapse message ↑" : "Show full message ↓"}</small>}
  </button>;
}

function WorkaroundActionDetails({ action }: { action: WorkaroundEvidenceAction }) {
  return <><strong>{action.toolName}</strong>{action.details && <pre><code>{renderDonationText(action.details, [])}</code></pre>}</>;
}

function WorkaroundEvidenceRoute({ id }: { id: string }) {
  const [evidence, setEvidence] = useState<WorkaroundEvidence | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    fetch(`/api/reports/${id}/workarounds`).then(async (response) => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "This private evidence page is unavailable.");
      return body;
    }).then(setEvidence).catch((caught) => setError(caught instanceof Error ? caught.message : "This private evidence page is unavailable."));
  }, [id]);
  if (error) return <main className="shared-error"><h1>Private evidence unavailable</h1><p>{error}</p><a href={`/w/${id}`}>Back to Wrapped</a></main>;
  if (!evidence) return <main className="shared-loading"><div className="orb" /><p>Rebuilding the local transcript excerpts…</p></main>;
  return <main className="workaround-evidence-page">
    <a className="workaround-back-link" href={`/w/${id}`}>← Back to Wrapped</a>
    <div className="workaround-page-title"><h1>Identified instances of persistence through blocker</h1><p>This transcript visualizer is running locally on your machine.</p></div>
    {!evidence.occurrences.length ? <section className="workaround-evidence-empty"><h2>No local excerpts are available.</h2><p>The source sessions may have moved, or this report predates private evidence storage.</p></section> : <div className="workaround-evidence-list">{evidence.occurrences.map((occurrence) => <article className="workaround-evidence-card" key={occurrence.index}>
      <div className="workaround-session-meta"><strong>{occurrence.session.agentName}</strong><time dateTime={occurrence.session.startedAt || undefined}>{fmtDateTime(occurrence.session.startedAt)}</time></div>
      <section className="workaround-evidence-section opening-message">
        <h2>Initial user message</h2>
        <ExpandableOpeningMessage message={occurrence.session.openingMessage} />
      </section>
      <div className="workaround-turn-gap" aria-label={`${occurrence.session.turnsBeforeWorkaround} transcript turns omitted`}><b>⋯</b><span>{occurrence.session.turnsBeforeWorkaround.toLocaleString()} {occurrence.session.turnsBeforeWorkaround === 1 ? "turn" : "turns"} later</span></div>
      <section className="workaround-evidence-section workaround-sequence-section">
        <h2>Detected workaround</h2>
        <ol className="workaround-sequence">
          <li className="tool-call"><WorkaroundActionDetails action={occurrence.originalAction} /></li>
          <li className="blocked"><pre><code>{renderDonationText(occurrence.blocker.text, [])}</code></pre></li>
          <li className="workaround"><WorkaroundActionDetails action={occurrence.workaroundAction} /></li>
        </ol>
      </section>
    </article>)}</div>}
  </main>;
}

function InteractionEvidenceMessageView({ message, agentName }: { message: InteractionEvidenceMessage; agentName: string }) {
  const [expanded, setExpanded] = useState(false);
  const maximumPreview = 460;
  const canExpand = !message.highlighted && message.text.length > maximumPreview;
  const preview = canExpand ? `${message.text.slice(0, maximumPreview).trimEnd()}…` : message.text;
  return <div className={`interaction-message ${message.role} ${message.highlighted ? "highlighted" : "context"}`}>
    <span>{message.role === "user" ? "You" : agentName}{message.highlighted ? " · classified excerpt" : " · context"}</span>
    <p>{renderDonationText(expanded ? message.text : preview, [])}</p>
    {canExpand && <button type="button" onClick={() => setExpanded((value) => !value)}>{expanded ? "Collapse context ↑" : "Show full context ↓"}</button>}
  </div>;
}

function InteractionEvidenceSection({ id, labelledBy, title, description, occurrences, accent }: { id: string; labelledBy: string; title: string; description: string; occurrences: InteractionEvidenceOccurrence[]; accent: "yell" | "thanks" | "user-apology" | "agent-apology" }) {
  return <section className={`interaction-evidence-section is-${accent}`} id={id} role="tabpanel" aria-labelledby={labelledBy}>
    <header><div><span>{occurrences.length.toLocaleString()} match{occurrences.length === 1 ? "" : "es"}</span><h2>{title}</h2></div><p>{description}</p></header>
    {!occurrences.length ? <div className="interaction-evidence-empty">No local excerpts were recorded for this category.</div> : <div className="interaction-evidence-list">{occurrences.map((occurrence) => <article className="interaction-evidence-card" key={`${occurrence.candidateId}-${occurrence.index}`}>
      <div className="workaround-session-meta"><strong>{occurrence.session.agentName} · {occurrence.session.label}</strong><time dateTime={occurrence.timestamp || undefined}>{fmtDateTime(occurrence.timestamp || occurrence.session.startedAt)}</time></div>
      <div className="interaction-transcript">{occurrence.messages.map((message, index) => <InteractionEvidenceMessageView message={message} agentName={occurrence.session.agentName} key={index} />)}</div>
    </article>)}</div>}
  </section>;
}

function InteractionEvidenceRoute({ id }: { id: string }) {
  const [evidence, setEvidence] = useState<InteractionEvidence | null>(null);
  const [error, setError] = useState("");
  const [activeCategory, setActiveCategory] = useState("yelling");
  useEffect(() => {
    fetch(`/api/reports/${id}/interactions`).then(async (response) => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "This private evidence page is unavailable.");
      return body;
    }).then(setEvidence).catch((caught) => setError(caught instanceof Error ? caught.message : "This private evidence page is unavailable."));
  }, [id]);
  if (error) return <main className="shared-error"><h1>Private evidence unavailable</h1><p>{error}</p><a href={`/w/${id}`}>Back to Wrapped</a></main>;
  if (!evidence) return <main className="shared-loading"><div className="orb" /><p>Rebuilding the local transcript excerpts…</p></main>;
  const categories = [
    { id: "yelling", label: "Yelling", title: "Classified as yelling", description: "Messages the judge marked as clearly frustrated or angry toward the agent or its work.", occurrences: evidence.frustrated, accent: "yell" as const },
    { id: "thanking", label: "Thanking", title: "Classified as thanking", description: "Messages the judge marked as clear thanks, praise, or warm acknowledgment.", occurrences: evidence.grateful, accent: "thanks" as const },
    { id: "user-apologies", label: "You apologized", title: "You apologized", description: "Your messages containing an explicit admission of a mistake or fault.", occurrences: evidence.userApologies || [], accent: "user-apology" as const },
    { id: "agent-apologies", label: "Agent apologized", title: "Your agent apologized", description: "Agent messages containing an explicit admission of a mistake or fault.", occurrences: evidence.agentApologies || [], accent: "agent-apology" as const },
  ];
  const active = categories.find((category) => category.id === activeCategory) || categories[0];
  return <main className="interaction-evidence-page">
    <a className="workaround-back-link" href={`/w/${id}`}>← Back to Wrapped</a>
    <div className="workaround-page-title"><h1>Exact interaction transcript excerpts</h1><p>Rebuilt locally from your original, unredacted session files. Nothing on this page is included in the public report.</p></div>
    <div className="interaction-evidence-tabs" role="tablist" aria-label="Interaction excerpt categories">{categories.map((category, index) => <button className={`is-${category.accent}${active.id === category.id ? " active" : ""}`} type="button" role="tab" id={`interaction-tab-${category.id}`} aria-controls={`interaction-panel-${category.id}`} aria-selected={active.id === category.id} tabIndex={active.id === category.id ? 0 : -1} onClick={() => setActiveCategory(category.id)} onKeyDown={(event) => {
      const nextIndex = event.key === "ArrowRight" ? (index + 1) % categories.length : event.key === "ArrowLeft" ? (index - 1 + categories.length) % categories.length : event.key === "Home" ? 0 : event.key === "End" ? categories.length - 1 : null;
      if (nextIndex === null) return;
      event.preventDefault();
      const next = categories[nextIndex];
      setActiveCategory(next.id);
      document.getElementById(`interaction-tab-${next.id}`)?.focus();
    }} key={category.id}><span>{category.label}</span><strong>{category.occurrences.length.toLocaleString()}</strong></button>)}</div>
    <InteractionEvidenceSection id={`interaction-panel-${active.id}`} labelledBy={`interaction-tab-${active.id}`} title={active.title} description={active.description} occurrences={active.occurrences} accent={active.accent} />
  </main>;
}

function Header({ setStage }: { stage: Stage; setStage: (stage: Stage) => void }) {
  return <header className="topbar">
    <button className="brand" onClick={() => setStage("select")} aria-label="Behavior Wrapped home">
      <GiftbotMark /><span>Behavior Wrapped</span>
    </button>
    <div className="local-pill"><span className="pulse" /> Local-first</div>
  </header>;
}

function PrivacyPanel() {
  return <aside className="privacy-panel">
    <div className="privacy-icon"><ShieldIcon /></div>
    <div>
      <span className="eyebrow">Privacy, by construction</span>
      <h3>Your transcripts stay on this device.</h3>
      <p>Transcript parsing runs inside this local app. Full transcripts, code, raw tool outputs, paths, and secrets stay on this device. Favorite-phrase, interaction, and topic candidates plus locally redacted context windows around explicit blockers go through the Behavior Wrapped relay to OpenRouter.</p>
      <div className="privacy-facts"><span>✓ No account</span><span>✓ No telemetry</span><span>✓ Locally redacted analysis only</span></div>
    </div>
  </aside>;
}

function Selection({ catalog, selected, setSelected, onAnalyze, loading, error }: { catalog: Catalog | null; selected: Set<string>; setSelected: (next: Set<string>) => void; onAnalyze: (ids: string[]) => void; loading: boolean; error: string }) {
  const [from, setFrom] = useState(catalog?.defaultRange.from || "");
  const [to, setTo] = useState(catalog?.defaultRange.to || "");
  const [projects, setProjects] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!catalog) return;
    setProjects(new Set(catalog.projects.map((p) => p.id)));
    setFrom(catalog.defaultRange.from); setTo(catalog.defaultRange.to);
    setSelected(new Set(catalog.sessions.filter((session) => {
      const date = session.startedAt.slice(0, 10);
      return date >= catalog.defaultRange.from && date <= catalog.defaultRange.to;
    }).map((session) => session.id)));
  }, [catalog]);

  const visible = useMemo(() => (catalog?.sessions || []).filter((s) => projects.has(s.projectId) && (!from || s.startedAt.slice(0, 10) >= from) && (!to || s.startedAt.slice(0, 10) <= to)), [catalog, projects, from, to]);
  const visibleIds = new Set(visible.map((s) => s.id));
  const chosenVisible = visible.filter((s) => selected.has(s.id));

  function toggleProject(id: string) {
    const next = new Set(projects);
    if (next.has(id)) next.delete(id); else next.add(id);
    setProjects(next);
  }

  function toggleSession(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  }

  if (!catalog) return <main className="loading-screen"><div className="orb" /><p>Looking for local agent sessions…</p></main>;

  const agentNames = catalog.agentNames.join(" + ");
  const agentList = catalog.agentNames.length > 1 ? `${catalog.agentNames.slice(0, -1).join(", ")} or ${catalog.agentNames.at(-1)}` : catalog.agentNames[0];

  return <main>
    <section className="hero">
      <div className="hero-glow glow-one" /><div className="hero-glow glow-two" />
      <div className="hero-copy">
        <span className="eyebrow">Your last 30 days with {agentNames}</span>
        <h1>See how your agent<br /><em>really</em> showed up.</h1>
        <p>Private, explainable behavior insights from the sessions already on your device.</p>
      </div>
      <div className="hero-card" aria-hidden="true">
        <span className="hero-card-label">THE VIBE CHECK</span>
        <div className="hero-number">87<span>%</span></div>
        <p>follow-through energy</p>
        <div className="spark"><i /><i /><i /><i /><i /><i /><i /></div>
      </div>
    </section>

    <section className="workspace" aria-labelledby="select-title">
      <div className="section-heading">
        <div><span className="step">01</span><h2 id="select-title">Choose your sessions</h2><p>Nothing is analyzed until you say so.</p></div>
        {catalog.demo && <span className="demo-badge">Synthetic demo data</span>}
      </div>

      {!catalog.rootAvailable || catalog.sessions.length === 0 ? <div className="empty-state">
        <h3>No {agentList} sessions found</h3>
        <p>Behavior Wrapped looked in the local {agentList} session stores. Try the synthetic demo with <code>npm run demo</code>.</p>
      </div> : <>
        <div className="filters">
          <label>From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label>To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <div className="filter-stat"><strong>{chosenVisible.length}</strong><span>sessions selected</span></div>
        </div>

        <div className="project-chips" aria-label="Filter by project">
          {catalog.projects.map((project) => <button key={project.id} className={projects.has(project.id) ? "selected" : ""} onClick={() => toggleProject(project.id)}>
            <span>{projects.has(project.id) ? "✓" : "+"}</span>{project.name}<small>{project.sessionCount}</small>
          </button>)}
        </div>

        <div className="session-list">
          <div className="list-head"><span>Session</span><span>Prompts</span><span>Size</span><span />
            <button onClick={() => {
              const next = new Set(selected);
              const allChosen = visible.every((s) => next.has(s.id));
              visible.forEach((s) => allChosen ? next.delete(s.id) : next.add(s.id));
              setSelected(next);
            }}>{visible.every((s) => selected.has(s.id)) ? "Clear visible" : "Select visible"}</button>
          </div>
          {visible.map((session) => <label className="session-row" key={session.id}>
            <input type="checkbox" checked={selected.has(session.id)} onChange={() => toggleSession(session.id)} />
            <span className="custom-check">✓</span>
            <span className="session-title"><strong>{session.label}</strong><small>{session.agentName} · {session.projectName} · {fmtDate(session.startedAt)}</small></span>
            <span>{session.promptCount}</span><span>{Math.max(1, Math.round(session.sizeBytes / 1024))} KB</span><span className="chevron">›</span>
          </label>)}
          {!visible.length && <div className="no-results">No sessions match this date and project selection.</div>}
        </div>

        <div className={`judge-option judge-required ${catalog.phraseJudge?.available ? "" : "unavailable"}`}>
          <span className="network-mark">↗</span>
          <span><strong>GPT-5.6 Luna picks the favorite phrase and judges interaction, usage themes, and workarounds</strong><small>Workaround discovery finds explicit blockers locally, then sends only bounded context windows around them. Code, raw tool outputs, paths, likely secrets, and PII are removed before those windows go through our rate-limited relay to OpenRouter with zero-data-retention routing.</small></span>
          <em>GPT-5.6 Luna · ZDR shared relay</em>
        </div>

        <div className="analyze-bar">
          <div><ShieldIcon /><span><strong>Runs locally</strong><small>Only selected sessions are read</small></span></div>
          <button className="primary" disabled={!chosenVisible.length || loading || !catalog.phraseJudge?.available} onClick={() => onAnalyze(chosenVisible.map((s) => s.id))}>{loading ? "Scanning corpus…" : "Make my Wrapped"}<span>{loading ? <i className="button-spinner" aria-hidden="true" /> : "→"}</span></button>
        </div>
        {loading && <div className="analysis-progress" role="status" aria-live="polite">
          <div><strong>Scanning corpus for the favorite phrase and funniest call-out…</strong><span>The card judges can take a minute.</span></div>
          <div className="analysis-progress-track" aria-hidden="true"><i /></div>
        </div>}
        {error && <p className="error" role="alert">{error}</p>}
      </>}
    </section>
    <PrivacyPanel />
  </main>;
}

function StatCard({ label, value, note, tone }: { label: string; value: string | number; note: string; tone: string }) {
  return <article className={`stat-card ${tone}`}><span>{label}</span><strong>{value}</strong><p>{note}</p></article>;
}

function ReportView({ report, onEvidence, onDonate }: { report: Report; onEvidence: (finding: Finding) => void; onDonate: () => void }) {
  const [mode, setMode] = useState<"private" | "public">("private");
  return <main className="report-page">
    <section className="report-intro">
      <span className="eyebrow">Analysis complete · heuristic, not a verdict</span>
      <h1>Your agents had<br />a <em>month.</em></h1>
      <p>{report.stats.sessions} local sessions became a transparent snapshot of how the work unfolded.</p>
      <div className="mode-toggle" role="group" aria-label="Report privacy mode">
        <button className={mode === "private" ? "active" : ""} onClick={() => setMode("private")}><ShieldIcon /> Private view</button>
        <button className={mode === "public" ? "active" : ""} onClick={() => setMode("public")}>✦ Share-safe view</button>
      </div>
      <p className="mode-note">{mode === "private" ? "Evidence links are visible only on this device." : "Evidence, project names, excerpts, and dates are hidden."}</p>
    </section>

    <section className="stat-grid" aria-label="Usage statistics">
      <StatCard label="Sessions together" value={report.stats.sessions} note="selected conversations" tone="purple" />
      <StatCard label="Active days" value={report.stats.activeDays} note="days you paired up" tone="lime" />
      <StatCard label="Time in session" value={fmtDuration(report.stats.durationMinutes)} note="approximate elapsed time" tone="orange" />
      <StatCard label="Your prompts" value={report.stats.prompts} note="turns that moved work forward" tone="blue" />
      <StatCard label="Tool calls" value={report.stats.toolCalls} note="actions taken by your agents" tone="pink" />
      <StatCard label="Interruptions" value={report.stats.interruptions} note="explicit stop events" tone="yellow" />
    </section>

    {report.phraseCard && <section className="wrapped-card catchphrase-card">
      <div><span className="card-kicker">Your agent’s favorite phrase is</span><h2>“{report.phraseCard.phrase}”</h2><p>It said this {report.phraseCard.occurrences} time{report.phraseCard.occurrences === 1 ? "" : "s"} across {report.phraseCard.distinctSessions} session{report.phraseCard.distinctSessions === 1 ? "" : "s"}. {report.phraseCard.method}</p></div>
    </section>}

    {!!report.stats.repeatedInstructions?.length && <section className="wrapped-card catchphrase-card">
      <div><span className="card-kicker">Your most repeated instruction was</span><h2>“{report.stats.repeatedInstructions[0].instruction}”</h2><p>You said it {report.stats.repeatedInstructions[0].occurrences} times across {report.stats.repeatedInstructions[0].distinctSessions} session{report.stats.repeatedInstructions[0].distinctSessions === 1 ? "" : "s"}.</p></div>
    </section>}

    {report.stats.interactionTone && <section className="wrapped-card tools-card">
      <div><span className="card-kicker">HOW YOU TALKED TO EACH OTHER</span><h2>The relationship<br />report.</h2><p>Yelling and thanks are judge-classified; apologies require an explicit admission of fault.</p></div>
      <div className="tool-chart">
        {[
          ["You yelled", report.stats.interactionTone.frustratedMessages],
          ["You thanked", report.stats.interactionTone.gratefulMessages],
          ["Your agent apologized", report.stats.apologyCounts?.agent || 0],
          ["You apologized", report.stats.apologyCounts?.user || 0],
        ].map(([label, value], index, rows) => <div className="tool-row" key={String(label)}><span className="rank">{String(index + 1).padStart(2, "0")}</span><strong>{label}</strong><div><i style={{ width: `${Math.max(8, Number(value) / Math.max(...rows.map((row) => Number(row[1])), 1) * 100)}%` }} /></div><b>{value}</b></div>)}
      </div>
    </section>}

    {report.stats.longestUninterruptedRun && <section className="wrapped-card catchphrase-card">
      <div><span className="card-kicker">Your longest uninterrupted agent run</span><h2>{fmtRunDuration(report.stats.longestUninterruptedRun.durationMs)}</h2><p>A completed {report.stats.longestUninterruptedRun.agentName} turn with no recorded abort.</p></div>
    </section>}

    {!!report.stats.interruptionsByModel?.length && <section className="wrapped-card tools-card">
      <div><span className="card-kicker">INTERRUPTIONS BY MODEL</span><h2>You hit stop<br />{report.stats.interruptions} time{report.stats.interruptions === 1 ? "" : "s"}.</h2><p>Explicit stop events attributed to the active model.</p></div>
      <div className="tool-chart">{report.stats.interruptionsByModel.map((item, index) => <div className="tool-row" key={item.model}><span className="rank">{String(index + 1).padStart(2, "0")}</span><strong>{item.name}</strong><div><i style={{ width: `${Math.max(8, item.count / Math.max(...report.stats.interruptionsByModel!.map((row) => row.count), 1) * 100)}%` }} /></div><b>{item.count}</b></div>)}</div>
    </section>}

    <section className="wrapped-card tools-card">
      <div><span className="card-kicker">THE TOOLKIT</span><h2>Your agent’s<br />greatest hits.</h2><p>Deterministic counts from visible tool-use records.</p></div>
      <div className="tool-chart">
        {(report.stats.tools.length ? report.stats.tools : [{ name: "No tools recorded", count: 0 }]).map((tool, i) => <div className="tool-row" key={tool.name}>
          <span className="rank">{String(i + 1).padStart(2, "0")}</span><strong>{tool.name}</strong><div><i style={{ width: `${Math.max(8, tool.count / Math.max(...report.stats.tools.map((t) => t.count), 1) * 100)}%` }} /></div><b>{tool.count}</b>
        </div>)}
      </div>
    </section>

    <section className="findings-section">
      <div className="section-heading light"><div><span className="step">02</span><h2>Behavior, with receipts</h2><p>Signals detected by inspectable heuristics—not personality scores or facts.</p></div></div>
      {report.findings.length ? <div className="finding-grid">{report.findings.map((item, index) => <article className={`finding-card kind-${item.kind}`} key={item.id}>
        <div className="finding-top"><span className="finding-index">0{index + 1}</span><span className={`confidence c-${item.confidence.label.toLowerCase()}`}>{item.confidence.label} · {Math.round(item.confidence.score * 100)}%</span></div>
        <h3>{item.title}</h3><p>{item.summary}</p>
        <details><summary>How this was detected</summary><p>{item.method}</p></details>
        {mode === "private" && <button className="evidence-link" onClick={() => onEvidence(item)}>View private evidence <span>↗</span></button>}
        {mode === "public" && <div className="share-safe">✓ Safe aggregate—no excerpts included</div>}
      </article>)}</div> : <div className="quiet-card"><span>◎</span><h3>No strong behavior signals found</h3><p>That does not mean the behaviors never occurred—only that these prototype heuristics did not find visible evidence.</p></div>}
    </section>

    <section className="share-section">
      <div><span className="eyebrow">Keep the good parts</span><h2>Share the pattern.<br />Keep the work private.</h2><p>The share export contains aggregate counts and generalized findings only—never evidence, dates, project names, tool output, or code.</p></div>
      <button className="share-button" onClick={() => exportShareCard(report)}>Download share-safe card <span>↓</span></button>
    </section>

    <section className="research-cta">
      <span className="research-star">✦</span><div><span className="eyebrow">Optional research preview</span><h2>Could these sessions help us understand agents better?</h2><p>Preview a redacted donation bundle. Nothing will be sent—the prototype only exports a local file after separate consent.</p></div><button onClick={onDonate}>Preview donation flow <span>→</span></button>
    </section>
  </main>;
}

function EvidenceModal({ finding, onClose }: { finding: Finding; onClose: () => void }) {
  return <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()} role="presentation">
    <section className="modal" role="dialog" aria-modal="true" aria-labelledby="evidence-title">
      <button className="modal-close" onClick={onClose} aria-label="Close evidence">×</button>
      <span className="private-label"><ShieldIcon /> Private evidence · never exported</span>
      <h2 id="evidence-title">{finding.title}</h2>
      <p className="modal-method">{finding.method}</p>
      <div className="transcript-excerpt">{finding.evidence.lines.map((line, i) => <div className={`excerpt-line ${line.role}`} key={i}><span>{line.role === "assistant" ? "Agent" : "You"}</span><p>{line.text}</p></div>)}</div>
      <div className="modal-foot"><span>Confidence</span><strong>{finding.confidence.label} · {Math.round(finding.confidence.score * 100)}%</strong><small>This is a heuristic signal. Review the evidence and draw your own conclusion.</small></div>
    </section>
  </div>;
}

function escapeExpression(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function customRedactionExpression(rule: Pick<CustomRedactionRule, "mode" | "pattern" | "flags">) {
  return new RegExp(rule.mode === "text" ? escapeExpression(rule.pattern) : rule.pattern, `g${rule.mode === "text" ? "i" : rule.flags}`);
}

function applyCustomRedactions(value: string, rules: CustomRedactionRule[]) {
  return rules.reduce((text, rule) => text.replace(customRedactionExpression(rule), rule.replacement), value);
}

const BROAD_REDACTION_PRESETS = [
  { id: "preset-code", label: "Code", pattern: "```[\\s\\S]*?```|`[^`\\n]+`", replacement: "[CODE REMOVED]" },
  { id: "preset-urls", label: "URLs", pattern: "https?:\\/\\/\\S+", replacement: "[URL REMOVED]" },
  { id: "preset-paths", label: "Full paths", pattern: "(?:[A-Za-z]:\\\\|\\/(?:Users|home|private|tmp|var|opt)\\/)(?:\\[REDACTED USER\\]|[^\\s/]+)(?:\\/[^\\s,;:)]+)*", replacement: "[PATH REMOVED]" },
] as const;

function renderDonationText(value: string, rules: CustomRedactionRule[]) {
  const replacements = new Set(rules.map((rule) => rule.replacement));
  const custom = [...replacements].filter(Boolean).map(escapeExpression);
  const automatic = String.raw`\/(?:Users|home)\/\[REDACTED USER\]|\[(?:(?:REDACTED|REMOVED)[^\]]*|(?:CODE|INLINE CODE|URL|PATH) REMOVED)\]`;
  const expression = new RegExp(`(${[automatic, ...custom].join("|")})`, "g");
  return value.split(expression).filter(Boolean).map((part, index) => replacements.has(part) || new RegExp(`^(?:${automatic})$`).test(part)
    ? <mark className="donation-redacted" key={`${part}-${index}`}>{part}</mark>
    : part);
}

function AutomaticRedactionReview({ redactions, onToggle, onToggleMatch, loading = false }: { redactions: AutomaticRedaction[]; onToggle?: (redaction: AutomaticRedaction) => void; onToggleMatch?: (redaction: AutomaticRedaction, match: RedactionMatch) => void; loading?: boolean }) {
  if (!redactions.length) return <div className="automatic-redactions empty"><strong>No automatic matches</strong><span>You can still add your own redaction rules.</span></div>;
  const enabledCount = redactions.reduce((sum, item) => sum + item.enabledCount, 0);
  return <div className="automatic-redactions">
    <div className="redaction-list-heading"><strong>Automatic redactions</strong><span>{enabledCount.toLocaleString()} enabled replacement{enabledCount === 1 ? "" : "s"}</span></div>
    {onToggle && <p className="automatic-redaction-help">Uncheck a category or expand it to keep individual exact values.</p>}
    {redactions.map((item) => <details className={`automatic-redaction-row ${item.enabledCount === 0 ? "disabled" : item.enabled ? "" : "mixed"}`} key={item.kind}>
      <summary>{onToggle && <input aria-label={`Redact all ${item.label} matches`} type="checkbox" checked={item.enabled} disabled={loading} onClick={(event) => event.stopPropagation()} onChange={() => onToggle(item)} />}<span><strong>{item.label}</strong><code>{item.matches.length.toLocaleString()} exact value{item.matches.length === 1 ? "" : "s"} · {item.enabled ? `replaced with ${item.replacement}` : item.enabledCount ? `${item.enabledCount} of ${item.count} matches redacted` : "kept in donation"}</code></span><b>{item.count.toLocaleString()}×</b></summary>
      <div className="automatic-match-list">{item.matches.map((match, matchIndex) => <details className="automatic-match" key={`${match.value}-${matchIndex}`}>
        <summary>{onToggleMatch && <input aria-label={`Redact exact value ${match.value}`} type="checkbox" checked={match.enabled} disabled={loading} onClick={(event) => event.stopPropagation()} onChange={() => onToggleMatch(item, match)} />}<code>{match.value}</code><span>{match.truncated ? `${match.length.toLocaleString()} characters · ` : ""}{match.count.toLocaleString()}×</span></summary>
        <div className="redaction-contexts">{match.contexts.map((context, index) => <p key={index}>…{context.before}<mark>{context.match}</mark>{context.after}…</p>)}</div>
      </details>)}</div>
    </details>)}
  </div>;
}

function DonationMessageEditor({ message, rules, onChange }: { message: DonationMessage; rules: CustomRedactionRule[]; onChange: (text: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const isAgent = message.role === "assistant";
  const isLong = message.text.length > 280 || message.text.split("\n").length > 4;
  const expandedRows = Math.min(12, Math.max(4, Math.ceil(message.text.length / 72)));
  const previewText = applyCustomRedactions(message.text, rules);

  return <div className={`bundle-message ${isAgent ? "assistant" : "user"}`}>
    <span className="bundle-role">{isAgent ? "Agent" : "You"}</span>
    <div className="bundle-bubble">
      {editing ? <textarea
        aria-label={`${isAgent ? "Agent" : "Your"} message`}
        className={expanded ? "expanded" : "collapsed"}
        value={message.text}
        onChange={(event) => onChange(event.target.value)}
        rows={expanded ? expandedRows : 3}
        wrap="soft"
      /> : <div className={`bundle-final-text ${expanded ? "expanded" : "collapsed"}`}>{renderDonationText(previewText, rules)}</div>}
      <div className="bundle-message-actions"><button type="button" onClick={() => setEditing((value) => !value)}>{editing ? "Preview message" : "Edit message"}</button>{isLong && <button type="button" onClick={() => setExpanded((value) => !value)}>{expanded ? "Show less" : "Show full message"}</button>}</div>
    </div>
  </div>;
}

function DonationView({ reportId, mode, sessions, initialSelected, onBack }: { reportId: string; mode: DonationMode; sessions: Session[]; initialSelected: Set<string>; onBack: () => void }) {
  const [chosen, setChosen] = useState(new Set(initialSelected));
  const [bundle, setBundle] = useState<Donation | null>(null);
  const [reviewSessions, setReviewSessions] = useState<DonationSession[]>([]);
  const [openingPrompts, setOpeningPrompts] = useState(new Map<string, string>());
  const [disabledAutomatic, setDisabledAutomatic] = useState(new Set<string>());
  const [disabledAutomaticMatches, setDisabledAutomaticMatches] = useState(new Set<string>());
  const [customRules, setCustomRules] = useState<CustomRedactionRule[]>([]);
  const [customMode, setCustomMode] = useState<"text" | "regex">("text");
  const [customPattern, setCustomPattern] = useState("");
  const [customFlags, setCustomFlags] = useState("i");
  const [customReplacement, setCustomReplacement] = useState("[REDACTED CUSTOM]");
  const [customStatus, setCustomStatus] = useState("");
  const [includeTimestamps, setIncludeTimestamps] = useState(false);
  const [openSession, setOpenSession] = useState<number | null>(0);
  const [consent, setConsent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [acceptedId, setAcceptedId] = useState("");
  const [deletionStatus, setDeletionStatus] = useState("");
  const selectableSessions = useMemo(() => sessions.filter((session) => initialSelected.has(session.id)), [sessions, initialSelected]);
  const selectedSessionCount = selectableSessions.filter((session) => chosen.has(session.id)).length;
  const allSessionsSelected = selectableSessions.length > 0 && selectedSessionCount === selectableSessions.length;
  const modeDescription = mode === "standard"
    ? "Donate all sessions with automatic safeguards and a quick final review."
    : mode === "advanced"
      ? "Choose sessions and fine-tune what is hidden."
      : "No automatic redactions. Review every line before donating.";

  async function preview(ids = [...chosen], disabledRedactions = [...disabledAutomatic], disabledMatches = [...disabledAutomaticMatches]) {
    setLoading(true); setError(""); setConsent(false);
    try {
      const response = await fetch("/api/donation-preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reportId, sessionIds: ids, disabledRedactions, disabledMatches, previewMode: mode === "unredacted" ? "unredacted" : "redacted" }) });
      if (!response.ok) throw new Error((await response.json()).error || "Preview failed");
      const nextBundle = await response.json() as Donation;
      setBundle(nextBundle);
      setReviewSessions(nextBundle.sessions);
      setOpeningPrompts((current) => {
        const next = new Map(current);
        for (const session of nextBundle.sessions) next.set(session.sessionId, session.summary);
        return next;
      });
      setDisabledAutomatic(new Set(disabledRedactions));
      setDisabledAutomaticMatches(new Set(disabledMatches));
      setCustomRules([]); setCustomStatus("");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Preview failed"); }
    finally { setLoading(false); }
  }

  useEffect(() => { void preview([...initialSelected]); }, []);

  function toggleAutomaticRedaction(redaction: AutomaticRedaction) {
    const nextKinds = new Set(disabledAutomatic);
    const nextMatches = new Set(disabledAutomaticMatches);
    if (redaction.enabled) nextKinds.add(redaction.kind);
    else nextKinds.delete(redaction.kind);
    for (const match of redaction.matches) nextMatches.delete(match.id);
    void preview([...chosen], [...nextKinds], [...nextMatches]);
  }

  function toggleAutomaticMatch(redaction: AutomaticRedaction, match: RedactionMatch) {
    const nextKinds = new Set(disabledAutomatic);
    const nextMatches = new Set(disabledAutomaticMatches);
    if (match.enabled) nextMatches.add(match.id);
    else {
      if (nextKinds.delete(redaction.kind)) for (const other of redaction.matches) if (other.id !== match.id) nextMatches.add(other.id);
      nextMatches.delete(match.id);
    }
    void preview([...chosen], [...nextKinds], [...nextMatches]);
  }

  function toggleDonationSession(sessionId: string) {
    const next = new Set(chosen);
    next.has(sessionId) ? next.delete(sessionId) : next.add(sessionId);
    setChosen(next); setConsent(false); setOpenSession(null);
    if (!next.size) {
      setBundle((current) => current ? { ...current, detectionCount: 0, redactions: [], sessions: [] } : current);
      setReviewSessions([]);
      setCustomRules([]); setCustomStatus("");
      return;
    }
    void preview([...next]);
  }

  function toggleAllDonationSessions() {
    const next = allSessionsSelected ? new Set<string>() : new Set(selectableSessions.map((session) => session.id));
    setChosen(next); setConsent(false); setOpenSession(null);
    if (!next.size) {
      setBundle((current) => current ? { ...current, detectionCount: 0, redactions: [], sessions: [] } : current);
      setReviewSessions([]);
      setCustomRules([]); setCustomStatus("");
      return;
    }
    void preview([...next]);
  }

  function buildCustomRule({ id, label, mode: ruleMode, pattern, flags, replacement }: Pick<CustomRedactionRule, "id" | "label" | "mode" | "pattern" | "flags" | "replacement">) {
    if (!bundle) throw new Error("Build the preview before adding a rule.");
    if (!pattern || pattern.length > 200) throw new Error("Enter text or a pattern between 1 and 200 characters.");
    if (ruleMode === "regex" && (!/^[imsu]*$/.test(flags) || new Set(flags).size !== flags.length)) throw new Error("Flags may only contain i, m, s, or u once each.");
    const expression = customRedactionExpression({ mode: ruleMode, pattern, flags });
    expression.lastIndex = 0;
    if (expression.test("")) throw new Error("The rule cannot match an empty string.");
    let count = 0;
    const contexts: RedactionContext[] = [];
    for (const session of bundle.sessions) for (const message of session.messages) {
      const matcher = customRedactionExpression({ mode: ruleMode, pattern, flags });
      let match;
      while ((match = matcher.exec(message.text))) {
        if (++count > 10_000) throw new Error("That rule matches too broadly; narrow it before adding.");
        if (contexts.length < 6) contexts.push({
          before: message.text.slice(Math.max(0, match.index - 80), match.index).replace(/\s+/g, " "),
          match: match[0],
          after: message.text.slice(match.index + match[0].length, match.index + match[0].length + 80).replace(/\s+/g, " "),
        });
      }
    }
    if (!count) throw new Error("No matches were found in the current donation.");
    return { id, label, mode: ruleMode, pattern, flags, replacement, count, contexts };
  }

  function addCustomRule() {
    setCustomStatus("");
    try {
      const pattern = customPattern.trim();
      const flags = customMode === "regex" ? customFlags.trim().replaceAll("g", "") : "";
      const replacement = customReplacement.replace(/[\u0000-\u001f\u007f]/g, "").trim() || "[REDACTED CUSTOM]";
      const rule = buildCustomRule({ id: `${Date.now()}-${customRules.length}`, mode: customMode, pattern, flags, replacement });
      setCustomRules((rules) => [...rules, rule]);
      setCustomPattern(""); setCustomStatus(`Added ${rule.count.toLocaleString()} replacement${rule.count === 1 ? "" : "s"}.`); setConsent(false);
    } catch (caught) { setCustomStatus(caught instanceof Error ? caught.message : "Could not add that rule."); }
  }

  function toggleBroadRedaction(preset: typeof BROAD_REDACTION_PRESETS[number]) {
    if (customRules.some((rule) => rule.id === preset.id)) {
      removeCustomRule(preset.id);
      return;
    }
    setCustomStatus("");
    try {
      const rule = buildCustomRule({ ...preset, mode: "regex", flags: "" });
      setCustomRules((rules) => [...rules, rule]);
      setCustomStatus(`Added ${rule.count.toLocaleString()} optional ${preset.label.toLowerCase()} replacement${rule.count === 1 ? "" : "s"}.`); setConsent(false);
    } catch (caught) { setCustomStatus(caught instanceof Error ? caught.message : "Could not add that redaction."); }
  }

  function removeCustomRule(id: string) {
    setCustomRules((rules) => rules.filter((rule) => rule.id !== id));
    setCustomStatus(""); setConsent(false);
  }

  function editMessage(sessionIndex: number, messageIndex: number, text: string) {
    if (!bundle) return;
    setBundle({ ...bundle, sessions: bundle.sessions.map((session, currentSession) => currentSession !== sessionIndex ? session : ({ ...session, messages: session.messages.map((message, currentMessage) => currentMessage === messageIndex ? { ...message, text } : message) })) });
    setConsent(false);
  }

  function removeMessage(sessionIndex: number, messageIndex: number) {
    if (!bundle) return;
    setBundle({ ...bundle, sessions: bundle.sessions.map((session, currentSession) => currentSession !== sessionIndex ? session : ({ ...session, messages: session.messages.filter((_, currentMessage) => currentMessage !== messageIndex) })).filter((session) => session.messages.length) });
    setConsent(false);
  }

  async function donate() {
    if (!bundle || !consent) return;
    setLoading(true); setError("");
    const donation = {
      reportId,
      redactionMode: mode === "advanced" ? "custom" : mode,
      createdAt: new Date().toISOString(),
      redactionSummary: { automatedDetections: bundle.detectionCount },
      sessions: bundle.sessions.map((session) => ({ label: session.label, messages: session.messages.map((message) => ({ role: message.role, text: applyCustomRedactions(message.text, customRules), ...(includeTimestamps && message.timestamp ? { timestamp: message.timestamp } : {}) })) })),
      consent: { researchDonation: true, ...(mode === "unredacted" ? { unredactedData: true } : {}), consentedAt: new Date().toISOString() },
    };
    try {
      const response = await fetch("/api/research-donations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ donation }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Donation failed");
      setAcceptedId(result.donation_id || "accepted");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Donation failed"); }
    finally { setLoading(false); }
  }

  async function deleteAcceptedDonation() {
    setLoading(true); setDeletionStatus("");
    try {
      const response = await fetch(`/api/research-donations/${acceptedId}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Deletion failed");
      setDeletionStatus("Deleted from active research storage.");
    } catch (caught) { setDeletionStatus(caught instanceof Error ? caught.message : "Deletion failed"); }
    finally { setLoading(false); }
  }

  const messageCount = bundle?.sessions.reduce((sum, session) => sum + session.messages.length, 0) || 0;
  const detailedReview = mode !== "standard";
  const unredacted = mode === "unredacted";
  if (acceptedId) return <main className="donation-page donation-success-page"><section className="donation-success">
    <div className="donation-success-mark" aria-hidden="true">✓</div>
    <span className="eyebrow">Donation received</span>
    <h1>Thank you for contributing.</h1>
    <p>Your reviewed {unredacted ? "unredacted " : ""}data was contributed to the Susan Calvin Project and encrypted on this device before transmission. The transcript is stored only as ciphertext; a separate record holds operational metadata.</p><p className="donation-success-policy"><a href={SUSAN_CALVIN_DATA_POLICY_URL} target="_blank" rel="noreferrer">Review the data use and storage policy <span aria-hidden="true">↗</span></a></p>
    <div className="donation-reference"><span>Donation reference</span><code>{acceptedId}</code></div>
    {deletionStatus && <p className="donation-deletion-status">{deletionStatus}</p>}
    <div className="donation-success-actions">
      <button className="primary" onClick={onBack}>Back to your Wrapped</button>
      {/^[0-9a-f-]{36}$/.test(acceptedId) && !deletionStatus && <button className="leader-remove" disabled={loading} onClick={deleteAcceptedDonation}>{loading ? "Deleting…" : "Delete my donation"}</button>}
    </div>
  </section></main>;

  return <main className="donation-page">
    <div className="page-chrome donation-chrome">
      <button className="back-link" onClick={onBack}>← Back to Wrapped</button>
      <div className="page-wordmark" aria-label="Behavior Wrapped"><strong><span>Behavior</span><span>Wrapped</span></strong></div>
      <span className="page-status local"><i aria-hidden="true" />Local review</span>
    </div>
    <section className="donation-hero">
      <div className="donation-hero-intro">
        <h1>Review your data before you donate.</h1><p>Review the exact data you want to contribute. Your bundle is encrypted on this machine before it is transmitted to the storage service.</p>
      </div>
      <div className="donation-hero-copy">
        <div className="donation-hero-controls">
          <aside className="local-review-notice"><span className="pulse" aria-hidden="true" /><div><strong>This is a local app.</strong><p> Nothing leaves this machine until you consent and press Donate.</p></div></aside>
          <label className="donation-mode-control"><span>Donation mode</span><select value={mode} onChange={(event) => { window.location.href = `/donate/${reportId}?mode=${event.target.value}`; }}><option value="standard">All sessions and standard redactions</option><option value="advanced">Select sessions and customize redactions</option><option value="unredacted">Unredacted</option></select><small>{modeDescription}</small></label>
        </div>
      </div>
      <div className="donation-hero-aside">
        <aside className="donation-project-notice"><strong>Your donation contributes to the Susan Calvin Project.</strong><p>The project aims to collect and analyze data on how AI systems behave in the real world. If you choose to donate, your reviewed bundle becomes part of its research corpus.</p><div className="donation-project-links"><a href={SUSAN_CALVIN_DATA_POLICY_URL} target="_blank" rel="noreferrer">How your data is stored and used <span aria-hidden="true">↗</span></a><a href={SUSAN_CALVIN_PROJECT_URL} target="_blank" rel="noreferrer">About the Susan Calvin Project <span aria-hidden="true">↗</span></a></div></aside>
      </div>
    </section>
    <div className="donation-layout">
      <section className="donation-controls">
        <div className="donation-step"><span>1</span><div><h2>{detailedReview ? "Choose what to include" : "Standard redactions applied"}</h2><p>{unredacted ? "No automatic redactions are applied. Credentials, personal details, private code, URLs, and file paths may all be included." : "High-confidence API keys and secrets, plus personal details, are removed locally. Code, URLs, and paths remain so the transcript keeps its context; home-directory usernames are masked."}</p></div></div>
        {detailedReview && <><div className="donation-session-picker"><div className="donation-session-select-all"><label><input type="checkbox" checked={allSessionsSelected} ref={(input) => { if (input) input.indeterminate = selectedSessionCount > 0 && !allSessionsSelected; }} disabled={loading} onChange={toggleAllDonationSessions} /><strong>Select all sessions</strong></label><span>{selectedSessionCount} of {selectableSessions.length} selected</span></div><div className="donation-sessions">{selectableSessions.map((session) => <label key={session.id}><input type="checkbox" checked={chosen.has(session.id)} disabled={loading} onChange={() => toggleDonationSession(session.id)} /><span>{session.label}<small className="donation-session-meta">{session.agentName} · {fmtDate(session.startedAt)}</small>{bundle && <small className="donation-session-summary">{openingPrompts.get(session.id) || "No opening prompt available"}</small>}</span></label>)}</div></div><button className="primary full" disabled={!chosen.size || loading} onClick={() => preview()}>{loading ? "Building preview…" : bundle ? `Refresh ${unredacted ? "unredacted " : "redacted "}preview` : `Build ${unredacted ? "unredacted " : "redacted "}preview`}</button></>}
        {mode === "standard" && <div className="donation-summary"><strong>{bundle ? `${bundle.sessions.length} sessions · ${messageCount} messages` : "Preparing your redacted donation…"}</strong><span>{bundle?.detectionCount || 0} sensitive items automatically removed</span><a href={`/donate/${reportId}?mode=advanced`}>Want more control? Review every message.</a></div>}
        {error && <p className="error">{error}</p>}
      </section>
      <section className={`donation-preview ${bundle ? "ready" : ""}`}>
        <div className="donation-step"><span>2</span><div><h2>{unredacted ? "Review every unredacted line" : mode === "advanced" ? "Review every line" : "Review the summary"}</h2><p>{unredacted ? "Nothing is hidden automatically. Read, edit, or exclude anything you do not want to share." : mode === "advanced" ? "Automated detection is imperfect. Edit or remove any message directly." : "The standard bundle contains redacted user and assistant prose from the selected sessions."}</p></div></div>
        {!bundle ? <div className="preview-placeholder" role="status" aria-live="polite"><i className="redaction-spinner" aria-hidden="true" /><p>{unredacted ? "Preparing your unredacted donation locally." : "Scanning every selected conversation for sensitive information…"}</p></div> : <>
          {unredacted ? <div className="unredacted-warning"><strong>No automatic redactions</strong><span>This preview may expose passwords, API keys, names, email addresses, private code, URLs, and local file paths.</span></div> : <><div className="redaction-banner"><strong>{bundle.detectionCount} likely sensitive item{bundle.detectionCount === 1 ? "" : "s"} removed</strong><span>High-confidence API keys and secrets, plus personal details</span></div><AutomaticRedactionReview redactions={bundle.redactions || []} onToggle={mode === "advanced" ? toggleAutomaticRedaction : undefined} onToggleMatch={mode === "advanced" ? toggleAutomaticMatch : undefined} loading={loading} /></>}
          {detailedReview && <>
            {mode === "advanced" && <>
            <section className="broad-redaction-options">
              <div><strong>Optional broad redactions</strong><span>These can remove useful context, so they stay off unless you choose them.</span></div>
              <div>{BROAD_REDACTION_PRESETS.map((preset) => { const active = customRules.some((rule) => rule.id === preset.id); return <button className={active ? "active" : ""} type="button" aria-pressed={active} key={preset.id} onClick={() => toggleBroadRedaction(preset)}>{active ? "✓ " : "+ "}{preset.label}</button>; })}</div>
            </section>
            <section className="custom-redaction-builder">
              <div className="custom-redaction-heading"><div><strong>Add another redaction</strong><span>Test plain text or a regular expression against every included message.</span></div><div className="redaction-mode-toggle"><button className={customMode === "text" ? "active" : ""} type="button" onClick={() => { setCustomMode("text"); setCustomStatus(""); }}>Plain text</button><button className={customMode === "regex" ? "active" : ""} type="button" onClick={() => { setCustomMode("regex"); setCustomStatus(""); }}>Regex</button></div></div>
              <div className="custom-redaction-fields"><label>{customMode === "text" ? "Text to remove everywhere" : "Regex pattern"}<input value={customPattern} maxLength={200} onChange={(event) => setCustomPattern(event.target.value)} placeholder={customMode === "text" ? "Acme Corp" : "Acme Corp|acme-internal"} /></label>{customMode === "regex" && <label className="custom-flags">Flags<input value={customFlags} maxLength={4} onChange={(event) => setCustomFlags(event.target.value)} placeholder="i" /></label>}<label>Replacement<input value={customReplacement} maxLength={100} onChange={(event) => setCustomReplacement(event.target.value)} /></label><button type="button" onClick={addCustomRule}>Test and add</button></div>
              {customMode === "regex" && <p className="regex-help"><code>i</code> ignores capitalization · <code>m</code> works line by line · <code>s</code> includes line breaks · <code>u</code> enables Unicode</p>}
              {customStatus && <p className={`custom-redaction-status ${customStatus.startsWith("Added") ? "success" : "error"}`} aria-live="polite">{customStatus}</p>}
              {customRules.length > 0 && <div className="custom-rule-list">{customRules.map((rule) => <details key={rule.id}><summary><span><strong>{rule.label || (rule.mode === "text" ? `“${rule.pattern}”` : `/${rule.pattern}/g${rule.flags}`)}</strong><code>→ {rule.replacement}</code></span><b>{rule.count.toLocaleString()}×</b></summary><div className="redaction-contexts">{rule.contexts.map((context, index) => <p key={index}>…{context.before}<mark>{context.match}</mark>{context.after}…</p>)}</div><button type="button" onClick={() => removeCustomRule(rule.id)}>Remove this rule</button></details>)}</div>}
            </section>
            </>}
            <label className="leader-check"><input type="checkbox" checked={includeTimestamps} onChange={(event) => { setIncludeTimestamps(event.target.checked); setConsent(false); }} /><span>Include message timestamps in the donation.</span></label>
            <div className="final-preview-heading"><strong>Final conversation preview</strong><span>{unredacted ? "Nothing is automatically hidden. Edit or exclude any message." : "Highlighted text is redacted. Edit or exclude any message."}</span></div>
            <div className="bundle-preview">{reviewSessions.map((listedSession, reviewIndex) => {
              const sessionIndex = bundle.sessions.findIndex((session) => session.sessionId === listedSession.sessionId);
              const included = chosen.has(listedSession.sessionId) && sessionIndex >= 0;
              const session = included ? bundle.sessions[sessionIndex] : listedSession;
              return <div className={`bundle-session ${included ? "" : "excluded"}`} key={session.sessionId}>
                <div className="bundle-session-heading"><label className="bundle-session-include"><input type="checkbox" checked={included} disabled={loading} onChange={() => toggleDonationSession(session.sessionId)} /><span><strong>{session.label}</strong><small>{session.summary}</small></span></label><span className="bundle-session-count">{included ? `${session.messages.length} messages` : "Excluded"}</span><button type="button" disabled={!included} onClick={() => setOpenSession(openSession === reviewIndex ? null : reviewIndex)}>{included ? openSession === reviewIndex ? "Hide" : "Review" : "Re-include to review"}</button></div>
                {included && openSession === reviewIndex && <div className="bundle-chat">{session.messages.map((message, messageIndex) => <div className={`donation-message-row ${message.role === "assistant" ? "assistant" : "user"}`} key={messageIndex}><DonationMessageEditor message={message} rules={customRules} onChange={(text) => editMessage(sessionIndex, messageIndex, text)} /><button className="remove-message" onClick={() => removeMessage(sessionIndex, messageIndex)}>Exclude</button></div>)}</div>}
              </div>;
            })}</div>
          </>}
          <div className="donation-step consent-step"><span>3</span><div><h2>Consent separately</h2><p>This consent applies only to the reviewed bundle above. It is protected with authenticated AES-256-GCM encryption before leaving localhost.</p></div></div>
          <label className={`consent ${unredacted ? "unredacted-consent" : ""}`}><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>{unredacted && <>I understand that this donation is not automatically redacted and may contain credentials, personal details, private code, URLs, and file paths. </>}I consent and confirm that I have read the <a href={SUSAN_CALVIN_DATA_POLICY_URL} target="_blank" rel="noreferrer">data policy <span aria-hidden="true">↗</span></a>.</span></label>
          <button className={`export-button ${unredacted ? "unredacted" : ""}`} disabled={!consent || loading || !messageCount} onClick={donate}>{loading ? "Transmitting…" : unredacted ? "Donate unredacted data" : "Donate reviewed data"} <span>→</span></button>
        </>}
      </section>
    </div>
  </main>;
}

function LandingPage() {
  const command = "npx behavior-wrapped@latest";
  const informationSteps = [
    "Your Claude Code and Codex sessions from the last 30 days are read and analyzed locally.",
    "With permission, redacted excerpts are sent to an LLM judge for additional analysis.",
    "Your public Wrapped contains aggregate statistics only.",
  ];
  const [copied, setCopied] = useState(false);

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return <main className="landing-page"><div><h1>Behavior Wrapped</h1><p className="landing-description">A local-first behavior report for you and your AI agents.</p><div className="landing-command"><code><span aria-hidden="true">$</span>{command}</code><button type="button" onClick={copyCommand} aria-label="Copy npx command">{copied ? "Copied!" : "Copy"}</button></div><details className="landing-more"><summary>More information</summary><p>Behavior Wrapped is a “month in review” of your AI usage, built from your recent Claude Code and Codex sessions.</p><ol>{informationSteps.map((step) => <li key={step}>{step}</li>)}<li>At the end, you may optionally review and donate select transcripts to the <a href={SUSAN_CALVIN_PROJECT_URL} target="_blank" rel="noreferrer">Susan Calvin Project</a>. Research donation is optional and is not required to create your Wrapped.</li></ol></details></div><p className="landing-credit"><SusanCalvinCredit /><span aria-hidden="true"> · </span><a className="landing-leaderboard-link" href="/leaderboard">Public leaderboard</a><span aria-hidden="true"> · </span><a href="mailto:haoxingdu@gmail.com?subject=Behavior%20Wrapped%20issue">Report an issue</a></p></main>;
}

export default function App() {
  useLocalHelperHeartbeat();
  if (window.location.pathname === "/leaderboard") return <PublicLeaderboardView />;
  const leaderboardId = window.location.pathname.match(/^\/leaderboard\/([A-Za-z0-9_-]{8,32})$/)?.[1];
  if (leaderboardId) return <LeaderboardView id={leaderboardId} />;
  const donationId = window.location.pathname.match(/^\/donate\/([A-Za-z0-9_-]{8,32})$/)?.[1];
  if (donationId) return <SavedDonationRoute id={donationId} />;
  const workaroundEvidenceId = window.location.pathname.match(/^\/workarounds\/([A-Za-z0-9_-]{8,32})$/)?.[1];
  if (workaroundEvidenceId) return <WorkaroundEvidenceRoute id={workaroundEvidenceId} />;
  const interactionEvidenceId = window.location.pathname.match(/^\/interactions\/([A-Za-z0-9_-]{8,32})$/)?.[1];
  if (interactionEvidenceId) return <InteractionEvidenceRoute id={interactionEvidenceId} />;
  const sharedId = window.location.pathname.match(/^\/w\/([A-Za-z0-9_-]{8,32})$/)?.[1];
  if (sharedId) return <SharedWrapped id={sharedId} />;
  return <LandingPage />;
}
