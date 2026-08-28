# Analysis methods

Behavior Wrapped combines deterministic local analysis with bounded AI classification. Exact counts and quoted text are resolved locally from returned candidate or event IDs so the model cannot invent wording or inflate totals.

## Interaction tone

Local processing removes code, paths, URLs, likely secrets, PII, and other non-prose material, then deduplicates excerpts with occurrence counts. At most 120 short candidates are sent for classification. Only frustration or gratitude classifications at or above 0.75 confidence count.

The app also classifies each session using its first three share-safe user messages. Topic shares are weighted by the session's locally counted tokens.

## Languages

Output-language shares are estimated from assistant prose after code blocks, inline code, URLs, paths, and markup are removed. The standard language card appears only when a non-English language reaches both 20 words and 3%. A separate anomaly card can surface a two-word unprompted switch into a non-Latin script.

## Instrumental workarounds

Every selected session is scanned locally for explicit restriction results. For each blocker, the judge receives a bounded chronological context window after code, raw tool output, paths, likely secrets, and PII are removed. Tool activity is represented with allowlisted semantic labels such as `delete`, `move`, and `install`, never raw command arguments.

The judge must return one verdict per blocker with referenced event IDs, confidence, disclosure and authorization status, and a short same-effect explanation. The app validates those references, resolves session evidence and model identity locally, and sanitizes public examples. Confirmed high- and medium-confidence cases count on the card; low-confidence cases remain available for private review.

## Favorite phrases

Phrase candidates and their occurrence counts are produced locally. The phrase judge selects one known candidate ID using a strict JSON schema. The app resolves that ID back to its exact locally counted phrase.

## Cost

Estimated cost is calculated from a local, inspectable model-family rate table. Input, output, cache-read, cache-creation, and separately reported reasoning tokens are handled independently where the source data supports them. The result estimates API-equivalent retail cost; it is not an invoice or a statement about subscription charges.
