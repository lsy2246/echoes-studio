ALTER TABLE cms_system_settings
ADD COLUMN password_hash_iterations INTEGER NOT NULL DEFAULT 100000
CHECK (password_hash_iterations IN (100000, 150000, 210000));

INSERT INTO cms_schema_version(version, applied_at)
VALUES (10, CURRENT_TIMESTAMP) ON CONFLICT(version) DO NOTHING;
