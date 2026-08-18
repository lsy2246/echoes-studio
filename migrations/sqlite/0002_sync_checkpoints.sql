CREATE TABLE IF NOT EXISTS cms_sync_checkpoints (
  checkpoint_id TEXT PRIMARY KEY,
  commit_sha TEXT NOT NULL,
  checked_at TEXT NOT NULL
);
INSERT INTO cms_schema_version(version, applied_at) VALUES (2, CURRENT_TIMESTAMP)
ON CONFLICT(version) DO NOTHING;
