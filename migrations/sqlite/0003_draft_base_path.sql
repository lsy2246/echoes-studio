ALTER TABLE cms_drafts ADD COLUMN base_path TEXT;
INSERT INTO cms_schema_version(version, applied_at) VALUES (3, CURRENT_TIMESTAMP)
ON CONFLICT(version) DO NOTHING;
