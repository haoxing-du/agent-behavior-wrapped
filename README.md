# Behavior Wrapped

A local-first, macOS prototype that discovers Claude Code history in `~/.claude/projects` and Codex history in `~/.codex/sessions` plus `~/.codex/archived_sessions`, analyzes selected sessions on-device, and serves a private Wrapped-style report at localhost.

## Run it

Requires Node.js 20 or newer.

```bash
npx agent-behavior-wrapped@latest
```

Nothing is installed globally. To try it without reading your real session history, add `--demo` to use only the bundled synthetic fixtures.

The command automatically scans both agents, selects sessions from the latest 30-day rolling window, creates a share-safe snapshot, prints a stable local URL such as `http://127.0.0.1:4317/w/…`, starts the local viewer when needed, and opens the Wrapped slideshow. Use `--days=N` to change the CLI window; the private dashboard also exposes exact date controls.

The shareable deck starts with four deterministic usage cards: token volume, estimated API-equivalent retail cost, Claude Code vs. Codex session share, and top models by token share. Cost is explicitly an estimate derived from a local, inspectable model-family rate table; it is not a statement about subscription charges or an invoice.

The final slideshow card offers an optional research-donation review. It opens a private page with the Wrapped's sessions preselected, automatic redactions, editable message text, separate consent, and local-only bundle export.

When developing from this repository, run `npm install`, then `npm run wrapped`. Add `--demo` to use synthetic fixtures or `--no-open` to leave the browser closed.

Every Wrapped includes a “Your agent said … N times” slide chosen by the free Nemotron 3 Ultra model through the hosted Behavior Wrapped relay and OpenRouter. Exact phrase counts are computed locally. Only redacted aggregate phrase candidates, counts, and a random installation ID are sent; transcripts, tool output, code, paths, and secrets are not included. The relay accepts only the fixed phrase-selection schema, uses a fixed free model, and rate-limits clients before attaching its server-side OpenRouter credential.

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
- Transcript parsing, deterministic statistics, heuristic findings, phrase counting, and redaction run locally. Creating a Wrapped sends the redacted aggregate phrase candidate list and a random installation ID through the Behavior Wrapped relay to OpenRouter for the standard Nemotron phrase card.
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
- Public sharing is a local preview; hosted publishing and account management are not implemented.

## License

Apache-2.0. See [LICENSE](LICENSE).
