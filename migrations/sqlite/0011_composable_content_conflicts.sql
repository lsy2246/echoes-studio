ALTER TABLE cms_content_conflicts
ADD COLUMN content_kind TEXT CHECK (content_kind IN ('edit_edit', 'delete_edit'));
ALTER TABLE cms_content_conflicts ADD COLUMN occupied_path TEXT;
ALTER TABLE cms_content_conflicts ADD COLUMN occupied_source TEXT;
ALTER TABLE cms_content_conflicts ADD COLUMN occupied_hash TEXT;

INSERT INTO cms_schema_version(version, applied_at)
VALUES (11, CURRENT_TIMESTAMP) ON CONFLICT(version) DO NOTHING;
