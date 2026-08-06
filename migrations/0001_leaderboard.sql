CREATE TABLE IF NOT EXISTS leaderboard_entries (
  client_hash TEXT PRIMARY KEY,
  display_name TEXT NOT NULL DEFAULT 'Anonymous',
  public_ranked INTEGER NOT NULL DEFAULT 0 CHECK (public_ranked IN (0, 1)),
  tokens INTEGER NOT NULL CHECK (tokens >= 0),
  agent_words INTEGER NOT NULL CHECK (agent_words >= 0),
  user_words INTEGER NOT NULL CHECK (user_words >= 0),
  word_ratio REAL NOT NULL CHECK (word_ratio >= 0),
  favorite_phrase TEXT,
  phrase_occurrences INTEGER NOT NULL DEFAULT 0 CHECK (phrase_occurrences >= 0),
  phrase_sessions INTEGER NOT NULL DEFAULT 0 CHECK (phrase_sessions >= 0),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS leaderboard_tokens_rank ON leaderboard_entries (public_ranked, tokens DESC);
CREATE INDEX IF NOT EXISTS leaderboard_ratio_rank ON leaderboard_entries (public_ranked, word_ratio DESC);
CREATE INDEX IF NOT EXISTS leaderboard_phrase_recent ON leaderboard_entries (updated_at DESC) WHERE favorite_phrase IS NOT NULL;

CREATE TABLE IF NOT EXISTS public_reports (
  id TEXT PRIMARY KEY,
  owner_hash TEXT NOT NULL,
  report_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS public_reports_owner ON public_reports (owner_hash, updated_at DESC);
