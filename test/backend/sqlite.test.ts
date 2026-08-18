import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { sha256Text } from "../../src/core/hash";
import { createNodeSqliteDatabase } from "../../src/database/sqlite";

describe("Node SQLite adapter", async () => {
  const database = await createNodeSqliteDatabase(":memory:");
  after(() => database.close());

  it("runs migrations and enforces optimistic updates", async () => {
    assert.deepEqual(await database.health(), {
      ok: true,
      adapter: "node-sqlite",
      schemaVersion: 9,
    });
    assert.deepEqual(await database.getAutomationSettings(), {
      autoSaveSeconds: 1,
      autoSyncMinutes: 15,
      lastAutoSyncAt: null,
      updatedAt: (await database.getAutomationSettings()).updatedAt,
    });
    assert.deepEqual(await database.getSystemSettings(), {
      repositoryConfigJson: null,
      passwordHash: null,
      installationSecret: null,
      internalToken: null,
      updatedAt: (await database.getSystemSettings()).updatedAt,
    });
    const source = "---\ntitle: SQLite\n---\n\nHello\n";
    const article = await database.createArticle({
      id: "article-sqlite",
      path: "content/sqlite.md",
      format: "md",
      title: "SQLite",
      frontmatter: { title: "SQLite" },
      source,
      contentHash: await sha256Text(source),
      now: "2026-08-13T00:00:00.000Z",
    });
    assert.equal(article.version, 1);
    assert.equal(
      await database.updateArticle(article.id, {
        expectedVersion: 0,
        title: "stale",
        now: "2026-08-13T00:00:01.000Z",
      }),
      null,
    );
    assert.equal(
      (
        await database.updateArticle(article.id, {
          expectedVersion: 1,
          title: "updated",
          now: "2026-08-13T00:00:01.000Z",
        })
      )?.version,
      2,
    );
    const revision = await database.createArticleRevision({
      id: "revision-sqlite",
      articleId: article.id,
      kind: "create",
      path: article.path,
      source,
      contentHash: await sha256Text(source),
      now: "2026-08-13T00:00:02.000Z",
    });
    assert.equal(
      (await database.listArticleRevisions(article.id))[0]?.id,
      revision.id,
    );
  });

  it("upgrades an existing v5 draft table without deleting its data", async () => {
    const directory = await mkdtemp(join(tmpdir(), "echoes-studio-v5-"));
    const filename = join(directory, "studio.sqlite");
    const sqlite = (await import("node:sqlite")) as unknown as {
      DatabaseSync: new (filename: string) => {
        exec(sql: string): void;
        close(): void;
      };
    };
    const legacy = new sqlite.DatabaseSync(filename);
    legacy.exec(`
      CREATE TABLE cms_schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      INSERT INTO cms_schema_version(version, applied_at) VALUES (5, CURRENT_TIMESTAMP);
      CREATE TABLE cms_articles (
        id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE,
        format TEXT NOT NULL, title TEXT NOT NULL, frontmatter_json TEXT NOT NULL,
        source TEXT NOT NULL, content_hash TEXT NOT NULL, git_commit_sha TEXT,
        version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE cms_drafts (
        article_id TEXT PRIMARY KEY REFERENCES cms_articles(id) ON DELETE CASCADE,
        base_path TEXT, source TEXT NOT NULL, content_hash TEXT NOT NULL,
        base_content_hash TEXT, base_source TEXT, version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      INSERT INTO cms_articles (
        id, path, format, title, frontmatter_json, source, content_hash,
        git_commit_sha, version, created_at, updated_at
      ) VALUES (
        'legacy', 'content/legacy.md', 'md', 'Legacy', '{"title":"Legacy"}',
        '---\ntitle: Legacy\n---\n', 'hash', 'commit', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      );
      INSERT INTO cms_drafts (
        article_id, base_path, source, content_hash, base_content_hash,
        base_source, version, created_at, updated_at
      ) VALUES (
        'legacy', 'content/legacy.md', '---\ntitle: Legacy\n---\n\nDraft\n',
        'draft-hash', 'hash', '---\ntitle: Legacy\n---\n', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      );
    `);
    legacy.close();

    const upgraded = await createNodeSqliteDatabase(filename);
    try {
      assert.equal((await upgraded.health()).schemaVersion, 9);
      assert.equal((await upgraded.getDraft("legacy"))?.operation, "upsert");
    } finally {
      upgraded.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("reconciles dispatched publications during Git import", async () => {
    const article = (await database.getArticle("article-sqlite"))!;
    const source = `${article.source}\nMerged\n`;
    const contentHash = await sha256Text(source);
    const draft = (await database.upsertDraft({
      articleId: article.id,
      basePath: article.path,
      expectedVersion: null,
      source,
      contentHash,
      baseContentHash: article.contentHash,
      baseSource: article.source,
      now: "2026-08-13T00:01:00.000Z",
    }))!;
    const publication = await database.createPublication({
      id: "publication-sqlite",
      articleId: article.id,
      articlePath: article.path,
      source,
      contentHash,
      draftVersion: draft.version,
      now: "2026-08-13T00:02:00.000Z",
    });
    await database.markPublicationDispatched(
      publication.id,
      "2026-08-13T00:02:01.000Z",
    );
    const result = await database.importBatch({
      checkpointId: "sqlite-delivery",
      commitSha: "abcdef1234567890abcdef1234567890abcdef12",
      articles: [
        {
          path: article.path,
          format: "md",
          title: "SQLite",
          frontmatter: { title: "SQLite" },
          source,
          contentHash,
        },
      ],
      deletedPaths: [],
      now: "2026-08-13T00:03:00.000Z",
    });
    assert.equal(result.imported, 1);
    assert.equal(
      (await database.getPublication(publication.id))?.status,
      "published",
    );
    assert.equal(await database.getDraft(article.id), null);
  });
});
