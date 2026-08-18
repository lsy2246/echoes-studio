ALTER TABLE cms_system_settings ADD COLUMN installation_secret TEXT;
ALTER TABLE cms_system_settings ADD COLUMN internal_token TEXT;
INSERT INTO cms_schema_version(version, applied_at)
VALUES (9, CURRENT_TIMESTAMP) ON CONFLICT(version) DO NOTHING;
