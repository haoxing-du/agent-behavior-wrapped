ALTER TABLE leaderboard_entries ADD COLUMN phrase_changed_at TEXT;

-- Historical phrase changes were not tracked; use the last known update.
UPDATE leaderboard_entries SET phrase_changed_at = updated_at;
