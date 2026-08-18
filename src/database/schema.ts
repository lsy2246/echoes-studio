export const SQLITE_D1_SCHEMA_V1 = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS cms_schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cms_articles (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  format TEXT NOT NULL CHECK (format IN ('md', 'mdx')),
  title TEXT NOT NULL,
  frontmatter_json TEXT NOT NULL,
  source TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  git_commit_sha TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cms_articles_updated_idx ON cms_articles(updated_at DESC, id);

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

CREATE TABLE IF NOT EXISTS cms_drafts (
  article_id TEXT PRIMARY KEY REFERENCES cms_articles(id) ON DELETE CASCADE,
  operation TEXT NOT NULL DEFAULT 'upsert' CHECK (operation IN ('upsert', 'delete')),
  base_path TEXT,
  source TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  base_content_hash TEXT,
  base_source TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

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
CREATE INDEX IF NOT EXISTS cms_content_conflicts_open_idx
  ON cms_content_conflicts(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS cms_publications (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES cms_articles(id) ON DELETE CASCADE,
  article_path TEXT NOT NULL,
  source TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  draft_version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'dispatched', 'published', 'failed')),
  commit_sha TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS cms_publications_article_idx ON cms_publications(article_id, created_at DESC);
CREATE INDEX IF NOT EXISTS cms_publications_reconcile_idx ON cms_publications(article_path, content_hash, status);

CREATE TABLE IF NOT EXISTS cms_sync_checkpoints (
  checkpoint_id TEXT PRIMARY KEY,
  commit_sha TEXT NOT NULL,
  checked_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cms_automation_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  auto_save_seconds INTEGER NOT NULL DEFAULT 1 CHECK (auto_save_seconds BETWEEN 1 AND 30),
  auto_sync_minutes INTEGER NOT NULL DEFAULT 15 CHECK (auto_sync_minutes BETWEEN 0 AND 1440),
  last_auto_sync_at TEXT,
  updated_at TEXT NOT NULL
);
INSERT INTO cms_automation_settings
  (id, auto_save_seconds, auto_sync_minutes, last_auto_sync_at, updated_at)
VALUES (1, 1, 15, NULL, CURRENT_TIMESTAMP)
ON CONFLICT(id) DO NOTHING;

CREATE TABLE IF NOT EXISTS cms_system_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  repository_config_json TEXT,
  password_hash TEXT,
  installation_secret TEXT,
  internal_token TEXT,
  updated_at TEXT NOT NULL
);
INSERT INTO cms_system_settings (id, repository_config_json, password_hash, updated_at)
VALUES (1, NULL, NULL, CURRENT_TIMESTAMP)
ON CONFLICT(id) DO NOTHING;

INSERT INTO cms_schema_version(version, applied_at)
VALUES (9, CURRENT_TIMESTAMP) ON CONFLICT(version) DO NOTHING;
`;

export const POSTGRES_SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS cms_schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cms_articles (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  format TEXT NOT NULL CHECK (format IN ('md', 'mdx')),
  title TEXT NOT NULL,
  frontmatter_json JSONB NOT NULL,
  source TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  git_commit_sha TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cms_articles_updated_idx ON cms_articles(updated_at DESC, id);

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

CREATE TABLE IF NOT EXISTS cms_drafts (
  article_id TEXT PRIMARY KEY REFERENCES cms_articles(id) ON DELETE CASCADE,
  operation TEXT NOT NULL DEFAULT 'upsert' CHECK (operation IN ('upsert', 'delete')),
  base_path TEXT,
  source TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  base_content_hash TEXT,
  base_source TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

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
CREATE INDEX IF NOT EXISTS cms_content_conflicts_open_idx
  ON cms_content_conflicts(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS cms_publications (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES cms_articles(id) ON DELETE CASCADE,
  article_path TEXT NOT NULL,
  source TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  draft_version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'dispatched', 'published', 'failed')),
  commit_sha TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
ALTER TABLE cms_drafts ADD COLUMN IF NOT EXISTS base_path TEXT;
ALTER TABLE cms_drafts ADD COLUMN IF NOT EXISTS base_source TEXT;
ALTER TABLE cms_drafts ADD COLUMN IF NOT EXISTS operation TEXT NOT NULL DEFAULT 'upsert';
CREATE INDEX IF NOT EXISTS cms_publications_article_idx ON cms_publications(article_id, created_at DESC);
CREATE INDEX IF NOT EXISTS cms_publications_reconcile_idx ON cms_publications(article_path, content_hash, status);

CREATE TABLE IF NOT EXISTS cms_sync_checkpoints (
  checkpoint_id TEXT PRIMARY KEY,
  commit_sha TEXT NOT NULL,
  checked_at TEXT NOT NULL
);

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

CREATE TABLE IF NOT EXISTS cms_system_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  repository_config_json TEXT,
  password_hash TEXT,
  installation_secret TEXT,
  internal_token TEXT,
  updated_at TEXT NOT NULL
);
ALTER TABLE cms_system_settings ADD COLUMN IF NOT EXISTS installation_secret TEXT;
ALTER TABLE cms_system_settings ADD COLUMN IF NOT EXISTS internal_token TEXT;
INSERT INTO cms_system_settings (
  id, repository_config_json, password_hash, installation_secret, internal_token, updated_at
)
VALUES (1, NULL, NULL, NULL, NULL, CURRENT_TIMESTAMP::TEXT)
ON CONFLICT(id) DO NOTHING;

INSERT INTO cms_schema_version(version, applied_at)
VALUES (9, CURRENT_TIMESTAMP::TEXT) ON CONFLICT(version) DO NOTHING;
`;
