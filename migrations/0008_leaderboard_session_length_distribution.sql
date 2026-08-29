CREATE TABLE IF NOT EXISTS leaderboard_session_length_distribution (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  distribution_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
