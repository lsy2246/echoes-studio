ALTER TABLE cms_system_settings ADD COLUMN IF NOT EXISTS installation_secret TEXT;
ALTER TABLE cms_system_settings ADD COLUMN IF NOT EXISTS internal_token TEXT;
INSERT INTO cms_schema_version(version, applied_at)
VALUES (9, CURRENT_TIMESTAMP::TEXT) ON CONFLICT(version) DO NOTHING;
