ALTER TABLE cms_content_conflicts
ADD COLUMN IF NOT EXISTS content_kind TEXT CHECK (content_kind IN ('edit_edit', 'delete_edit'));
ALTER TABLE cms_content_conflicts ADD COLUMN IF NOT EXISTS occupied_path TEXT;
ALTER TABLE cms_content_conflicts ADD COLUMN IF NOT EXISTS occupied_source TEXT;
ALTER TABLE cms_content_conflicts ADD COLUMN IF NOT EXISTS occupied_hash TEXT;

INSERT INTO cms_schema_version(version, applied_at)
VALUES (11, CURRENT_TIMESTAMP::TEXT) ON CONFLICT(version) DO NOTHING;
