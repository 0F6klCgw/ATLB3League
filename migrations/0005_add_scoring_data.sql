-- Scoring rules move into D1 so they're editable from the admin center
-- (see admin.html's Scoring tab) instead of living in code.
--
-- point_submissions' existing per-item columns (draw, win_before_t6, ...)
-- are left exactly as they are — a frozen historical record of everything
-- submitted before this migration — rather than migrated or dropped. Since
-- an admin can now add/rename/delete scoring items at will, there's no
-- longer a fixed set of columns a submission could map onto anyway.
-- submission_points below is the source of truth for every submission
-- from this migration forward; nothing downstream (admin list, Commander
-- dashboard) ever read the old columns individually, only the aggregate
-- game_total/dq, so nothing breaks by leaving them frozen in place.
CREATE TABLE scoring_categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  kind       TEXT NOT NULL CHECK (kind IN ('pos', 'neg')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- val/dq are the current rule; a submission's actual awarded points are
-- snapshotted onto submission_points at submit time, so editing or
-- deleting an item here never rewrites the history of games already
-- played.
CREATE TABLE scoring_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES scoring_categories(id) ON DELETE CASCADE,
  val         INTEGER NOT NULL DEFAULT 0 CHECK (val BETWEEN -20 AND 20),
  dq          INTEGER NOT NULL DEFAULT 0 CHECK (dq IN (0, 1)),
  desc        TEXT NOT NULL CHECK (length(desc) BETWEEN 1 AND 500),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_scoring_items_category ON scoring_items (category_id);

-- One row per point (or DQ) a player actually earned in one game. item_id
-- goes NULL if the item is later deleted (ON DELETE SET NULL) — item_desc
-- is a snapshot, so the historical row still reads sensibly even then.
-- points_awarded's range is a coarse sanity bound, not an exact-value
-- CHECK — scoring items are admin-editable now, so that validation lives
-- in the Worker (checked against the live scoring_items table) rather
-- than a static constraint here.
CREATE TABLE submission_points (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  point_submission_id INTEGER NOT NULL REFERENCES point_submissions(id) ON DELETE CASCADE,
  item_id             INTEGER REFERENCES scoring_items(id) ON DELETE SET NULL,
  item_desc           TEXT NOT NULL,
  points_awarded      INTEGER NOT NULL DEFAULT 0 CHECK (points_awarded BETWEEN -20 AND 20),
  is_dq               INTEGER NOT NULL DEFAULT 0 CHECK (is_dq IN (0, 1)),
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_submission_points_submission ON submission_points (point_submission_id);
