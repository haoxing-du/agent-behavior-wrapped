# Behavior Wrapped

[behaviorwrapped.com](https://behaviorwrapped.com)

Behavior Wrapped turns your local Claude Code, Cowork, and Codex history into a private review and an optional shareable Wrapped deck—without uploading raw transcripts.

It shows how you use coding agents: token volume and estimated API-equivalent cost, favorite phrases, interaction tone, topics, session patterns, autonomy, mistakes, interruptions, and instrumental workarounds.

## Quick start

Requires Node.js 20 or newer on macOS or Linux.

```bash
npx behavior-wrapped@latest
```

Nothing is installed globally. To explore the full experience without reading your history, use the bundled synthetic data:

```bash
npx behavior-wrapped@latest --demo
```

The CLI discovers sessions from Claude Code and Codex automatically. On macOS it can also read Cowork audit streams; Cowork history is not currently available on Linux. The default report covers the latest 30 days.

## What you get

- Usage cards for tokens, estimated cost, models, platforms, response length, session length, languages, and topics.
- Behavioral cards for repeated instructions, gratitude and frustration, admitted mistakes, interruptions, autonomy, and workarounds after tool restrictions.
- A favorite phrase selected from exact, locally counted repetitions.
- An optional shareable slideshow and image exports containing only allowlisted aggregates and sanitized findings.
- Private, localhost-only evidence views for findings that benefit from reviewing the original context.

Cost is an estimate based on an inspectable model-family rate table. It is not a subscription charge or invoice. Behavioral findings are explainable heuristics for review, not diagnoses or ground truth.

## Privacy at a glance

Raw transcripts, code, paths, command arguments, and raw tool output stay on your machine. Deterministic statistics, candidate selection, and redaction also run locally.

With your consent, bounded redacted candidates and sanitized blocker context are sent through the Behavior Wrapped relay for AI classification. Public reports are reduced to a strict allowlist before upload and again by the hosted Worker. They contain aggregates, generalized findings, and selected redacted quotes—not full prompts, transcripts, dates, project names, session IDs, or evidence.

Published reports use unguessable URLs and participate in the anonymous cohort leaderboard by default. You can opt out or delete a report using its private management link. If you decline remote analysis, the CLI offers a localhost-only report with deterministic statistics and no leaderboard participation.

Research donation is separate and optional. Nothing is donated until you review the selected material, check the final consent box, and press **Donate**. The reviewed bundle is encrypted locally before leaving your machine. If an interaction-tone result looks wrong, its private evidence card can start the same protected donation flow with only that source session and the corrected classification.

See the [privacy model](docs/privacy.md), [analysis methods](docs/analysis-methods.md), and [research donation design](docs/research-donations.md) for the detailed guarantees and boundaries.

## Options

| Option | Purpose |
| --- | --- |
| `--demo` | Use only bundled synthetic sessions. |
| `--days=N` | Change the report window from the default 30 days. |
| `--no-open` | Do not open the finished report automatically. |
| `--test` / `--no-llm` | Skip consent and remote AI calls; keep the report on localhost. |
| `--verbose` / `--debug` | Show privacy-safe judge diagnostics without excerpt text. |

Manage saved reports with:

```bash
behavior-wrapped list
behavior-wrapped open <id>
behavior-wrapped delete <id>
```

## Development

```bash
npm install
npm run wrapped -- --demo
npm run check
```

Use `npm run dev` for hosted-page UI work. See the [development guide](docs/development.md) for local modes, relay configuration, phrase research, and maintainer operations.

## License

Apache-2.0. See [LICENSE](LICENSE).
