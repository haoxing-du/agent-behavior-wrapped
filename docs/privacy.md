# Privacy model

Behavior Wrapped is local-first rather than fully offline. It separates local transcript processing, optional remote classification, public report publishing, private evidence review, and optional research donation.

## Local processing

The CLI reads selected JSONL files from Claude Code, Cowork, and Codex. Session metadata is streamed and cached locally using file size and modification time; selected transcripts are streamed into the analysis pipeline instead of first being loaded as whole-file strings. Cowork's application-data layout is discoverable but is not a documented public interface, so future Claude Desktop releases may require parser updates.

Transcript parsing, deterministic statistics, language classification, heuristic findings, phrase counting, candidate selection, blocker-window detection, and redaction run locally. Browser payloads never include source file paths or raw tool outputs.

## Remote classification

After CLI consent, Behavior Wrapped sends only locally redacted favorite-phrase, interaction-tone, and session-topic candidates; locally redacted context windows around explicit blockers; canonical semantic action labels; aggregate counts; and a random installation ID. It does not send raw transcripts, raw tool output, code, paths, command arguments, or detected secrets.

Requests pass through the hosted Behavior Wrapped relay to GPT-5.6 Luna through OpenRouter. The relay accepts fixed schemas, fixes the model, applies client rate limits, and requests zero-data-retention routing while denying providers that collect prompts. Its credential stays in the Worker and is not shipped in the npm package or browser bundle.

## Public reports

The CLI reduces public reports to a strict allowlist, which the Worker validates again. Reports may contain sanitized aggregate statistics, anonymous per-session turn counts, counts for four fixed stock phrases, generalized findings, selected redacted quotes, and a localhost evidence or donation-helper link.

They never contain session IDs, full transcripts, prompts, evidence excerpts, session dates, project names, code, paths, or raw tool output. Share-card PNG exports use the same aggregate and generalized material.

Published reports use unguessable URLs rather than user accounts. They participate in the anonymous leaderboard by default and may contribute aggregate token, word-ratio, Good Human Score, session-length, and instrumental-workaround values. A private management link supports persistent opt-out and deletion. Deleting a locally managed report also requests deletion of its public copy.

Local-only reports omit AI-judged interaction tone, topics, and workarounds. They remain on localhost and are excluded from the leaderboard.

## Private evidence

Confirmed workaround cards can link to a localhost-only evidence page. Interaction-tone cards can likewise show the exact locally reconstructed yelling, thanking, and apology excerpts. These excerpts do not enter the public report, share-card export, or remote payload merely by opening the page.

Yelling and thanking occurrences include an optional **Is this inaccurate?** path. It resolves the occurrence to its original session on localhost and opens the normal research-donation review restricted to that one session. The user chooses a corrected label, can edit or exclude messages and customize redactions, then provides purpose-specific consent. Clicking the feedback link alone transmits nothing.

Accepted classifier feedback receives the same local encryption, private ciphertext storage, deletion receipt, and deletion controls as an ordinary research donation. Its encrypted contents include the reviewed session, original verdict, correction, judged excerpt, judge version, and optional note. Public reports, leaderboard payloads, share-card exports, and operational notifications never include this material.

## Boundaries

- Behavioral findings are transparent heuristics, not calibrated diagnoses.
- Hosted reports currently rely on unguessable URLs and installation-scoped management tokens rather than user accounts.
- Heuristic coverage can be incomplete; uncertain findings are labeled with confidence.
- The public data-use and storage policy is available at [susancalvin.org/data-policy](https://susancalvin.org/data-policy).
