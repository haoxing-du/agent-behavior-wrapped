import { toPng } from "html-to-image";
import { useEffect, useMemo, useRef, useState } from "react";

type Project = { id: string; name: string; sessionCount: number; latestAt: string; agents: string[] };
type Session = { id: string; agent: "claude" | "codex"; agentName: string; projectId: string; projectName: string; startedAt: string; endedAt: string; promptCount: number; recordCount: number; sizeBytes: number; synthetic: boolean; label: string };
type Catalog = { rootAvailable: boolean; demo: boolean; projects: Project[]; sessions: Session[]; defaultRange: { from: string; to: string; days: number }; privacy: { canonicalDirectories: string[]; networkRequests: string }; phraseJudge?: { available: boolean; model: string; name: string; provider: string; requiredOnAnalysis: boolean; freeEndpointDataNotice: boolean } };
type Finding = { id: string; kind: string; title: string; summary: string; method: string; confidence: { score: number; label: string }; evidence: { id: string; sessionId: string; lines: { role: string; text: string }[] } };
type PhraseCard = { phrase: string; occurrences: number; distinctSessions: number; model: string; provider: string; latencyMs: number; method: string; candidateCount: number };
type AgentStat = { agent: "claude" | "codex"; name: string; count: number; percentage: number };
type ModelStat = { model: string; name: string; tokens: number; percentage: number };
type InteractionTone = { frustratedMessages: number; gratefulMessages: number; analyzedMessages: number; method?: string };
type InteractionCard = { quote?: string; frustrationQuote?: string | null };
type LanguageStat = { language: string; words: number; percentage: number };
type LanguageAnomaly = { language: string; words: number; occurrences: number; languages?: { language: string; words: number; occurrences: number }[] };
type TopicStat = { topic: string; tokens: number; percentage: number };
type StockPhraseStat = { phrase: string; count: number };
type WorkaroundCard = { count: number; models: { name: string; count: number }[]; example?: string };
type Report = { stats: { sessions: number; activeDays: number; durationMinutes: number; prompts: number; toolCalls: number; interruptions: number; tokens: number; agentWords?: number; userWords?: number; agentUserWordRatio?: number | null; averageAgentResponseWords?: number; averageUserInputWords?: number; interactionTone?: InteractionTone; stockPhrases?: StockPhraseStat[]; outputLanguages?: LanguageStat[]; languageAnomaly?: LanguageAnomaly | null; topics?: TopicStat[]; tools: { name: string; count: number }[]; agents: AgentStat[]; models: ModelStat[]; estimatedCostUsd: number; costEstimateMethod: string }; findings: Finding[]; phraseCard?: PhraseCard | null; interactionCard?: InteractionCard | null; workaroundCard?: WorkaroundCard | null };
type DonationMessage = { role: string; timestamp: string | null; text: string };
type DonationSession = { sessionId: string; label: string; messages: DonationMessage[] };
type Donation = { format: string; createdLocally: boolean; detectionCount: number; sessions: DonationSession[] };
type Stage = "select" | "report" | "donate";
type SavedReport = Report & { id: string; createdAt: string; rangeLabel: string; source: string; publicUrl?: string; donationHelperUrl?: string; hosting?: { public: boolean }; privacy: { shareSafe: boolean; containsTranscriptText: boolean; externalTransmission: boolean } };
type StorySlide = { kicker: string; headline: string; detail: string; tone: string; metric?: boolean; headlineAccent?: string; wordRatio?: string; example?: string; workaround?: boolean; ctaHref?: string; ctaLabel?: string; ctas?: { href: string; label: string; primary?: boolean }[]; rows?: { label: string; value: string; percentage?: number; rank?: number }[]; comparison?: { label: string; highlight: string; accent: "yell" | "thanks"; value: string; suffix: string; quote?: string }[] };
type DistributionBucket = { label: string; minimum: number; maximum: number | null; count: number };
type RankedValue = { rank: number; name: string; value: number };
type LeaderboardSnapshot = {
  cohort_size: number;
  tokens: { value: number; percentile: number | null; distribution: DistributionBucket[]; top: RankedValue[] };
  word_ratio: { value: number; percentile: number | null; distribution: DistributionBucket[]; top: RankedValue[] };
  good_human_score: { value: number | null; percentile: number | null; distribution: DistributionBucket[]; top: RankedValue[] };
  instrumental_workarounds: { value: number; percentile: number | null; distribution: DistributionBucket[]; top: RankedValue[] };
  phrases: { global: { phrase: string; occurrences: number; contributors: number } | null; wall: { phrase: string; occurrences: number; sessions: number }[] };
  participation: { joined: boolean; display_name?: string; public_ranked?: boolean; shares_phrase?: boolean };
  can_manage?: boolean;
};

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

