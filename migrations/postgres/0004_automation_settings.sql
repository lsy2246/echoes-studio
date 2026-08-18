CREATE TABLE IF NOT EXISTS cms_automation_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  auto_save_seconds INTEGER NOT NULL DEFAULT 1 CHECK (auto_save_seconds BETWEEN 1 AND 30),
  auto_sync_minutes INTEGER NOT NULL DEFAULT 15 CHECK (auto_sync_minutes BETWEEN 0 AND 1440),
  last_auto_sync_at TEXT,
  updated_at TEXT NOT NULL
);
INSERT INTO cms_automation_settings
  (id, auto_save_seconds, auto_sync_minutes, last_auto_sync_at, updated_at)
VALUES (1, 1, 15, NULL, CURRENT_TIMESTAMP::TEXT)
ON CONFLICT(id) DO NOTHING;
INSERT INTO cms_schema_version(version, applied_at) VALUES (4, CURRENT_TIMESTAMP::TEXT)
ON CONFLICT(version) DO NOTHING;
