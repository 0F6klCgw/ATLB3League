-- The Points Deck (claimable bonus goals), moved off Google Sheets.
-- set_name is '' for a "Core" goal (no theme restriction) rather than NULL,
-- so client-side filtering/grouping doesn't need a null-check special case.
CREATE TABLE points_deck (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  pts        INTEGER NOT NULL CHECK (pts BETWEEN 1 AND 10),
  goal       TEXT NOT NULL CHECK (length(goal) BETWEEN 1 AND 500),
  set_name   TEXT NOT NULL DEFAULT '' CHECK (length(set_name) <= 100),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_points_deck_pts ON points_deck (pts);
CREATE INDEX idx_points_deck_set ON points_deck (set_name);
