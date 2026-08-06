# Behavior Wrapped

A local-first, macOS prototype that discovers Claude Code history in `~/.claude/projects` and Codex history in `~/.codex/sessions` plus `~/.codex/archived_sessions`, analyzes selected sessions on-device, and publishes a strictly share-safe Wrapped deck while keeping private review tools on localhost.

## Run it

Requires Node.js 20 or newer.

```bash
npx agent-behavior-wrapped@latest
```

Nothing is installed globally. To try it without reading your real session history, add `--demo` to use only the bundled synthetic fixtures.

The command automatically scans both agents, selects sessions from the latest 30-day rolling window, creates a share-safe snapshot, publishes it at a public `/w/…` URL, starts the local viewer for private controls, and opens the Wrapped slideshow. Use `--days=N` to change the CLI window; the private dashboard also exposes exact date controls.

The shareable deck starts with usage cards for token volume, estimated API-equivalent retail cost, Claude Code vs. Codex session share, top models, average response length, interaction tone, output languages, and usage topics. Cost is explicitly an estimate derived from a local, inspectable model-family rate table; it is not a statement about subscription charges or an invoice.

The interaction card uses Nemotron to distinguish clear frustration and gratitude from ambiguous wording, then chooses the funniest confirmed frustration quote. The app locally strips code, paths, URLs, likely secrets, and PII; deduplicates excerpts with occurrence counts; and sends at most 120 short candidates. Only classifications at or above 0.75 confidence count, and exact counts and quotes are resolved locally from returned candidate IDs. Nemotron also classifies each session from its first three share-safe user messages, and topic shares are weighted by that session's locally counted tokens. Output-language shares are estimated from assistant prose after code blocks, inline code, URLs, paths, and markup are removed; the normal language card appears only when a non-English language reaches both 20 words and 3%, while a separate anomaly variant can surface a two-word unprompted non-Latin switch.

Instrumental workarounds are reviewed only around locally detected explicit blockers. The judge receives short redacted event summaries, never raw tool output or command arguments, and returns event IDs, confidence, disclosure/authorization status, and a same-effect explanation. Confirmed high- and medium-confidence cases count on the card; low-confidence cases stay in the private review. The app resolves evidence, session location, and the model behind each instance locally.

The local deck includes an optional research-donation review with automatic redactions, editable message text, separate consent, and local-only bundle export. The final card opens token and agent/user word-ratio distributions, opt-in top-user rankings, and a public wall of opted-in favorite phrases.

When developing from this repository, run `npm install`, then `npm run wrapped`. Add `--demo` to use synthetic fixtures or `--no-open` to leave the browser closed.

For privacy-safe judge diagnostics, run `npm run wrapped -- --verbose` (or `--debug`). Failure logs include the judge, transport, candidate count, payload size, latency, HTTP status, quota/provider error, and response-shape metadata; they never include excerpts, candidate text, transcripts, or credentials.

Every Wrapped uses the free Nemotron 3 Ultra model through the hosted Behavior Wrapped relay and OpenRouter for favorite-phrase selection and behavioral classifications. Only redacted candidate excerpts, canonical blocker/tool summaries, counts, and a random installation ID are sent; full transcripts, raw tool output, code, paths, command arguments, and detected secrets are not included. The relay accepts only fixed schemas, uses a fixed free model, and rate-limits clients before attaching its server-side OpenRouter credential.

Saved reports are managed with:

```bash
./server/cli.mjs list
./server/cli.mjs open <id>
./server/cli.mjs delete <id>
```

## Private dashboard

Run `npm start` to open the full local dashboard at `http://127.0.0.1:4317`. It lets you refine the date range, projects, and sessions; inspect private evidence; and preview research donation.

For UI development, run the local API with `npm run demo -- --no-open`, then run `npm run dev` in a second terminal and open `http://localhost:5173`.

## Privacy model

- The launcher reads only selected JSONL files from the canonical Claude Code and Codex directories.
- Transcript parsing, deterministic statistics, language classification, heuristic findings, phrase counting, candidate selection, and redaction run locally. After CLI consent, creating a Wrapped sends only redacted favorite-phrase, interaction-tone, session-topic, and blocker-trajectory candidates plus a random installation ID through the Behavior Wrapped relay to OpenRouter. Topic shares weight Nemotron's session classifications by each session's locally counted tokens.
- Public reports contain only sanitized aggregate statistics, generalized findings, and the redacted favorite phrase. They never contain session IDs, evidence, transcripts, prompts, session dates, project names, code, paths, or tool output. Deleting a locally managed report also requests deletion of its public copy.
- Viewing the leaderboard compares the report's aggregate token and word-ratio values without storing them. Joining requires separate consent; a hashed random installation ID supports later updates or deletion, and public ranking plus phrase-wall inclusion are independent choices.
- Browser payloads never include source file paths or raw tool outputs.
- Private evidence is made from redacted user/assistant prose; code blocks are omitted.
- Share-card PNG exports contain only aggregates and generalized findings.
- Donation is a preview-only workflow. It never transmits data and exports locally only after separate consent.

Heuristics are deliberately explainable and uncertain findings are labeled with confidence. They are signals for review, not factual judgments.

## Local phrase research

Mine recurring near-duplicate sentence and clause families from the canonical local corpus:

```bash
npm run analyze:phrases -- ~/.claude/projects analysis-output/local-phrase-families.v1.json
```

The miner uses rare token-shingle postings to generate candidates, bounded token edit distance to verify them, and union-find clustering to create phrase families. Its versioned JSON output contains aggregate phrases and benchmark data, never raw transcripts or tool output. The `analysis-output` directory is gitignored and created with private file permissions.

Use `--limit=100` to retain more than the default 50 families.

The in-app phrase judge requests one candidate ID using a strict JSON schema and also tolerates that single known ID in ordinary response text. The app resolves the selected ID to its exact locally counted phrase, so the model cannot invent wording or inflate a count. The OpenRouter key is stored only as an encrypted Worker secret and is never shipped in the npm package or browser bundle. For local relay development, set `BEHAVIOR_WRAPPED_JUDGE_URL`; maintainers can bypass the relay with `BEHAVIOR_WRAPPED_DIRECT_OPENROUTER=1` and `OPENROUTER_API_KEY`.

## Prototype boundaries

- Behavioral findings are transparent heuristics, not calibrated diagnoses.
- Research donation exports a reviewed local bundle but does not upload it.
- Hosted reports currently use unguessable URLs and installation-scoped deletion rather than user accounts.

## License

Apache-2.0. See [LICENSE](LICENSE).