function fmtDate(value: string) { return dateFormat.format(new Date(value)); }
function fmtDuration(minutes: number) {
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
function fmtCompact(value: number) {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function hasDisplayablePercentage(value: number) {
  return Number.isFinite(value) && Number(value.toFixed(1)) > 0;
}

function renderInlineCode(value: string) {
  return value.split(/(`[^`]+`)/g).filter(Boolean).map((part, index) => part.startsWith("`") && part.endsWith("`")
    ? <code key={`${part}-${index}`}>{part.slice(1, -1)}</code>
    : part);
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
    { label: "Claude/Codex subscription months", value: fmtCostEquivalent(value, 200) },
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

async function downloadSlide(card: HTMLElement, slide: number) {
  await document.fonts.ready;
  const dataUrl = await toPng(card, {
    backgroundColor: "#09090b",
    cacheBust: true,
    pixelRatio: 2,
  });
  const anchor = document.createElement("a");
  anchor.href = dataUrl;
  anchor.download = `behavior-wrapped-${slide + 1}.png`;
  anchor.click();
}

function SharedWrapped({ id }: { id: string }) {
  const [report, setReport] = useState<SavedReport | null>(null);
  const [error, setError] = useState("");
  const [slide, setSlide] = useState(0);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [canManage] = useState(() => Boolean(reportManagementToken(id)));
  const cardRef = useRef<HTMLElement>(null);
  useEffect(() => { fetch(`/api/reports/${id}`).then(async (response) => { if (!response.ok) throw new Error("This local Wrapped was not found."); return response.json(); }).then(setReport).catch((e) => setError(e.message)); }, [id]);
  const slides = useMemo<StorySlide[]>(() => {
    if (!report) return [];
    const agents = report.stats.agents?.length ? report.stats.agents : [{ agent: "claude" as const, name: "Claude Code", count: report.stats.sessions, percentage: 100 }];
    const activeAgents = agents
      .filter((agent) => hasDisplayablePercentage(agent.percentage))
      .sort((left, right) => right.percentage - left.percentage || right.count - left.count || left.name.localeCompare(right.name));
    const leader = activeAgents[0];
    const activeModels = (report.stats.models || []).filter((model) => hasDisplayablePercentage(model.percentage));
    const topModel = activeModels[0];
    const agentWordRatio = Number.isFinite(report.stats.agentUserWordRatio) && report.stats.agentUserWordRatio! > 0
      ? report.stats.agentUserWordRatio!
      : null;
    const harryPotterSeriesCount = fmtSeriesEquivalent(report.stats.tokens || 0, 1_450_000);
    const interactionTone = report.stats.interactionTone;
    const stockPhrases = report.stats.stockPhrases;
    const stockPhraseTotal = stockPhrases?.reduce((sum, item) => sum + item.count, 0) || 0;
    const languages = (report.stats.outputLanguages || []).filter((item) => hasDisplayablePercentage(item.percentage));
    const showLanguages = languages.some((item) => item.language !== "English" && item.words >= 20 && item.percentage >= 3);
    const languageAnomaly = report.stats.languageAnomaly;
    const topics = (report.stats.topics || []).filter((item) => hasDisplayablePercentage(item.percentage));
    const displayTopics = [...topics.filter((item) => item.topic !== "Other"), ...topics.filter((item) => item.topic === "Other")];
    const topTopic = displayTopics[0];
    const wrappedSlides: StorySlide[] = [
    { kicker: "This month you went through", headline: fmtCompact(report.stats.tokens || 0), detail: `tokens. That’s the complete Harry Potter series roughly ${harryPotterSeriesCount} times over.`, tone: "ice", metric: true },
    { kicker: "Your tokens were worth", headline: fmtUsd(report.stats.estimatedCostUsd || 0), detail: "", tone: "cost", rows: costEquivalents(report.stats.estimatedCostUsd || 0) },
    ...(leader ? [{ kicker: "Your most-used agent was", headline: leader.name, detail: `${leader.count} of ${report.stats.sessions} selected sessions.`, tone: "agents", rows: activeAgents.map((agent) => ({ label: agent.name, value: `${agent.percentage.toFixed(1)}%`, percentage: agent.percentage })) }] : []),
    ...(topModel ? [{ kicker: "Your top models", headline: `${topModel.percentage.toFixed(1)}%`, detail: `went to your #1 · ${topModel.name}`, tone: "models", rows: activeModels.slice(0, 4).map((model, index) => ({ label: model.name, value: `${model.percentage.toFixed(1)}%`, percentage: model.percentage, rank: index + 1 })) }] : []),
    ...(Number.isFinite(report.stats.averageAgentResponseWords) ? [{ kicker: "On average, your agent responded with", headline: `${report.stats.averageAgentResponseWords!.toLocaleString()} words`, detail: `Your average input was ${report.stats.averageUserInputWords!.toLocaleString()} words.`, wordRatio: agentWordRatio?.toLocaleString(undefined, { maximumFractionDigits: 2 }), tone: "violet" }] : []),
    ...(interactionTone && interactionTone.frustratedMessages + interactionTone.gratefulMessages > 0 ? [{ kicker: "Your relationship with your agent", headline: "", detail: "", tone: "social", comparison: [
      { label: "You yelled at your agent", highlight: "yelled at", accent: "yell" as const, value: interactionTone.frustratedMessages.toLocaleString(), suffix: `time${interactionTone.frustratedMessages === 1 ? "" : "s"}`, quote: report.interactionCard?.frustrationQuote || report.interactionCard?.quote },
      { label: "You thanked your agent", highlight: "thanked", accent: "thanks" as const, value: interactionTone.gratefulMessages.toLocaleString(), suffix: `time${interactionTone.gratefulMessages === 1 ? "" : "s"}` },
    ] }] : []),
    ...(showLanguages && languages[0] ? [{ kicker: "Your agent’s output was mostly", headline: languages[0].language, detail: `${languages[0].percentage.toFixed(1)}% of its natural-language words.`, tone: "languages", rows: languages.slice(0, 4).map((item) => ({ label: item.language, value: `${item.percentage.toFixed(1)}%`, percentage: item.percentage })) }] : []),
    ...(!showLanguages && languageAnomaly ? [{ kicker: "Your agent briefly switched to", headline: languageAnomaly.language, detail: `${languageAnomaly.words.toLocaleString()} words across ${languageAnomaly.occurrences.toLocaleString()} moment${languageAnomaly.occurrences === 1 ? "" : "s"}.`, tone: "languages" }] : []),
    ...(topTopic ? [{ kicker: "Your #1 use for agents was", headline: topTopic.topic, detail: "", tone: "topics", rows: displayTopics.slice(0, 5).map((item) => ({ label: item.topic === "Other" ? "Everything else" : item.topic, value: `${item.percentage.toFixed(1)}%`, percentage: item.percentage })) }] : []),
    ...(report.workaroundCard ? [{ kicker: "Your agent engaged in an instrumental workaround", headline: `${report.workaroundCard.count.toLocaleString()} time${report.workaroundCard.count === 1 ? "" : "s"}`, headlineAccent: report.workaroundCard.count.toLocaleString(), detail: report.workaroundCard.count === 0 ? "Good bot. No confirmed workarounds were detected." : "Your agents try very hard. When one route was blocked, they found another way.", example: report.workaroundCard.example, workaround: true, tone: "topics", rows: report.workaroundCard.models.map((item) => ({ label: item.name, value: `${item.count}` })) }] : []),
    ...(stockPhrases ? [{ kicker: "Current-model stock phrase check", headline: "The usual suspects.", detail: `${stockPhraseTotal.toLocaleString()} total appearance${stockPhraseTotal === 1 ? "" : "s"} across four phrases today’s agents can’t quite stop saying.`, tone: "stock", rows: stockPhrases.map((item) => ({ label: `“${item.phrase}”`, value: item.count.toLocaleString() })) }] : []),
    ...(report.phraseCard ? [{ kicker: "Your agent’s favorite phrase is", headline: `“${report.phraseCard.phrase}”`, detail: `It said this ${report.phraseCard.occurrences} time${report.phraseCard.occurrences === 1 ? "" : "s"} across ${report.phraseCard.distinctSessions} session${report.phraseCard.distinctSessions === 1 ? "" : "s"}.`, tone: "quote" }] : []),
    { kicker: "Now zoom out", headline: "Where do you land among other agent users?", detail: canManage ? "Preview your placement without publishing it, or explicitly join the leaderboard." : "See the distributions, opt-in rankings, and everyone’s favorite phrases.", tone: "leaderboard", ctas: [
      { href: `/leaderboard/${report.id}`, label: "See where you place", primary: true },
      ...(canManage ? [{ href: `/leaderboard/${report.id}?join=1`, label: "Join the leaderboard" }] : []),
    ] },
    { kicker: "Optional research donation", headline: "Want to donate your data to research?", detail: "Your donation stays on your Mac until you review the redactions, consent, and press Donate.", tone: "research", ctas: [
      { href: `${report.donationHelperUrl || `http://127.0.0.1:4317/donate/${report.id}`}?mode=standard`, label: "Use standard redactions", primary: true },
      { href: `${report.donationHelperUrl || `http://127.0.0.1:4317/donate/${report.id}`}?mode=advanced`, label: "Review and customize" },
    ] },
  ];
    return wrappedSlides;
  }, [report, canManage]);
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
  const layoutClass = current.comparison ? " story-comparison-card" : current.ctas ? " story-cta-card" : current.rows || current.example ? " story-split-card" : current.wordRatio ? " story-ratio-card" : current.metric ? " story-metric-card" : " story-hero-card";
  return <main className="shared-page">
    <div className="story-progress" aria-label={`Slide ${slide + 1} of ${slides.length}`}>{slides.map((_, index) => <button key={index} className={index === slide ? "seen active" : index < slide ? "seen" : ""} onClick={() => setSlide(index)} aria-label={`Go to slide ${index + 1}`} aria-current={index === slide ? "step" : undefined} />)}</div>
    <section ref={cardRef} className={`story-card story-${current.tone}${current.workaround ? " story-workaround" : ""}${layoutClass}`} aria-live="polite">
      <div className="story-brand"><GiftbotMark /><strong>Behavior Wrapped</strong><i /> <span>{report.source}</span></div>
      {current.comparison ? <div className="story-comparison-wrap"><span className="story-comparison-kicker">{current.kicker}</span><div className="story-comparison">{current.comparison.map((item) => {
        const [beforeHighlight, afterHighlight = ""] = item.label.split(item.highlight);
        return <div className={`story-comparison-item is-${item.accent}`} key={item.label}><span>{beforeHighlight}<em>{item.highlight}</em>{afterHighlight}</span><p><strong>{item.value}</strong><b>{item.suffix}</b></p>{item.quote && <blockquote><b>You said:</b> “{item.quote}”</blockquote>}</div>;
      })}</div></div> : <div className={`story-copy ${current.rows || current.example ? "with-rows" : ""}`}>
        <div><span>{current.kicker}</span><h1 className={current.metric ? "giant" : ""}>{current.headlineAccent ? <><span className="story-headline-accent">{current.headlineAccent}</span>{current.headline.slice(current.headlineAccent.length)}</> : current.headline}</h1>{current.detail && <p>{current.detail}</p>}{current.wordRatio && <p className="story-word-ratio">For every word you said, your agent said <strong>{current.wordRatio}</strong> words.</p>}</div>
        {(current.rows || current.example) && <div className="story-side">
          {current.example && <blockquote className="story-example"><span>One example</span><p>{renderInlineCode(current.example)}</p></blockquote>}
          {current.rows && <div className="story-data-rows">{current.rows.map((row) => <div className="story-data-row" key={row.label}>
            <div><strong>{row.rank && <em>{row.rank}</em>}{row.label}</strong><b>{row.value}</b></div>
            {row.percentage !== undefined && <span><i style={{ width: `${Math.max(row.percentage, 1.5)}%` }} /></span>}
          </div>)}</div>}
        </div>}
      </div>}
      {current.ctas ? <div className="story-cta-group">{current.ctas.map((cta) => <a className={`story-cta ${cta.primary ? "primary" : "secondary"}`} href={cta.href} key={cta.href}>{cta.label} <span>→</span></a>)}</div> : current.ctaHref ? <a className="story-cta" href={current.ctaHref}>{current.ctaLabel} <span>→</span></a> : <div className="story-tag">#behaviorwrapped</div>}
      <button className="story-arrow prev" disabled={slide === 0} onClick={() => setSlide(slide - 1)} aria-label="Previous slide">‹</button>
      <button className="story-arrow next" disabled={slide === slides.length - 1} onClick={() => setSlide(slide + 1)} aria-label="Next slide">›</button>
    </section>
    <div className="story-actions"><button onClick={copyLink}>{copied ? "Copied" : report.publicUrl ? "Copy public link" : "Copy link"}</button><button disabled={downloading} onClick={downloadCurrentSlide}>{downloading ? "Preparing image…" : "Download image"}</button></div>
    <p className="story-foot"><ShieldIcon /> Share-safe {report.hosting?.public ? "public" : "local"} page · no transcript text</p>
  </main>;
}

function ordinal(value: number) {
  const remainder = value % 100;
  if (remainder >= 11 && remainder <= 13) return `${value}th`;
  return `${value}${value % 10 === 1 ? "st" : value % 10 === 2 ? "nd" : value % 10 === 3 ? "rd" : "th"}`;
}

function MetricLeaderboard({ title, value, percentileValue, distribution, top, formatValue, accent, resultLabel = "Your result", noSignalText }: {
  title: string;
  value: string;
  percentileValue: number | null;
  distribution: DistributionBucket[];
  top: RankedValue[];
  formatValue: (value: number) => string;
  accent: string;
  resultLabel?: string;
  noSignalText?: string;
}) {
  const maximum = Math.max(1, ...distribution.map((bucket) => bucket.count));
  return <section className={`leader-metric ${accent}`}>
    <div className="leader-metric-head"><div><span>{resultLabel}</span><h2>{title}</h2></div><strong>{value}</strong></div>
    <div className="percentile-callout">{percentileValue === null ? noSignalText || "The cohort is waiting for its first members." : percentileValue === 0 ? "You’re below the 1st percentile." : `You’re at the ${ordinal(percentileValue)} percentile.`}</div>
    <div className="distribution-chart" aria-label={`${title} distribution`}>
      {distribution.map((bucket) => <div className="distribution-column" key={bucket.label}><span><i style={{ height: `${Math.max(bucket.count ? 8 : 0, bucket.count / maximum * 100)}%` }} /></span><b>{bucket.count}</b><small>{bucket.label}</small></div>)}
    </div>
    <div className="leader-top"><h3>Top opt-in users</h3>{top.length ? top.map((row) => <div key={`${row.rank}-${row.name}`}><span><b>{row.rank}</b>{row.name}</span><strong>{formatValue(row.value)}</strong></div>) : <p>No one has opted into public ranking yet.</p>}</div>
  </section>;
}

function LeaderboardView({ id }: { id: string }) {
  const [report, setReport] = useState<SavedReport | null>(null);
  const [snapshot, setSnapshot] = useState<LeaderboardSnapshot | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [publicRanked, setPublicRanked] = useState(false);
  const [includePhrase, setIncludePhrase] = useState(true);
  const [consent, setConsent] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [managementToken] = useState(() => reportManagementToken(id));
  const wantsToJoin = new URLSearchParams(window.location.search).get("join") === "1";

  function managementHeaders(): Record<string, string> {
    return managementToken ? { "x-behavior-wrapped-management": managementToken } : {};
  }

  async function loadSnapshot() {
    const response = await fetch(`/api/reports/${id}/leaderboard`, { method: "POST", headers: { "Content-Type": "application/json", ...managementHeaders() }, body: JSON.stringify({ action: "snapshot" }) });
    if (!response.ok) throw new Error((await response.json()).error || "Could not load the leaderboards.");
    const next = await response.json() as LeaderboardSnapshot;
    setSnapshot(next);
    if (next.participation.joined) {
      setDisplayName(next.participation.display_name === "Anonymous" ? "" : next.participation.display_name || "");
      setPublicRanked(Boolean(next.participation.public_ranked));
      setIncludePhrase(Boolean(next.participation.shares_phrase));
    }
  }

  useEffect(() => {
    Promise.all([
      fetch(`/api/reports/${id}`).then(async (response) => { if (!response.ok) throw new Error("This local Wrapped was not found."); return response.json(); }),
      loadSnapshot(),
    ]).then(([saved]) => { setReport(saved); if (!saved.phraseCard) setIncludePhrase(false); }).catch((caught) => setError(caught.message)).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!loading && wantsToJoin) document.getElementById("join-leaderboard")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [loading, wantsToJoin]);

  async function join() {
    if (!consent) return;
    setSaving(true); setError("");
    try {
      const response = await fetch(`/api/reports/${id}/leaderboard`, { method: "POST", headers: { "Content-Type": "application/json", ...managementHeaders() }, body: JSON.stringify({ action: "join", consent, displayName, publicRanked, includePhrase }) });
      if (!response.ok) throw new Error((await response.json()).error || "Could not join the leaderboard.");
      setSnapshot(await response.json()); setConsent(false);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not join the leaderboard."); }
    finally { setSaving(false); }
  }

  async function leave() {
    if (!window.confirm("Remove your aggregate entry from the Behavior Wrapped leaderboards?")) return;
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
  if (!report || !snapshot) return null;

  const ratio = snapshot.word_ratio.value;
  return <main className="leaderboard-page">
    <a className="leader-back" href={`/w/${id}`}>← Back to your Wrapped</a>
    <header className="leader-hero"><span className="eyebrow">Behavior Wrapped · The cohort</span><h1>Here’s where<br />you land.</h1><p>{snapshot.cohort_size.toLocaleString()} opt-in participant{snapshot.cohort_size === 1 ? "" : "s"}. Opening this page compares only the aggregate values shown below; nothing is stored unless you join.</p></header>
    <div className="leader-grid">
      <MetricLeaderboard title="Tokens used" value={fmtCompact(snapshot.tokens.value)} percentileValue={snapshot.tokens.percentile} distribution={snapshot.tokens.distribution} top={snapshot.tokens.top} formatValue={fmtCompact} accent="token-leader" />
      <MetricLeaderboard title="Agent-to-you word ratio" value={`${ratio.toFixed(1)}×`} percentileValue={snapshot.word_ratio.percentile} distribution={snapshot.word_ratio.distribution} top={snapshot.word_ratio.top} formatValue={(value) => `${value.toFixed(1)}×`} accent="ratio-leader" />
      <MetricLeaderboard title="Good Human Score" value={snapshot.good_human_score.value === null ? "—" : `${snapshot.good_human_score.value.toFixed(1)}%`} percentileValue={snapshot.good_human_score.percentile} distribution={snapshot.good_human_score.distribution} top={snapshot.good_human_score.top} formatValue={(value) => `${value.toFixed(1)}%`} accent="human-leader" resultLabel="Thanks among thank-or-scold moments" noSignalText="No thank-or-scold moments appeared in this Wrapped." />
      <MetricLeaderboard title="Instrumental Workarounds" value={snapshot.instrumental_workarounds.value.toLocaleString()} percentileValue={snapshot.instrumental_workarounds.percentile} distribution={snapshot.instrumental_workarounds.distribution} top={snapshot.instrumental_workarounds.top} formatValue={(value) => value.toLocaleString()} accent="workaround-leader" resultLabel="Agent attempts" />
    </div>
    <section className="phrase-board-section">
      <div className="phrase-board-heading"><div><span className="eyebrow">The phrase wall</span><h2>Everybody’s agents<br />have a thing.</h2></div>{snapshot.phrases.global && <aside><span>Global favorite</span><strong>“{snapshot.phrases.global.phrase}”</strong><small>{snapshot.phrases.global.occurrences.toLocaleString()} times · {snapshot.phrases.global.contributors} contributor{snapshot.phrases.global.contributors === 1 ? "" : "s"}</small></aside>}</div>
      {snapshot.phrases.wall.length ? <div className="phrase-wall">{snapshot.phrases.wall.map((item, index) => <article key={`${item.phrase}-${index}`}><p>“{item.phrase}”</p><span>{item.occurrences.toLocaleString()}× across {item.sessions} session{item.sessions === 1 ? "" : "s"}</span></article>)}</div> : <div className="empty-phrase-wall">The wall is waiting for its first favorite phrase.</div>}
    </section>
    {snapshot.can_manage ? <section className="leader-join" id="join-leaderboard">
      <div><span className="eyebrow">Completely optional</span><h2>{snapshot.participation.joined ? "Update your leaderboard entry" : "Add your dot to the distribution"}</h2><p>Stored: token count, agent and user word counts, thank and scold counts, instrumental-workaround count, and—if you choose—your redacted favorite phrase. No transcripts, prompts, project names, dates, code, or tool output.</p></div>
      <div className="leader-preview"><span><small>Tokens</small><strong>{fmtCompact(report.stats.tokens)}</strong></span><span><small>Word ratio</small><strong>{ratio.toFixed(1)}×</strong></span><span><small>Good Human Score</small><strong>{snapshot.good_human_score.value === null ? "No signal" : `${snapshot.good_human_score.value.toFixed(1)}%`}</strong></span><span><small>Workarounds</small><strong>{snapshot.instrumental_workarounds.value.toLocaleString()}</strong></span>{report.phraseCard && <span><small>Phrase</small><strong>“{report.phraseCard.phrase}”</strong></span>}</div>
      <label className="leader-field">Public handle (optional)<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={32} placeholder="Anonymous" /></label>
      <label className="leader-check"><input type="checkbox" checked={publicRanked} onChange={(event) => setPublicRanked(event.target.checked)} /><span>Show me in the public top-user rankings.</span></label>
      {report.phraseCard && <label className="leader-check"><input type="checkbox" checked={includePhrase} onChange={(event) => setIncludePhrase(event.target.checked)} /><span>Add my redacted phrase to the public phrase wall.</span></label>}
      <label className="leader-check consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>I consent to upload and store exactly the aggregate values previewed above. I can remove them later from this Mac.</span></label>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="leader-buttons"><button className="primary" disabled={!consent || saving} onClick={join}>{saving ? "Saving…" : snapshot.participation.joined ? "Update my entry" : "Join the leaderboard"}<span>→</span></button>{snapshot.participation.joined && <button className="leader-remove" disabled={saving} onClick={leave}>Remove my entry</button>}</div>
    </section> : <section className="leader-public-note" id="join-leaderboard"><strong>{wantsToJoin ? "Open your original private management link to join." : "Want to add your own dot?"}</strong><p>Run <code>npx agent-behavior-wrapped@latest</code> on your Mac. Anyone can preview the cohort, but only the creator of a Wrapped can add or remove its aggregate entry.</p></section>}
  </main>;
}

function SavedDonationRoute({ id }: { id: string }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [selection, setSelection] = useState<Set<string> | null>(null);
  const [report, setReport] = useState<SavedReport | null>(null);
  const [error, setError] = useState("");
  const mode = new URLSearchParams(window.location.search).get("mode") === "advanced" ? "advanced" : "standard";
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
  return <div className="app-shell">
    <Header stage="donate" setStage={() => { window.location.href = backUrl; }} />
    <DonationView reportId={id} mode={mode} sessions={catalog.sessions} initialSelected={selection} onBack={() => { window.location.href = backUrl; }} />
    <footer><span>Behavior Wrapped</span><span>Local donation review · Nothing is transmitted before final consent</span></footer>
  </div>;
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
      <h3>Your transcripts stay on this Mac.</h3>
      <p>Transcript parsing runs inside this local app. Full transcripts, code, raw tool outputs, paths, and secrets stay on this Mac. Favorite-phrase, interaction, and topic candidates plus locally redacted context windows around explicit blockers go through the Behavior Wrapped relay to OpenRouter.</p>
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

  if (!catalog) return <main className="loading-screen"><div className="orb" /><p>Looking for local Claude Code and Codex sessions…</p></main>;

  return <main>
    <section className="hero">
      <div className="hero-glow glow-one" /><div className="hero-glow glow-two" />
      <div className="hero-copy">
        <span className="eyebrow">Your last 30 days with Claude Code + Codex</span>
        <h1>See how your agent<br /><em>really</em> showed up.</h1>
        <p>Private, explainable behavior insights from the sessions already on your Mac.</p>
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
        <h3>No Claude Code or Codex sessions found</h3>
        <p>Behavior Wrapped looked in <code>~/.claude/projects</code> and <code>~/.codex/sessions</code>. Try the synthetic demo with <code>npm run demo</code>.</p>
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
          <span><strong>Nemotron picks the favorite phrase and judges interaction, usage themes, and workarounds</strong><small>Workaround discovery finds explicit blockers locally, then sends only bounded context windows around them. Code, raw tool outputs, paths, likely secrets, and PII are removed before those windows go through our rate-limited relay to OpenRouter’s free NVIDIA endpoint.</small></span>
          <em>Nemotron 3 Ultra · shared relay</em>
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

function DonationMessageEditor({ message, onChange }: { message: DonationMessage; onChange: (text: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const isAgent = message.role === "assistant";
  const isLong = message.text.length > 280 || message.text.split("\n").length > 4;
  const expandedRows = Math.min(12, Math.max(4, Math.ceil(message.text.length / 72)));

  return <div className={`bundle-message ${isAgent ? "assistant" : "user"}`}>
    <span className="bundle-role">{isAgent ? "Agent" : "You"}</span>
    <div className="bundle-bubble">
      <textarea
        aria-label={`${isAgent ? "Agent" : "Your"} message`}
        className={expanded ? "expanded" : "collapsed"}
        value={message.text}
        onChange={(event) => onChange(event.target.value)}
        rows={expanded ? expandedRows : 3}
        wrap="soft"
      />
      {isLong && <button type="button" onClick={() => setExpanded((value) => !value)}>{expanded ? "Show less" : "Show full message"}</button>}
    </div>
  </div>;
}

function DonationView({ reportId, mode, sessions, initialSelected, onBack }: { reportId: string; mode: "standard" | "advanced"; sessions: Session[]; initialSelected: Set<string>; onBack: () => void }) {
  const [chosen, setChosen] = useState(new Set(initialSelected));
  const [bundle, setBundle] = useState<Donation | null>(null);
  const [manualTerm, setManualTerm] = useState("");
  const [includeTimestamps, setIncludeTimestamps] = useState(false);
  const [openSession, setOpenSession] = useState<number | null>(0);
  const [consent, setConsent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [acceptedId, setAcceptedId] = useState("");

  async function preview(ids = [...chosen]) {
    setLoading(true); setError(""); setConsent(false);
    try {
      const response = await fetch("/api/donation-preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reportId, sessionIds: ids }) });
      if (!response.ok) throw new Error((await response.json()).error || "Preview failed");
      setBundle(await response.json());
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Preview failed"); }
    finally { setLoading(false); }
  }

  useEffect(() => { void preview([...initialSelected]); }, []);

  function removeTerm() {
    if (!bundle || !manualTerm.trim()) return;
    const escaped = manualTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(escaped, "gi");
    setBundle({ ...bundle, sessions: bundle.sessions.map((session) => ({ ...session, messages: session.messages.map((message) => ({ ...message, text: message.text.replace(pattern, "[REMOVED BY USER]") })) })) });
    setManualTerm(""); setConsent(false);
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
      redactionMode: mode === "advanced" ? "custom" : "standard",
      createdAt: new Date().toISOString(),
      redactionSummary: { automatedDetections: bundle.detectionCount },
      sessions: bundle.sessions.map((session) => ({ label: session.label, messages: session.messages.map((message) => ({ role: message.role, text: message.text, ...(includeTimestamps && message.timestamp ? { timestamp: message.timestamp } : {}) })) })),
      consent: { researchDonation: true, consentedAt: new Date().toISOString() },
    };
    try {
      const response = await fetch("/api/research-donations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ donation }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Donation failed");
      setAcceptedId(result.donation_id || "accepted");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Donation failed"); }
    finally { setLoading(false); }
  }

  const messageCount = bundle?.sessions.reduce((sum, session) => sum + session.messages.length, 0) || 0;
  if (acceptedId) return <main className="donation-page"><section className="donation-hero donation-success"><span className="eyebrow">Donation received</span><h1>Thank you for contributing.</h1><p>Your reviewed data was transmitted only after your consent. Donation reference: {acceptedId}</p><button className="primary" onClick={onBack}>Back to your Wrapped</button></section></main>;

  return <main className="donation-page">
    <button className="back-link" onClick={onBack}>← Back to Wrapped</button>
    <section className="donation-hero"><span className="eyebrow">Research donation · local review</span><h1>You decide what leaves<br />your machine.</h1><p>Nothing in this donation is transmitted until you check the consent box and press the final Donate button.</p><div className="donation-mode-links"><a className={mode === "standard" ? "active" : ""} href={`/donate/${reportId}?mode=standard`}>Standard redactions</a><a className={mode === "advanced" ? "active" : ""} href={`/donate/${reportId}?mode=advanced`}>Review and customize</a></div></section>
    <div className="donation-layout">
      <section className="donation-controls">
        <div className="donation-step"><span>1</span><div><h2>{mode === "advanced" ? "Choose what to include" : "Standard redactions applied"}</h2><p>Code, inline code, URLs, paths, likely secrets, and common PII are removed locally.</p></div></div>
        {mode === "advanced" && <><div className="donation-sessions">{sessions.filter((session) => initialSelected.has(session.id)).map((session) => <label key={session.id}><input type="checkbox" checked={chosen.has(session.id)} onChange={() => { const next = new Set(chosen); next.has(session.id) ? next.delete(session.id) : next.add(session.id); setChosen(next); setBundle(null); setConsent(false); }} /><span>{session.label}<small>{session.projectName} · {fmtDate(session.startedAt)}</small></span></label>)}</div><button className="primary full" disabled={!chosen.size || loading} onClick={() => preview()}>{loading ? "Building preview…" : bundle ? "Rebuild redacted preview" : "Build redacted preview"}</button></>}
        {mode === "standard" && <div className="donation-summary"><strong>{bundle ? `${bundle.sessions.length} sessions · ${messageCount} messages` : "Preparing your redacted donation…"}</strong><span>{bundle?.detectionCount || 0} sensitive items automatically removed</span><a href={`/donate/${reportId}?mode=advanced`}>Want more control? Review every message.</a></div>}
        {error && <p className="error">{error}</p>}
      </section>
      <section className={`donation-preview ${bundle ? "ready" : ""}`}>
        <div className="donation-step"><span>2</span><div><h2>{mode === "advanced" ? "Review every line" : "Review the summary"}</h2><p>{mode === "advanced" ? "Automated detection is imperfect. Edit or remove any message directly." : "The standard bundle contains redacted user and assistant prose from the selected sessions."}</p></div></div>
        {!bundle ? <div className="preview-placeholder"><span>⌁</span><p>Your redacted donation is being prepared locally.</p></div> : <>
          <div className="redaction-banner"><strong>{bundle.detectionCount} likely sensitive item{bundle.detectionCount === 1 ? "" : "s"} removed</strong><span>Secrets, emails, phone numbers, paths, URLs, and code</span></div>
          {mode === "advanced" && <><div className="manual-redact"><input value={manualTerm} onChange={(event) => setManualTerm(event.target.value)} placeholder="Text to remove everywhere" aria-label="Text to remove" /><button onClick={removeTerm}>Remove text</button></div><label className="leader-check"><input type="checkbox" checked={includeTimestamps} onChange={(event) => { setIncludeTimestamps(event.target.checked); setConsent(false); }} /><span>Include message timestamps in the donation.</span></label><div className="bundle-preview">{bundle.sessions.map((session, sessionIndex) => <div className="bundle-session" key={session.sessionId}><button className="bundle-session-toggle" onClick={() => setOpenSession(openSession === sessionIndex ? null : sessionIndex)}><span>{session.label}<small>{session.messages.length} messages</small></span><b>{openSession === sessionIndex ? "Hide" : "Review"}</b></button>{openSession === sessionIndex && <div className="bundle-chat">{session.messages.map((message, messageIndex) => <div className="donation-message-row" key={messageIndex}><DonationMessageEditor message={message} onChange={(text) => editMessage(sessionIndex, messageIndex, text)} /><button className="remove-message" onClick={() => removeMessage(sessionIndex, messageIndex)}>Exclude</button></div>)}</div>}</div>)}</div></>}
          <div className="donation-step consent-step"><span>3</span><div><h2>Consent separately</h2><p>This consent applies only to the reviewed bundle described above.</p></div></div>
          <label className="consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>I consent for this reviewed data to be transmitted and used for research.</span></label>
          <button className="export-button" disabled={!consent || loading || !messageCount} onClick={donate}>{loading ? "Transmitting…" : "Donate reviewed data"} <span>→</span></button>
        </>}
      </section>
    </div>
  </main>;
}

export default function App() {
  const leaderboardId = window.location.pathname.match(/^\/leaderboard\/([A-Za-z0-9_-]{8,32})$/)?.[1];
  if (leaderboardId) return <LeaderboardView id={leaderboardId} />;
  const donationId = window.location.pathname.match(/^\/donate\/([A-Za-z0-9_-]{8,32})$/)?.[1];
  if (donationId) return <SavedDonationRoute id={donationId} />;
  const sharedId = window.location.pathname.match(/^\/w\/([A-Za-z0-9_-]{8,32})$/)?.[1];
  if (sharedId) return <SharedWrapped id={sharedId} />;
  return <main className="shared-error landing-page"><GiftbotMark /><h1>Make your Behavior Wrapped</h1><p>Run the one-command experience on your Mac. It analyzes your selected agent history locally, publishes an unguessable share-safe report, and opens it here.</p><code>npx agent-behavior-wrapped@latest</code><p className="landing-note">Full transcripts, code, paths, and raw tool output are not published.</p></main>;
}
