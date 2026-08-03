-- D1 schema for point_submissions.
-- Mirrors the Supabase table, but with CHECK constraints enforcing that
-- every scoring column can only ever be 0 or its known fixed value —
-- closes the "RLS always true" gap (see PROJECT_PLAN.md #2) at the
-- database layer, in addition to the Worker-side validation in src/index.js.
--
-- This is the schema as of initial creation. Later changes (e.g.
-- submitted_by_email) live as incremental files under migrations/ and
-- are also reflected here so this file stays an accurate full definition.

CREATE TABLE point_submissions (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id         TEXT NOT NULL,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  full_name             TEXT NOT NULL CHECK (length(full_name) BETWEEN 1 AND 80),
  league_date           TEXT,
  game                  INTEGER NOT NULL CHECK (game IN (1, 2, 3)),
  placement             INTEGER NOT NULL DEFAULT 0 CHECK (placement IN (0, 1, 2, 3, 4)),

  -- Standard + Rotating points (all worth +1)
  draw                  INTEGER NOT NULL DEFAULT 0 CHECK (draw IN (0, 1)),
  win_no_gc_solring     INTEGER NOT NULL DEFAULT 0 CHECK (win_no_gc_solring IN (0, 1)),
  alt_win               INTEGER NOT NULL DEFAULT 0 CHECK (alt_win IN (0, 1)),
  remove_counter_2plus  INTEGER NOT NULL DEFAULT 0 CHECK (remove_counter_2plus IN (0, 1)),
  stop_win              INTEGER NOT NULL DEFAULT 0 CHECK (stop_win IN (0, 1)),
  protect_player        INTEGER NOT NULL DEFAULT 0 CHECK (protect_player IN (0, 1)),
  cast_cmdr_4x          INTEGER NOT NULL DEFAULT 0 CHECK (cast_cmdr_4x IN (0, 1)),
  recent_ub_uw_cmdr     INTEGER NOT NULL DEFAULT 0 CHECK (recent_ub_uw_cmdr IN (0, 1)),
  seat4_loss_or_3pod    INTEGER NOT NULL DEFAULT 0 CHECK (seat4_loss_or_3pod IN (0, 1)),
  coolest_card          INTEGER NOT NULL DEFAULT 0 CHECK (coolest_card IN (0, 1)),
  convoke_improvise_2   INTEGER NOT NULL DEFAULT 0 CHECK (convoke_improvise_2 IN (0, 1)),
  team_creatures_5      INTEGER NOT NULL DEFAULT 0 CHECK (team_creatures_5 IN (0, 1)),
  prepared_adventure_3  INTEGER NOT NULL DEFAULT 0 CHECK (prepared_adventure_3 IN (0, 1)),
  lightning_bolted      INTEGER NOT NULL DEFAULT 0 CHECK (lightning_bolted IN (0, 1)),
  lightning_bolt_range  INTEGER NOT NULL DEFAULT 0 CHECK (lightning_bolt_range IN (0, 1)),

  -- Bad Guy points (fixed negative magnitudes)
  win_before_t6         INTEGER NOT NULL DEFAULT 0 CHECK (win_before_t6 IN (0, -4)),
  stax_4plus            INTEGER NOT NULL DEFAULT 0 CHECK (stax_4plus IN (0, -2)),
  infinite_combo_win    INTEGER NOT NULL DEFAULT 0 CHECK (infinite_combo_win IN (0, -1)),
  edhtop16_cmdr         INTEGER NOT NULL DEFAULT 0 CHECK (edhtop16_cmdr IN (0, -1)),
  infinite_loop_fail    INTEGER NOT NULL DEFAULT 0 CHECK (infinite_loop_fail IN (0, -6)),
  acted_jerk            INTEGER NOT NULL DEFAULT 0 CHECK (acted_jerk IN (0, -2)),

  -- Disqualification flags
  mass_land_denial      INTEGER NOT NULL DEFAULT 0 CHECK (mass_land_denial IN (0, 1)),
  banned_card           INTEGER NOT NULL DEFAULT 0 CHECK (banned_card IN (0, 1)),
  chain_extra_turns     INTEGER NOT NULL DEFAULT 0 CHECK (chain_extra_turns IN (0, 1)),
  dq                    INTEGER NOT NULL DEFAULT 0 CHECK (dq IN (0, 1)),

  game_total            INTEGER NOT NULL DEFAULT 0 CHECK (game_total BETWEEN -20 AND 20),

  -- The submitter's verified email, looked up server-side from their
  -- Clerk session (src/index.js) — never trusted from the client.
  submitted_by_email    TEXT NOT NULL DEFAULT 'legacy-import' CHECK (length(submitted_by_email) BETWEEN 1 AND 254),

  commander             TEXT CHECK (length(commander) <= 200),
  commander_scryfall_id TEXT CHECK (length(commander_scryfall_id) <= 64),
  commander_image_url   TEXT CHECK (length(commander_image_url) <= 500),
  partner               TEXT CHECK (length(partner) <= 200),
  partner_scryfall_id   TEXT CHECK (length(partner_scryfall_id) <= 64),
  partner_image_url     TEXT CHECK (length(partner_image_url) <= 500)
);

CREATE INDEX idx_point_submissions_submission_id ON point_submissions (submission_id);
CREATE INDEX idx_point_submissions_created_at ON point_submissions (created_at);

-- Audit trail for admin actions (currently: deleting a submission).
-- `details` holds a JSON snapshot of whatever was affected, so a mistaken
-- delete is at least recoverable by hand from this log even though the
-- underlying row is gone for good.
CREATE TABLE admin_audit_log (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  admin_user_id  TEXT NOT NULL,
  admin_email    TEXT NOT NULL,
  action         TEXT NOT NULL,
  target_table   TEXT NOT NULL,
  target_id      TEXT,
  details        TEXT
);

CREATE INDEX idx_admin_audit_log_created_at ON admin_audit_log (created_at);
