ALTER TABLE cms_drafts ADD COLUMN IF NOT EXISTS base_source TEXT;
CREATE TABLE IF NOT EXISTS cms_content_conflicts (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES cms_articles(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('edit_edit', 'delete_edit', 'path_collision')),
  base_path TEXT, base_source TEXT, base_hash TEXT,
  remote_path TEXT, remote_source TEXT, remote_hash TEXT,
  remote_commit_sha TEXT NOT NULL,
  draft_path TEXT NOT NULL, draft_source TEXT NOT NULL, draft_hash TEXT NOT NULL,
  draft_version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'resolved')),
  resolution TEXT CHECK (resolution IN ('remote', 'cms', 'merged', 'converged')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS cms_content_conflicts_open_idx ON cms_content_conflicts(status, updated_at DESC);
INSERT INTO cms_schema_version(version, applied_at) VALUES (5, CURRENT_TIMESTAMP::TEXT)
ON CONFLICT(version) DO NOTHING;
