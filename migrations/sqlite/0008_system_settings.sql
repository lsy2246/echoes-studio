CREATE TABLE IF NOT EXISTS cms_system_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  repository_config_json TEXT,
  password_hash TEXT,
  updated_at TEXT NOT NULL
);
INSERT INTO cms_system_settings (id, repository_config_json, password_hash, updated_at)
VALUES (1, NULL, NULL, CURRENT_TIMESTAMP)
ON CONFLICT(id) DO NOTHING;
INSERT INTO cms_schema_version(version, applied_at)
VALUES (8, CURRENT_TIMESTAMP) ON CONFLICT(version) DO NOTHING;
