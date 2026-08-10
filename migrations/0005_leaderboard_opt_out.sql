CREATE TABLE IF NOT EXISTS leaderboard_opt_outs (
  client_hash TEXT PRIMARY KEY,
  opted_out_at TEXT NOT NULL DEFAULT (datetime('now'))
);
