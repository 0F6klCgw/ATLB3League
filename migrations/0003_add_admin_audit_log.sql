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
