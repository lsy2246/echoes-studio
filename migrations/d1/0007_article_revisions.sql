CREATE TABLE IF NOT EXISTS cms_article_revisions (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES cms_articles(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('repository', 'autosave', 'move', 'publish', 'restore', 'delete', 'create')),
  path TEXT NOT NULL,
  source TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  git_commit_sha TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cms_article_revisions_article_idx
  ON cms_article_revisions(article_id, created_at DESC, id DESC);
INSERT INTO cms_article_revisions
  (id, article_id, kind, path, source, content_hash, git_commit_sha, created_at)
SELECT 'baseline:' || id, id, 'repository', path, source, content_hash, git_commit_sha, updated_at
FROM cms_articles
WHERE NOT EXISTS (
  SELECT 1 FROM cms_article_revisions revision WHERE revision.article_id = cms_articles.id
);
INSERT INTO cms_schema_version(version, applied_at)
VALUES (7, CURRENT_TIMESTAMP) ON CONFLICT(version) DO NOTHING;
