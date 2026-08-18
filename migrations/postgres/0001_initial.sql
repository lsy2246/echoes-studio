CREATE TABLE IF NOT EXISTS cms_schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS cms_articles (
  id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE,
  format TEXT NOT NULL CHECK (format IN ('md', 'mdx')), title TEXT NOT NULL,
  frontmatter_json JSONB NOT NULL, source TEXT NOT NULL, content_hash TEXT NOT NULL,
  git_commit_sha TEXT, version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cms_articles_updated_idx ON cms_articles(updated_at DESC, id);
CREATE TABLE IF NOT EXISTS cms_drafts (
  article_id TEXT PRIMARY KEY REFERENCES cms_articles(id) ON DELETE CASCADE,
  source TEXT NOT NULL, content_hash TEXT NOT NULL, base_content_hash TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cms_publications (
  id TEXT PRIMARY KEY, article_id TEXT NOT NULL REFERENCES cms_articles(id) ON DELETE CASCADE,
  article_path TEXT NOT NULL, source TEXT NOT NULL, content_hash TEXT NOT NULL,
  draft_version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'dispatched', 'published', 'failed')),
  commit_sha TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT
);
CREATE INDEX IF NOT EXISTS cms_publications_article_idx ON cms_publications(article_id, created_at DESC);
CREATE INDEX IF NOT EXISTS cms_publications_reconcile_idx ON cms_publications(article_path, content_hash, status);
CREATE TABLE IF NOT EXISTS cms_webhook_deliveries (
  delivery_id TEXT PRIMARY KEY, commit_sha TEXT NOT NULL, received_at TEXT NOT NULL
);
INSERT INTO cms_schema_version(version, applied_at) VALUES (1, CURRENT_TIMESTAMP::TEXT)
ON CONFLICT(version) DO NOTHING;
