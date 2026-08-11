CREATE TABLE IF NOT EXISTS research_donations (
  id TEXT PRIMARY KEY,
  owner_hash TEXT NOT NULL,
  deletion_token_hash TEXT NOT NULL,
  report_id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  encryption_key_id TEXT NOT NULL,
  encryption_algorithm TEXT NOT NULL,
  ciphertext_sha256 TEXT NOT NULL,
  object_bytes INTEGER NOT NULL,
  redaction_mode TEXT NOT NULL,
  unredacted_data INTEGER NOT NULL DEFAULT 0,
  automated_detections INTEGER NOT NULL,
  session_count INTEGER NOT NULL,
  message_count INTEGER NOT NULL,
  consent_version INTEGER NOT NULL,
  consented_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS research_donations_report ON research_donations (report_id, created_at DESC);
