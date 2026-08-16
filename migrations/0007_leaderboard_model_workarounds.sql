CREATE TABLE IF NOT EXISTS leaderboard_model_workarounds (
  client_hash TEXT NOT NULL,
  model TEXT NOT NULL CHECK (length(model) BETWEEN 1 AND 80),
  detected_instances INTEGER NOT NULL CHECK (detected_instances > 0),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (client_hash, model)
);

CREATE INDEX IF NOT EXISTS leaderboard_model_workarounds_totals
  ON leaderboard_model_workarounds (model, detected_instances DESC);
