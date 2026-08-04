# Behavior Wrapped

A local-first, macOS prototype that discovers Claude Code session history in `~/.claude/projects`, analyzes selected sessions on-device, and serves a private Wrapped-style report at localhost.

## One-command flow

Requires Node.js 20 or newer.

```bash
npm install
npm run build
npm run wrapped
```

The command automatically scans Claude Code, creates a share-safe snapshot, prints a stable local URL such as `http://127.0.0.1:4317/w/…`, starts the local viewer when needed, and opens the Wrapped slideshow. Nothing is uploaded.

The final slideshow card offers an optional research-donation review. It opens a private page with the Wrapped's sessions preselected, automatic redactions, editable message text, separate consent, and local-only bundle export.

Use `npm run wrapped -- --demo` to generate a Wrapped from synthetic fixtures. Add `--no-open` to leave the browser closed.

Saved reports are managed with:

```bash
./server/cli.mjs list
./server/cli.mjs open <id>
./server/cli.mjs delete <id>
```

After publishing as an npm package, the same binary is ready for an `npx agent-behavior-wrapped@latest` flow.

## Private dashboard

Run `npm start` to open the full local dashboard at `http://127.0.0.1:4317`. It lets you refine the date range, projects, and sessions; inspect private evidence; and preview research donation.

For UI development, run the local API with `npm run demo -- --no-open`, then run `npm run dev` in a second terminal and open `http://localhost:5173`.

## Privacy model

- The launcher reads only selected JSONL files from the canonical Claude Code directory.
- Analysis and redaction run locally. The application contains no analytics or external assets and makes no network requests during its normal launcher, dashboard, report, or donation-preview flows.
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

### Optional LLM phrase judge

The phrase judge is the one explicitly networked workflow. It sends only redacted aggregate phrase candidates—not transcripts—to Anthropic after you invoke it. Haiku 4.5 is the default model.

```bash
export ANTHROPIC_API_KEY='your-key'
npm run judge:phrases -- \
  analysis-output/local-phrase-families.v1.json \
  analysis-output/local-phrase-judgment.v1.json
```

The API key is read from the environment and is never written to an artifact. Results use forced structured output, then resolve the selected candidate ID to its exact locally counted phrase so the model cannot invent wording or inflate a count. Automated redaction is imperfect; review any generated phrase-family artifact before initiating this optional request.

## Prototype boundaries

- Behavioral findings are transparent heuristics, not calibrated diagnoses.
- Research donation exports a reviewed local bundle but does not upload it.
- Public sharing is a local preview; hosted publishing and account management are not implemented.
- The project is intentionally marked private in `package.json` until its npm package name and release process are finalized.
