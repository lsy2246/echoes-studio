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
      schemaVersion: 12,
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
      passwordHashIterations: 100_000,
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

  it("persists pending commits and only undoes the latest one", async () => {
    const change = {
      articleId: "article-sqlite",
      articleTitle: "SQLite",
      operation: "upsert" as const,
      path: "content/sqlite.md",
      previousPath: null,
      source: "---\ntitle: SQLite\n---\n\nQueued\n",
      contentHash: "queued-hash",
      basePath: null,
      baseContentHash: null,
      baseSource: null,
      draftVersion: 1,
    };
    await database.createPendingCommit({
      id: "pending-sqlite-1",
      message: "First local commit",
      changes: [change],
      now: "2026-08-13T00:00:03.000Z",
    });
    await database.createPendingCommit({
      id: "pending-sqlite-2",
      message: "Second local commit",
      changes: [{ ...change, contentHash: "queued-hash-2", draftVersion: 2 }],
      now: "2026-08-13T00:00:04.000Z",
    });

    assert.deepEqual(
      (await database.listPendingCommits()).map((commit) => commit.message),
      ["First local commit", "Second local commit"],
    );
    assert.equal(await database.deleteLatestPendingCommit("pending-sqlite-1"), false);
    assert.equal(await database.deleteLatestPendingCommit("pending-sqlite-2"), true);
    await database.deletePendingCommits(["pending-sqlite-1"]);
    assert.equal((await database.listPendingCommits()).length, 0);
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
      assert.equal((await upgraded.health()).schemaVersion, 12);
      assert.equal(
        (await upgraded.getSystemSettings()).passwordHashIterations,
        100_000,
      );
      assert.equal((await upgraded.getDraft("legacy"))?.operation, "upsert");
    } finally {
      upgraded.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("persists combined content and path conflict details", async () => {
    const conflict = await database.recordContentConflict({
      id: "combined-sqlite-conflict",
      articleId: "article-sqlite",
      issues: ["path_collision", "edit_edit"],
      basePath: "content/sqlite.md",
      baseSource: "base",
      baseHash: "base-hash",
      remotePath: "content/sqlite.md",
      remoteSource: "repository edit",
      remoteHash: "remote-hash",
      occupiedPath: "content/occupied.md",
      occupiedSource: "another article",
      occupiedHash: "occupied-hash",
      remoteCommitSha: "abcdef1234567890abcdef1234567890abcdef12",
      draftPath: "content/occupied.md",
      draftSource: "cms edit",
      draftHash: "draft-hash",
      draftVersion: 1,
      now: "2026-08-13T00:00:03.000Z",
    });

    assert.deepEqual(conflict.issues, ["path_collision", "edit_edit"]);
    assert.equal(conflict.remoteSource, "repository edit");
    assert.equal(conflict.occupiedSource, "another article");
    await database.resolveContentConflict(
      conflict.id,
      "merged",
      "2026-08-13T00:00:04.000Z",
    );
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
