CREATE TABLE IF NOT EXISTS research_donations (
  id TEXT PRIMARY KEY,
  owner_hash TEXT NOT NULL,
  report_id TEXT NOT NULL,
  donation_json TEXT NOT NULL,
  consented_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS research_donations_report ON research_donations (report_id, created_at DESC);
