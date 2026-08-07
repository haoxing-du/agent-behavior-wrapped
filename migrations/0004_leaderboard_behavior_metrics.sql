ALTER TABLE leaderboard_entries ADD COLUMN grateful_messages INTEGER NOT NULL DEFAULT 0 CHECK (grateful_messages >= 0);
ALTER TABLE leaderboard_entries ADD COLUMN frustrated_messages INTEGER NOT NULL DEFAULT 0 CHECK (frustrated_messages >= 0);
ALTER TABLE leaderboard_entries ADD COLUMN instrumental_workarounds INTEGER NOT NULL DEFAULT 0 CHECK (instrumental_workarounds >= 0);

CREATE INDEX IF NOT EXISTS leaderboard_good_human_rank ON leaderboard_entries (public_ranked, grateful_messages DESC, frustrated_messages ASC);
CREATE INDEX IF NOT EXISTS leaderboard_workarounds_rank ON leaderboard_entries (public_ranked, instrumental_workarounds DESC);
