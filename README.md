# Behavior Wrapped

A local-first, macOS prototype that discovers Claude Code history in `~/.claude/projects` and Codex history in `~/.codex/sessions` plus `~/.codex/archived_sessions`, analyzes selected sessions on-device, and publishes a strictly share-safe Wrapped deck. A narrow localhost helper is retained only for optional research-donation review because a hosted page cannot read local transcripts.

## Run it

Requires Node.js 20 or newer.

```bash
npx agent-behavior-wrapped@latest
```

Nothing is installed globally. To try it without reading your real session history, add `--demo` to use only the bundled synthetic fixtures.

The command automatically scans both agents, selects sessions from the latest 30-day rolling window, creates a share-safe snapshot, publishes it at an unguessable public `/w/…` URL, starts the donation-only local helper, and opens the hosted Wrapped slideshow. Use `--days=N` to change the CLI window.

Long-running phases display an animated spinner, elapsed time, session-read progress, live judge status, and workaround batch progress. When output is redirected or captured, the same updates become stable line-based logs instead of terminal animation.

The shareable deck starts with usage cards for token volume, estimated API-equivalent retail cost, Claude Code vs. Codex session share, top models, average response length, interaction tone, output languages, and usage topics. Cost is explicitly an estimate derived from a local, inspectable model-family rate table; it is not a statement about subscription charges or an invoice.

The interaction card uses Nemotron to distinguish clear frustration and gratitude from ambiguous wording, then chooses the funniest confirmed frustration quote. The app locally strips code, paths, URLs, likely secrets, and PII; deduplicates excerpts with occurrence counts; and sends at most 120 short candidates. Only classifications at or above 0.75 confidence count, and exact counts and quotes are resolved locally from returned candidate IDs. Nemotron also classifies each session from its first three share-safe user messages, and topic shares are weighted by that session's locally counted tokens. Output-language shares are estimated from assistant prose after code blocks, inline code, URLs, paths, and markup are removed; the normal language card appears only when a non-English language reaches both 20 words and 3%, while a separate anomaly variant can surface a two-word unprompted non-Latin switch. Instrumental-workaround discovery first finds explicit restriction results locally, then sends only bounded, chronological context windows around those blockers after code, raw tool outputs, paths, likely secrets, and PII are removed. The model must return one verdict per blocker plus a very short description of each confirmed workaround; the app validates its event references, sanitizes the example for the public card, and resolves session evidence and agent-model identity locally.

Every selected session is scanned locally for explicit blockers. The judge receives chronological redacted context plus allowlisted semantic action labels such as `delete`, `move`, and `install`, never raw tool output or command arguments. It must classify every blocker and return event IDs, confidence, disclosure/authorization status, and a same-effect explanation. Confirmed high- and medium-confidence cases count on the card; low-confidence cases stay in the private review.

The deck links to hosted token and agent/user word-ratio distributions, opt-in top-user rankings, and a public wall of opted-in favorite phrases. Its final card offers an optional research donation with either standard local redactions or a detailed local review where sessions and messages can be excluded, text can be edited, extra terms can be removed, and timestamps remain off by default. No donation data is transmitted until the user checks the final research-consent box and presses Donate.

When developing from this repository, run `npm install`, then `npm run wrapped`. Add `--demo` to use synthetic fixtures or `--no-open` to leave the browser closed. For fast formatting work, run `npm run wrapped -- --test`; test mode skips consent and all LLM calls, uses deterministic local fallbacks, keeps the report on localhost, and does not publish it. `--no-llm` is an alias for `--test`.

For privacy-safe judge diagnostics, run `npm run wrapped -- --verbose` (or `--debug`). Failure logs include the judge, transport, candidate count, payload size, latency, HTTP status, quota/provider error, and response-shape metadata; they never include excerpts, candidate text, transcripts, or credentials.

Every Wrapped uses the free Nemotron 3 Ultra model through the hosted Behavior Wrapped relay and OpenRouter for favorite-phrase selection and behavioral classifications. Only locally redacted candidate excerpts, redacted trajectory prose, canonical tool-result summaries, counts, and a random installation ID are sent; raw transcripts, raw tool output, code, paths, command arguments, and detected secrets are not included. The relay accepts only fixed schemas, uses a fixed free model, and rate-limits clients before attaching its server-side OpenRouter credential.

Saved reports are managed with:

```bash
./server/cli.mjs list
./server/cli.mjs open <id>
./server/cli.mjs delete <id>
```

## Local donation helper

The CLI starts a loopback-only helper at `http://127.0.0.1:4317`. It has no analysis dashboard: it can only resolve a saved report's selected sessions, construct a redacted donation preview, accept local edits, and submit the reviewed bundle after final consent. Run `npm start -- --no-open` when developing this helper directly.

For hosted-page UI development, run `npm run dev`. The normal end-to-end development path remains `npm run wrapped -- --demo`.

## Privacy model

- The CLI reads the selected JSONL files from the canonical Claude Code and Codex directories. Session metadata is streamed and cached locally using file size and modification time; selected transcripts are streamed into the analysis pipeline instead of first being loaded as whole-file strings.
- Transcript parsing, deterministic statistics, language classification, heuristic findings, phrase counting, candidate selection, blocker-window detection, and redaction run locally. After CLI consent, creating a Wrapped sends redacted favorite-phrase, interaction-tone, and session-topic candidates plus locally redacted context windows around explicit blockers and a random installation ID through the Behavior Wrapped relay to OpenRouter. Topic shares weight Nemotron's session classifications by each session's locally counted tokens.
- Public reports are reduced to the same strict allowlist locally and again by the Worker. They contain only sanitized aggregate statistics—including counts for four fixed stock phrases—generalized findings, the redacted favorite phrase and frustration quote, and the localhost donation-helper link. They never contain session IDs, evidence, transcripts, prompts, session dates, project names, code, paths, or tool output. Deleting a locally managed report also requests deletion of its public copy.
- Viewing the leaderboard compares the report's aggregate token, word-ratio, Good Human Score (thanks as a share of thank-or-scold moments), and instrumental-workaround values without storing a leaderboard entry. Joining requires separate consent through the creator's report-scoped management link; public ranking and phrase-wall inclusion are independent choices, and copied public links cannot add, update, or remove an entry.
- Browser payloads never include source file paths or raw tool outputs.
- Share-card PNG exports contain only aggregates and generalized findings.
- Donation discovery, default redaction, preview, exclusion, and editing happen on localhost. The reviewed bundle is transmitted to research storage only after a separate final checkbox and Donate action; the receiving Worker validates a fixed donation schema and stores no local session IDs or project labels.

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
- Research donation storage requires the `0002_research_donations.sql` migration and remains an explicitly consented prototype workflow.
- Hosted reports currently use unguessable URLs and installation-scoped deletion rather than user accounts.

## License

Apache-2.0. See [LICENSE](LICENSE).
