ALTER TABLE cms_drafts ADD COLUMN IF NOT EXISTS operation TEXT NOT NULL DEFAULT 'upsert'
  CHECK (operation IN ('upsert', 'delete'));

INSERT INTO cms_schema_version(version, applied_at)
VALUES (6, CURRENT_TIMESTAMP::TEXT) ON CONFLICT(version) DO NOTHING;
