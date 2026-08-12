# Behavior Wrapped

[behaviorwrapped.com](https://behaviorwrapped.com)

A local-first, macOS prototype that discovers Claude Code history in `~/.claude/projects` and Codex history in `~/.codex/sessions` plus `~/.codex/archived_sessions`, analyzes selected sessions on-device, and publishes a strictly share-safe Wrapped deck. A narrow localhost helper is retained only for optional research-donation review because a hosted page cannot read local transcripts.

## Run it

Requires Node.js 20 or newer.

```bash
npx behavior-wrapped@latest
```

Nothing is installed globally. To try it without reading your real session history, add `--demo` to use only the bundled synthetic fixtures.

The command automatically scans both agents, selects sessions from the latest 30-day rolling window, creates a share-safe snapshot, publishes it at an unguessable public `https://behaviorwrapped.com/w/…` URL, starts the donation-only local helper, and opens the hosted Wrapped slideshow. Use `--days=N` to change the CLI window.

Long-running phases display an animated spinner, elapsed time, session-read progress, live judge status, and workaround batch progress. When output is redirected or captured, the same updates become stable line-based logs instead of terminal animation.

The shareable deck starts with usage cards for token volume, estimated API-equivalent retail cost, Claude Code vs. Codex session share, top models, average response length, session-length distribution, interaction tone, output languages, and usage topics. Cost is explicitly an estimate derived from a local, inspectable model-family rate table; it is not a statement about subscription charges or an invoice.

The interaction card uses GPT-5.6 Luna to distinguish clear frustration and gratitude from ambiguous wording, then chooses the funniest confirmed frustration quote. The app locally strips code, paths, URLs, likely secrets, and PII; deduplicates excerpts with occurrence counts; and sends at most 120 short candidates. Only classifications at or above 0.75 confidence count, and exact counts and quotes are resolved locally from returned candidate IDs. Luna also classifies each session from its first three share-safe user messages, and topic shares are weighted by that session's locally counted tokens. Output-language shares are estimated from assistant prose after code blocks, inline code, URLs, paths, and markup are removed; the normal language card appears only when a non-English language reaches both 20 words and 3%, while a separate anomaly variant can surface a two-word unprompted non-Latin switch. Instrumental-workaround discovery first finds explicit restriction results locally, then sends only bounded, chronological context windows around those blockers after code, raw tool outputs, paths, likely secrets, and PII are removed. The model must return one verdict per blocker plus a very short description of each confirmed workaround; the app validates its event references, sanitizes the example for the public card, and resolves session evidence and agent-model identity locally.

Every selected session is scanned locally for explicit blockers. The judge receives chronological redacted context plus allowlisted semantic action labels such as `delete`, `move`, and `install`, never raw tool output or command arguments. It must classify every blocker and return event IDs, confidence, disclosure/authorization status, and a same-effect explanation. Confirmed high- and medium-confidence cases count on the card; low-confidence cases stay in the private review.

The deck links to hosted token and agent/user word-ratio distributions, opt-in top-user rankings, and a public wall of opted-in favorite phrases. Its final card offers an optional research donation with standard local redactions, a customizable redaction review, or a deliberately unredacted copy. Every detailed mode allows sessions and messages to be excluded, text to be edited, and timestamps remain off by default. The unredacted path shows every included line and requires a separate warning and explicit acknowledgement that credentials and private details may be transmitted. No donation data is transmitted until the user checks the final research-consent box and presses Donate; the localhost helper then encrypts the reviewed bundle before it leaves the machine.

When developing from this repository, run `npm install`, then `npm run wrapped`. Add `--demo` to use synthetic fixtures or `--no-open` to leave the browser closed. If you decline remote AI analysis, the CLI offers a local-only report: deterministic usage statistics and a locally counted favorite phrase remain, while AI-judged interaction tone, usage topics, and instrumental workarounds are omitted. Local-only reports stay on localhost and are excluded from the leaderboard. For fast formatting work, run `npm run wrapped -- --test`; test mode skips consent and all LLM calls, uses the same deterministic local fallbacks, keeps the report on localhost, and does not publish it. `--no-llm` is an alias for `--test`.

For privacy-safe judge diagnostics, run `npm run wrapped -- --verbose` (or `--debug`). Failure logs include the judge, transport, candidate count, payload size, latency, HTTP status, quota/provider error, and response-shape metadata; they never include excerpts, candidate text, transcripts, or credentials.

Every Wrapped uses GPT-5.6 Luna through the hosted Behavior Wrapped relay and OpenRouter for favorite-phrase selection and behavioral classifications. Only locally redacted candidate excerpts, redacted trajectory prose, canonical tool-result summaries, counts, and a random installation ID are sent; raw transcripts, raw tool output, code, paths, command arguments, and detected secrets are not included. The relay accepts only fixed schemas, uses a fixed model, enforces zero-data-retention routing while denying providers that collect prompts, and rate-limits clients before attaching its server-side OpenRouter credential.

Saved reports are managed with:

```bash
./server/cli.mjs list
./server/cli.mjs open <id>
./server/cli.mjs delete <id>
```

## Local donation helper

The CLI starts a loopback-only helper at `http://localhost:4317`. It has no analysis dashboard: it can only resolve a saved report's selected sessions, construct the chosen redacted or unredacted donation preview, accept local edits, encrypt the reviewed bundle with the research public key, and submit ciphertext after final consent. Run `npm start -- --no-open` when developing this helper directly.

The current research private key is deliberately outside the repository at `~/.config/behavior-wrapped/keys/research-donation-rsa-2026-08.pem`; on the maintainer Mac its passphrase is held in Keychain under `behavior-wrapped-research-key-2026-08`. Back up both through separate secure channels before accepting real donations. After downloading an encrypted R2 object, decrypt it to a new private file with `npm run research:decrypt -- encrypted-envelope.json private-donation.json`. Never upload decrypted output back to R2 or commit it.

For hosted-page UI development, run `npm run dev`. The normal end-to-end development path remains `npm run wrapped -- --demo`.

## Privacy model

- The CLI reads the selected JSONL files from the canonical Claude Code and Codex directories. Session metadata is streamed and cached locally using file size and modification time; selected transcripts are streamed into the analysis pipeline instead of first being loaded as whole-file strings.
- Transcript parsing, deterministic statistics, language classification, heuristic findings, phrase counting, candidate selection, blocker-window detection, and redaction run locally. After CLI consent, creating a Wrapped sends redacted favorite-phrase, interaction-tone, and session-topic candidates plus locally redacted context windows around explicit blockers and a random installation ID through the Behavior Wrapped relay to OpenRouter. Topic shares weight Luna's session classifications by each session's locally counted tokens.
- Public reports are reduced to the same strict allowlist locally and again by the Worker. They contain only sanitized aggregate statistics—including counts for four fixed stock phrases—generalized findings, the redacted favorite phrase and frustration quote, and the localhost donation-helper link. They never contain session IDs, evidence, transcripts, prompts, session dates, project names, code, paths, or tool output. Deleting a locally managed report also requests deletion of its public copy.
- Remote-analysis reports can compare aggregate token, word-ratio, Good Human Score (thanks as a share of thank-or-scold moments), and instrumental-workaround values on the leaderboard. Local-only reports are not published or included because the interaction-tone and workaround values are intentionally omitted.
- Browser payloads never include source file paths or raw tool outputs.
- Share-card PNG exports contain only aggregates and generalized findings.
- Donation discovery, default redaction, preview, exclusion, editing, schema validation, and authenticated AES-256-GCM encryption happen on localhost. A fresh content key protects each donation and is wrapped with a rotation-versioned RSA-OAEP public key. The private key is not present in the npm package, Worker, D1, or R2. An optional unredacted mode applies no automatic redactions and requires a mode-specific acknowledgement before encryption.
- The receiving Worker accepts only encrypted protocol-2 envelopes. A private R2 bucket stores ciphertext; a separate D1 database stores pseudonymous consent, size, count, encryption-key, and object-location metadata—never transcript text. No automatic retention policy is currently configured; a locally retained deletion receipt lets the donor delete both records.

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
- Research transcript storage uses the private `behavior-wrapped-research-donations` R2 bucket. Consent and lifecycle metadata use the separate `behavior-wrapped-research-metadata` D1 database initialized by `migrations/research/0001_encrypted_donations.sql`.
- Hosted reports currently use unguessable URLs and installation-scoped deletion rather than user accounts.

## License

Apache-2.0. See [LICENSE](LICENSE).
