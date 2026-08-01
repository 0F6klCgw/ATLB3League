-- Adds the authenticated identity captured from Cloudflare Access
-- (Cf-Access-Authenticated-User-Email) to each submission. Existing rows
-- predate Access entirely, so they get a clear 'legacy-import' sentinel
-- rather than a fabricated email.
ALTER TABLE point_submissions
  ADD COLUMN submitted_by_email TEXT NOT NULL DEFAULT 'legacy-import'
  CHECK (length(submitted_by_email) BETWEEN 1 AND 254);
