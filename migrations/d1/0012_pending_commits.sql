CREATE TABLE IF NOT EXISTS cms_pending_commits (
  id TEXT PRIMARY KEY,
  message TEXT NOT NULL,
  changes_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cms_pending_commits_created_idx
  ON cms_pending_commits(created_at, id);

INSERT INTO cms_schema_version(version, applied_at)
VALUES (12, CURRENT_TIMESTAMP) ON CONFLICT(version) DO NOTHING;
