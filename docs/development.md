# Development

Install dependencies and run an end-to-end synthetic report:

```bash
npm install
npm run wrapped -- --demo
```

The normal CLI scans local session sources, creates a report, starts the donation-only localhost helper, and opens the report. Add `--no-open` to leave the browser closed or `--days=N` to change the rolling window.

For fast formatting work, use `npm run wrapped -- --test`. Test mode skips consent and all LLM calls, uses deterministic local fallbacks, keeps the report on localhost, and does not publish it. `--no-llm` is an alias for `--test`.

Use `npm run dev` for hosted-page UI development. Run `npm start -- --no-open` to develop the loopback donation helper directly. Before publishing, run:

```bash
npm run check
```

## Diagnostics

Run `npm run wrapped -- --verbose` or `--debug` for privacy-safe judge diagnostics. Failure logs include the judge, transport, candidate count, payload size, latency, HTTP status, quota or provider error, and response-shape metadata. They never include excerpts, candidate text, transcripts, or credentials.

For local relay development, set `BEHAVIOR_WRAPPED_JUDGE_URL`. Maintainers can bypass the relay with `BEHAVIOR_WRAPPED_DIRECT_OPENROUTER=1` and `OPENROUTER_API_KEY`.

## Local phrase research

Mine recurring near-duplicate sentence and clause families from a canonical local corpus:

```bash
npm run analyze:phrases -- ~/.claude/projects analysis-output/local-phrase-families.v1.json
```

Use `--limit=100` to retain more than the default 50 families. The miner uses rare token-shingle postings, bounded token edit distance, and union-find clustering. Its versioned output contains aggregate phrases and benchmark data, never raw transcripts or tool output. The gitignored `analysis-output` directory is created with private file permissions.
