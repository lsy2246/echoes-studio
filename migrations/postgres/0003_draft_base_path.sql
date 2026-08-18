ALTER TABLE cms_drafts ADD COLUMN IF NOT EXISTS base_path TEXT;
INSERT INTO cms_schema_version(version, applied_at) VALUES (3, CURRENT_TIMESTAMP::TEXT)
ON CONFLICT(version) DO NOTHING;
