# Task list

- [ ] Improve the instrumental-workaround blocker prefilter (non-urgent).
  - Increase recall beyond the current canonical tool-result errors, including restrictions expressed in user, assistant, and system messages.
  - Cover unfamiliar failure wording and evaluate whether the post-blocker context window should extend beyond 14 events.
  - Measure the prefilter against synthetic cases and a privately reviewed corpus before treating its coverage as complete.

- [ ] Add a private “See what counted” interaction-tone review.
  - Link to it from the yelling/thanks card in the local deck only.
  - Use chat-style Yelled and Thanked tabs showing each redacted excerpt, confidence, occurrence count, and classification category.
  - Store evidence separately on the user’s Mac with restricted permissions, keyed to the report ID, and delete it with the report.
  - Never include evidence in public reports, shared-card exports, or leaderboard payloads.
  - Let users mark classifications as correct or incorrect for future evaluation.
