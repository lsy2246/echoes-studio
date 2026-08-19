import type { DatabasePort } from "../core/database-port";
import { conflict } from "../core/errors";
import {
  parseFrontmatter as parseSourceFrontmatter,
  titleFromFrontmatter,
} from "../core/frontmatter";
import type {
  Article,
  ArticleRevision,
  AutomationSettings,
  ContentConflict,
  ContentConflictResolution,
  ArticleListQuery,
  ArticleListResult,
  CompletePublicationInput,
  CreateArticleInput,
  CreateArticleRevisionInput,
  CreatePublicationInput,
  Draft,
  Frontmatter,
  HealthStatus,
  ImportBatchInput,
  ImportBatchResult,
  Publication,
  RecordContentConflictInput,
  UpdateArticleInput,
  UpsertDraftInput,
  UpdateAutomationSettingsInput,
  SystemSettings,
  UpdateSystemSettingsInput,
} from "../core/types";

export interface SqlRunResult {
  changes: number;
  lastInsertId?: string | number;
}

export interface SqlExecutor {
  all<T extends Record<string, unknown>>(
    sql: string,
    parameters?: unknown[],
  ): Promise<T[]>;
  run(sql: string, parameters?: unknown[]): Promise<SqlRunResult>;
  withTransaction<T>(
    operation: (executor: SqlExecutor) => Promise<T>,
  ): Promise<T>;
}

type SqlRow = Record<string, unknown>;

function text(row: SqlRow, key: string): string {
  const value = row[key];
  if (typeof value !== "string")
    throw new TypeError(`Invalid database column ${key}`);
  return value;
}

function nullableText(row: SqlRow, key: string): string | null {
  const value = row[key];
  return value === null || value === undefined ? null : String(value);
}

function integer(row: SqlRow, key: string): number {
  const value = Number(row[key]);
  if (!Number.isSafeInteger(value))
    throw new TypeError(`Invalid database column ${key}`);
  return value;
}

function parseFrontmatter(value: unknown): Frontmatter {
  if (typeof value === "object" && value !== null) return value as Frontmatter;
  if (typeof value !== "string") return {};
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new TypeError("Invalid frontmatter JSON in database");
  }
  return parsed as Frontmatter;
}

function mapArticle(row: SqlRow): Article {
  return {
    id: text(row, "id"),
    path: text(row, "path"),
    format: text(row, "format") as Article["format"],
    title: text(row, "title"),
    frontmatter: parseFrontmatter(row.frontmatter_json),
    source: text(row, "source"),
    contentHash: text(row, "content_hash"),
    gitCommitSha: nullableText(row, "git_commit_sha"),
    version: integer(row, "version"),
    createdAt: text(row, "created_at"),
    updatedAt: text(row, "updated_at"),
  };
}

function mapDraft(row: SqlRow): Draft {
  return {
    articleId: text(row, "article_id"),
    operation: (nullableText(row, "operation") ??
      "upsert") as Draft["operation"],
    basePath: nullableText(row, "base_path"),
    source: text(row, "source"),
    contentHash: text(row, "content_hash"),
    baseContentHash: nullableText(row, "base_content_hash"),
    baseSource: nullableText(row, "base_source"),
    version: integer(row, "version"),
    createdAt: text(row, "created_at"),
    updatedAt: text(row, "updated_at"),
  };
}

function mapArticleRevision(row: SqlRow): ArticleRevision {
  return {
    id: text(row, "id"),
    articleId: text(row, "article_id"),
    kind: text(row, "kind") as ArticleRevision["kind"],
    path: text(row, "path"),
    source: text(row, "source"),
    contentHash: text(row, "content_hash"),
    gitCommitSha: nullableText(row, "git_commit_sha"),
    createdAt: text(row, "created_at"),
  };
}

function mapContentConflict(row: SqlRow): ContentConflict {
  return {
    id: text(row, "id"),
    articleId: text(row, "article_id"),
    kind: text(row, "kind") as ContentConflict["kind"],
    basePath: nullableText(row, "base_path"),
    baseSource: nullableText(row, "base_source"),
    baseHash: nullableText(row, "base_hash"),
    remotePath: nullableText(row, "remote_path"),
    remoteSource: nullableText(row, "remote_source"),
    remoteHash: nullableText(row, "remote_hash"),
    remoteCommitSha: text(row, "remote_commit_sha"),
    draftPath: text(row, "draft_path"),
    draftSource: text(row, "draft_source"),
    draftHash: text(row, "draft_hash"),
    draftVersion: integer(row, "draft_version"),
    status: text(row, "status") as ContentConflict["status"],
    resolution: nullableText(
      row,
      "resolution",
    ) as ContentConflict["resolution"],
    createdAt: text(row, "created_at"),
    updatedAt: text(row, "updated_at"),
    resolvedAt: nullableText(row, "resolved_at"),
  };
}

function mapPublication(row: SqlRow): Publication {
  return {
    id: text(row, "id"),
    articleId: text(row, "article_id"),
    articlePath: text(row, "article_path"),
    source: text(row, "source"),
    contentHash: text(row, "content_hash"),
    draftVersion: integer(row, "draft_version"),
    status: text(row, "status") as Publication["status"],
    commitSha: nullableText(row, "commit_sha"),
    error: nullableText(row, "error"),
    createdAt: text(row, "created_at"),
    updatedAt: text(row, "updated_at"),
    completedAt: nullableText(row, "completed_at"),
  };
}

function mapAutomationSettings(row: SqlRow): AutomationSettings {
  return {
    autoSaveSeconds: integer(row, "auto_save_seconds"),
    autoSyncMinutes: integer(row, "auto_sync_minutes"),
    lastAutoSyncAt: nullableText(row, "last_auto_sync_at"),
    updatedAt: text(row, "updated_at"),
  };
}

function isUniqueError(error: unknown): boolean {
  const candidate = error as { code?: string; message?: string };
  return (
    candidate?.code === "23505" ||
    /unique|constraint/i.test(candidate?.message ?? "")
  );
}

export class SqlDatabase implements DatabasePort {
  constructor(
    protected readonly executor: SqlExecutor,
    readonly adapterName: string,
  ) {}

  async health(): Promise<HealthStatus> {
    try {
      const rows = await this.executor.all<{ version: unknown }>(
        "SELECT version FROM cms_schema_version ORDER BY version DESC LIMIT 1",
      );
      return {
        ok: true,
        adapter: this.adapterName,
        schemaVersion: rows.length ? Number(rows[0].version) : 0,
      };
    } catch {
      return { ok: false, adapter: this.adapterName, schemaVersion: 0 };
    }
  }

  async getAutomationSettings(): Promise<AutomationSettings> {
    const rows = await this.executor.all(
      "SELECT * FROM cms_automation_settings WHERE id = 1 LIMIT 1",
    );
    if (!rows[0]) throw new Error("Automation settings row is missing");
    return mapAutomationSettings(rows[0]);
  }

  async updateAutomationSettings(
    input: UpdateAutomationSettingsInput,
  ): Promise<AutomationSettings> {
    const current = await this.getAutomationSettings();
    await this.executor.run(
      `UPDATE cms_automation_settings
       SET auto_save_seconds = ?, auto_sync_minutes = ?, last_auto_sync_at = ?, updated_at = ?
       WHERE id = 1`,
      [
        input.autoSaveSeconds ?? current.autoSaveSeconds,
        input.autoSyncMinutes ?? current.autoSyncMinutes,
        input.lastAutoSyncAt === undefined
          ? current.lastAutoSyncAt
          : input.lastAutoSyncAt,
        input.now,
      ],
    );
    return this.getAutomationSettings();
  }

  async getSystemSettings(): Promise<SystemSettings> {
    const rows = await this.executor.all(
      "SELECT * FROM cms_system_settings WHERE id = 1 LIMIT 1",
    );
    if (!rows[0]) throw new Error("System settings row is missing");
    return {
      repositoryConfigJson: nullableText(rows[0], "repository_config_json"),
      passwordHash: nullableText(rows[0], "password_hash"),
      passwordHashIterations: integer(rows[0], "password_hash_iterations"),
      installationSecret: nullableText(rows[0], "installation_secret"),
      internalToken: nullableText(rows[0], "internal_token"),
      updatedAt: text(rows[0], "updated_at"),
    };
  }

  async updateSystemSettings(
    input: UpdateSystemSettingsInput,
  ): Promise<SystemSettings> {
    const current = await this.getSystemSettings();
    await this.executor.run(
      `UPDATE cms_system_settings
       SET repository_config_json = ?, password_hash = ?, password_hash_iterations = ?, installation_secret = ?, internal_token = ?, updated_at = ?
       WHERE id = 1`,
      [
        input.repositoryConfigJson === undefined
          ? current.repositoryConfigJson
          : input.repositoryConfigJson,
        input.passwordHash === undefined
          ? current.passwordHash
          : input.passwordHash,
        input.passwordHashIterations === undefined
          ? current.passwordHashIterations
          : input.passwordHashIterations,
        input.installationSecret === undefined
          ? current.installationSecret
          : input.installationSecret,
        input.internalToken === undefined
          ? current.internalToken
          : input.internalToken,
        input.now,
      ],
    );
    return this.getSystemSettings();
  }

  async listArticles(query: ArticleListQuery): Promise<ArticleListResult> {
    const parameters: unknown[] = [];
    const conditions: string[] = [];
    if (query.search) {
      conditions.push("(LOWER(title) LIKE ? OR LOWER(path) LIKE ?)");
      const needle = `%${query.search.toLocaleLowerCase().replace(/[\\%_]/g, "\\$&")}%`;
      parameters.push(needle, needle);
    }
    if (query.cursor) {
      const cursor = await this.getArticle(query.cursor);
      if (cursor) {
        conditions.push("(updated_at < ? OR (updated_at = ? AND id > ?))");
        parameters.push(cursor.updatedAt, cursor.updatedAt, cursor.id);
      }
    }
    parameters.push(query.limit + 1);
    const rows = await this.executor.all(
      `SELECT * FROM cms_articles ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
       ORDER BY updated_at DESC, id ASC LIMIT ?`,
      parameters,
    );
    const items = rows.slice(0, query.limit).map(mapArticle);
    return {
      items,
      nextCursor: rows.length > query.limit ? (items.at(-1)?.id ?? null) : null,
    };
  }

  async getArticle(id: string): Promise<Article | null> {
    const rows = await this.executor.all(
      "SELECT * FROM cms_articles WHERE id = ? LIMIT 1",
      [id],
    );
    return rows[0] ? mapArticle(rows[0]) : null;
  }

  async getArticleByPath(path: string): Promise<Article | null> {
    const rows = await this.executor.all(
      "SELECT * FROM cms_articles WHERE path = ? LIMIT 1",
      [path],
    );
    return rows[0] ? mapArticle(rows[0]) : null;
  }

  async createArticle(input: CreateArticleInput): Promise<Article> {
    try {
      await this.executor.run(
        `INSERT INTO cms_articles
         (id, path, format, title, frontmatter_json, source, content_hash, git_commit_sha,
          version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [
          input.id,
          input.path,
          input.format,
          input.title,
          JSON.stringify(input.frontmatter),
          input.source,
          input.contentHash,
          input.gitCommitSha ?? null,
          input.now,
          input.now,
        ],
      );
    } catch (error) {
      if (isUniqueError(error))
        throw conflict("Article id or path already exists");
      throw error;
    }
    return (await this.getArticle(input.id))!;
  }

  async updateArticle(
    id: string,
    input: UpdateArticleInput,
  ): Promise<Article | null> {
    const current = await this.getArticle(id);
    if (!current || current.version !== input.expectedVersion) return null;
    const fields: string[] = [];
    const parameters: unknown[] = [];
    const add = (column: string, value: unknown) => {
      fields.push(`${column} = ?`);
      parameters.push(value);
    };
    if (input.path !== undefined) add("path", input.path);
    if (input.format !== undefined) add("format", input.format);
    if (input.title !== undefined) add("title", input.title);
    if (input.frontmatter !== undefined)
      add("frontmatter_json", JSON.stringify(input.frontmatter));
    if (input.source !== undefined) add("source", input.source);
    if (input.contentHash !== undefined) add("content_hash", input.contentHash);
    if (input.gitCommitSha !== undefined)
      add("git_commit_sha", input.gitCommitSha);
    add("updated_at", input.now);
    fields.push("version = version + 1");
    parameters.push(id, input.expectedVersion);
    try {
      const result = await this.executor.run(
        `UPDATE cms_articles SET ${fields.join(", ")} WHERE id = ? AND version = ?`,
        parameters,
      );
      if (result.changes !== 1) return null;
    } catch (error) {
      if (isUniqueError(error)) throw conflict("Article path already exists");
      throw error;
    }
    return this.getArticle(id);
  }

  async deleteArticle(id: string, expectedVersion: number): Promise<boolean> {
    const result = await this.executor.run(
      "DELETE FROM cms_articles WHERE id = ? AND version = ?",
      [id, expectedVersion],
    );
    return result.changes === 1;
  }

  async listArticleRevisions(
    articleId: string,
    limit = 100,
  ): Promise<ArticleRevision[]> {
    const safeLimit = Math.max(1, Math.min(limit, 200));
    const rows = await this.executor.all(
      `SELECT * FROM cms_article_revisions WHERE article_id = ?
       ORDER BY created_at DESC, id DESC LIMIT ?`,
      [articleId, safeLimit],
    );
    return rows.map(mapArticleRevision);
  }

  async getArticleRevision(id: string): Promise<ArticleRevision | null> {
    const rows = await this.executor.all(
      "SELECT * FROM cms_article_revisions WHERE id = ? LIMIT 1",
      [id],
    );
    return rows[0] ? mapArticleRevision(rows[0]) : null;
  }

  async createArticleRevision(
    input: CreateArticleRevisionInput,
  ): Promise<ArticleRevision> {
    await this.executor.run(
      `INSERT INTO cms_article_revisions
       (id, article_id, kind, path, source, content_hash, git_commit_sha, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.id,
        input.articleId,
        input.kind,
        input.path,
        input.source,
        input.contentHash,
        input.gitCommitSha ?? null,
        input.now,
      ],
    );
    return (await this.getArticleRevision(input.id))!;
  }

  async getDraft(articleId: string): Promise<Draft | null> {
    const rows = await this.executor.all(
      "SELECT * FROM cms_drafts WHERE article_id = ? LIMIT 1",
      [articleId],
    );
    return rows[0] ? mapDraft(rows[0]) : null;
  }

  async upsertDraft(input: UpsertDraftInput): Promise<Draft | null> {
    const current = await this.getDraft(input.articleId);
    if (!current) {
      if (input.expectedVersion !== null && input.expectedVersion !== 0)
        return null;
      const result = await this.executor.run(
        `INSERT INTO cms_drafts
         (article_id, operation, base_path, source, content_hash, base_content_hash, base_source, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?) ON CONFLICT (article_id) DO NOTHING`,
        [
          input.articleId,
          input.operation ?? "upsert",
          input.basePath,
          input.source,
          input.contentHash,
          input.baseContentHash,
          input.baseSource,
          input.now,
          input.now,
        ],
      );
      return result.changes === 1 ? this.getDraft(input.articleId) : null;
    }
    if (input.expectedVersion !== current.version) return null;
    const result = await this.executor.run(
      `UPDATE cms_drafts SET operation = ?, base_path = ?, source = ?, content_hash = ?, base_content_hash = ?, base_source = ?,
       version = version + 1, updated_at = ? WHERE article_id = ? AND version = ?`,
      [
        input.operation ?? "upsert",
        input.basePath,
        input.source,
        input.contentHash,
        input.baseContentHash,
        input.baseSource,
        input.now,
        input.articleId,
        input.expectedVersion,
      ],
    );
    return result.changes === 1 ? this.getDraft(input.articleId) : null;
  }

  async deleteDraft(
    articleId: string,
    expectedVersion: number,
  ): Promise<boolean> {
    const result = await this.executor.run(
      "DELETE FROM cms_drafts WHERE article_id = ? AND version = ?",
      [articleId, expectedVersion],
    );
    return result.changes === 1;
  }

  async listContentConflicts(): Promise<ContentConflict[]> {
    const rows = await this.executor.all(
      "SELECT * FROM cms_content_conflicts WHERE status = 'open' ORDER BY updated_at DESC",
    );
    return rows.map(mapContentConflict);
  }

  async getContentConflict(id: string): Promise<ContentConflict | null> {
    const rows = await this.executor.all(
      "SELECT * FROM cms_content_conflicts WHERE id = ? LIMIT 1",
      [id],
    );
    return rows[0] ? mapContentConflict(rows[0]) : null;
  }

  async getOpenContentConflictByArticle(
    articleId: string,
  ): Promise<ContentConflict | null> {
    const rows = await this.executor.all(
      "SELECT * FROM cms_content_conflicts WHERE article_id = ? AND status = 'open' ORDER BY updated_at DESC LIMIT 1",
      [articleId],
    );
    return rows[0] ? mapContentConflict(rows[0]) : null;
  }

  async recordContentConflict(
    input: RecordContentConflictInput,
  ): Promise<ContentConflict> {
    const existing = await this.getOpenContentConflictByArticle(
      input.articleId,
    );
    if (existing) {
      await this.executor.run(
        `UPDATE cms_content_conflicts SET kind = ?, base_path = ?, base_source = ?, base_hash = ?,
         remote_path = ?, remote_source = ?, remote_hash = ?, remote_commit_sha = ?, draft_path = ?,
         draft_source = ?, draft_hash = ?, draft_version = ?, updated_at = ? WHERE id = ?`,
        [
          input.kind,
          input.basePath,
          input.baseSource,
          input.baseHash,
          input.remotePath,
          input.remoteSource,
          input.remoteHash,
          input.remoteCommitSha,
          input.draftPath,
          input.draftSource,
          input.draftHash,
          input.draftVersion,
          input.now,
          existing.id,
        ],
      );
      return (await this.getContentConflict(existing.id))!;
    }
    await this.executor.run(
      `INSERT INTO cms_content_conflicts
       (id, article_id, kind, base_path, base_source, base_hash, remote_path, remote_source,
        remote_hash, remote_commit_sha, draft_path, draft_source, draft_hash, draft_version,
        status, resolution, created_at, updated_at, resolved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', NULL, ?, ?, NULL)`,
      [
        input.id,
        input.articleId,
        input.kind,
        input.basePath,
        input.baseSource,
        input.baseHash,
        input.remotePath,
        input.remoteSource,
        input.remoteHash,
        input.remoteCommitSha,
        input.draftPath,
        input.draftSource,
        input.draftHash,
        input.draftVersion,
        input.now,
        input.now,
      ],
    );
    return (await this.getContentConflict(input.id))!;
  }

  async resolveContentConflict(
    id: string,
    resolution: ContentConflictResolution,
    now: string,
  ): Promise<ContentConflict | null> {
    const result = await this.executor.run(
      `UPDATE cms_content_conflicts SET status = 'resolved', resolution = ?, updated_at = ?, resolved_at = ?
       WHERE id = ? AND status = 'open'`,
      [resolution, now, now, id],
    );
    return result.changes === 1 ? this.getContentConflict(id) : null;
  }

  async createPublication(input: CreatePublicationInput): Promise<Publication> {
    await this.executor.run(
      `INSERT INTO cms_publications
       (id, article_id, article_path, source, content_hash, draft_version, status,
        commit_sha, error, created_at, updated_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, ?, ?, NULL)`,
      [
        input.id,
        input.articleId,
        input.articlePath,
        input.source,
        input.contentHash,
        input.draftVersion,
        input.now,
        input.now,
      ],
    );
    return (await this.getPublication(input.id))!;
  }

  async getPublication(id: string): Promise<Publication | null> {
    const rows = await this.executor.all(
      "SELECT * FROM cms_publications WHERE id = ? LIMIT 1",
      [id],
    );
    return rows[0] ? mapPublication(rows[0]) : null;
  }

  async markPublicationDispatched(id: string, now: string): Promise<void> {
    await this.executor.run(
      "UPDATE cms_publications SET status = 'dispatched', updated_at = ? WHERE id = ? AND status = 'pending'",
      [now, id],
    );
  }

  async completePublication(
    input: CompletePublicationInput,
  ): Promise<Publication | null> {
    return this.executor.withTransaction(async (executor) => {
      const scoped = new SqlDatabase(executor, this.adapterName);
      const current = await scoped.getPublication(input.id);
      if (!current) return null;
      if (current.status === "published" || current.status === "failed") {
        const same =
          current.status === input.status &&
          (input.contentHash === undefined ||
            input.contentHash === current.contentHash) &&
          (input.commitSha === undefined ||
            input.commitSha === current.commitSha);
        if (!same)
          throw conflict("Publication already completed with different result");
        return current;
      }
      if (input.contentHash && input.contentHash !== current.contentHash) {
        throw conflict(
          "Published content hash does not match publication snapshot",
        );
      }
      const updated = await executor.run(
        `UPDATE cms_publications SET status = ?, commit_sha = ?, error = ?,
         updated_at = ?, completed_at = ? WHERE id = ? AND status IN ('pending', 'dispatched')`,
        [
          input.status,
          input.commitSha ?? null,
          input.error?.slice(0, 4000) ?? null,
          input.now,
          input.now,
          input.id,
        ],
      );
      if (updated.changes !== 1)
        throw conflict("Publication was completed concurrently");
      if (input.status === "published") {
        const parsed = parseSourceFrontmatter(current.source);
        await executor.run(
          `UPDATE cms_articles SET path = ?, format = ?, title = ?, frontmatter_json = ?, source = ?, content_hash = ?,
           git_commit_sha = COALESCE(?, git_commit_sha), version = version + 1,
           updated_at = ? WHERE id = ?`,
          [
            current.articlePath,
            current.articlePath.toLowerCase().endsWith(".mdx") ? "mdx" : "md",
            titleFromFrontmatter(parsed.frontmatter, current.articlePath),
            JSON.stringify(parsed.frontmatter),
            current.source,
            current.contentHash,
            input.commitSha ?? null,
            input.now,
            current.articleId,
          ],
        );
        await executor.run(
          "DELETE FROM cms_drafts WHERE article_id = ? AND version = ?",
          [current.articleId, current.draftVersion],
        );
      }
      return scoped.getPublication(input.id);
    });
  }

  async importBatch(input: ImportBatchInput): Promise<ImportBatchResult> {
    try {
      return await this.executor.withTransaction(async (executor) => {
        const checkpoint = await executor.run(
          `INSERT INTO cms_sync_checkpoints (checkpoint_id, commit_sha, checked_at)
           VALUES (?, ?, ?) ON CONFLICT (checkpoint_id) DO NOTHING`,
          [input.checkpointId, input.commitSha, input.now],
        );
        if (checkpoint.changes !== 1) {
          return { duplicate: true, imported: 0, deleted: 0, conflicts: [] };
        }
        const scoped = new SqlDatabase(executor, this.adapterName);
        let imported = 0;
        let deleted = 0;
        const conflicts: ImportBatchResult["conflicts"] = [];
        for (const item of input.articles) {
          const existing = await scoped.getArticleByPath(item.path);
          if (!existing) {
            const created = await scoped.createArticle({
              ...item,
              id: crypto.randomUUID(),
              gitCommitSha: input.commitSha,
              now: input.now,
            });
            await scoped.createArticleRevision({
              id: crypto.randomUUID(),
              articleId: created.id,
              kind: "repository",
              path: item.path,
              source: item.source,
              contentHash: item.contentHash,
              gitCommitSha: input.commitSha,
              now: input.now,
            });
            imported += 1;
          } else {
            const draft = await scoped.getDraft(existing.id);
            const baseHash = draft?.baseContentHash ?? existing.contentHash;
            if (
              draft &&
              draft.contentHash !== baseHash &&
              item.contentHash !== baseHash &&
              draft.contentHash !== item.contentHash
            ) {
              const recorded = await scoped.recordContentConflict({
                id: crypto.randomUUID(),
                articleId: existing.id,
                kind: "edit_edit",
                basePath: draft.basePath,
                baseSource: draft.baseSource,
                baseHash,
                remotePath: item.path,
                remoteSource: item.source,
                remoteHash: item.contentHash,
                remoteCommitSha: input.commitSha,
                draftPath: existing.path,
                draftSource: draft.source,
                draftHash: draft.contentHash,
                draftVersion: draft.version,
                now: input.now,
              });
              conflicts.push({
                id: recorded.id,
                articleId: existing.id,
                path: item.path,
                reason: "draft_and_git_changed",
              });
            }
            const updated = await scoped.updateArticle(existing.id, {
              expectedVersion: existing.version,
              format: item.format,
              title: item.title,
              frontmatter: item.frontmatter,
              source: item.source,
              contentHash: item.contentHash,
              gitCommitSha: input.commitSha,
              now: input.now,
            });
            if (!updated)
              throw conflict("Article changed concurrently during import");
            const latest = (
              await scoped.listArticleRevisions(existing.id, 1)
            )[0];
            if (
              !latest ||
              latest.contentHash !== item.contentHash ||
              latest.path !== item.path ||
              latest.kind !== "repository"
            ) {
              await scoped.createArticleRevision({
                id: crypto.randomUUID(),
                articleId: existing.id,
                kind: "repository",
                path: item.path,
                source: item.source,
                contentHash: item.contentHash,
                gitCommitSha: input.commitSha,
                now: input.now,
              });
            }
            if (
              draft &&
              (item.contentHash === draft.contentHash ||
                item.contentHash === baseHash)
            ) {
              const open = await scoped.getOpenContentConflictByArticle(
                existing.id,
              );
              if (open)
                await scoped.resolveContentConflict(
                  open.id,
                  "converged",
                  input.now,
                );
              if (item.contentHash === draft.contentHash) {
                await executor.run(
                  "DELETE FROM cms_drafts WHERE article_id = ? AND version = ?",
                  [existing.id, draft.version],
                );
              }
            }
            imported += 1;
          }

          // A later service-owned snapshot confirms that the publication branch
          // reached the configured content branch. Reconcile it transactionally.
          const matching = await executor.all<{
            id: unknown;
            article_id: unknown;
            draft_version: unknown;
          }>(
            `SELECT id, article_id, draft_version FROM cms_publications
             WHERE article_path = ? AND content_hash = ? AND status = 'dispatched'`,
            [item.path, item.contentHash],
          );
          if (matching.length) {
            await executor.run(
              `UPDATE cms_publications SET status = 'published', commit_sha = ?, error = NULL,
               updated_at = ?, completed_at = ?
               WHERE article_path = ? AND content_hash = ? AND status = 'dispatched'`,
              [
                input.commitSha,
                input.now,
                input.now,
                item.path,
                item.contentHash,
              ],
            );
            for (const publication of matching) {
              await executor.run(
                "DELETE FROM cms_drafts WHERE article_id = ? AND version = ?",
                [
                  String(publication.article_id),
                  Number(publication.draft_version),
                ],
              );
            }
          }
        }
        for (const path of input.deletedPaths) {
          const existing = await scoped.getArticleByPath(path);
          if (!existing) continue;
          if (await scoped.getDraft(existing.id)) {
            const draft = (await scoped.getDraft(existing.id))!;
            const recorded = await scoped.recordContentConflict({
              id: crypto.randomUUID(),
              articleId: existing.id,
              kind: "delete_edit",
              basePath: draft.basePath,
              baseSource: draft.baseSource,
              baseHash: draft.baseContentHash,
              remotePath: null,
              remoteSource: null,
              remoteHash: null,
              remoteCommitSha: input.commitSha,
              draftPath: existing.path,
              draftSource: draft.source,
              draftHash: draft.contentHash,
              draftVersion: draft.version,
              now: input.now,
            });
            conflicts.push({
              id: recorded.id,
              articleId: existing.id,
              path,
              reason: "git_deleted_with_local_draft",
            });
            continue;
          }
          if (await scoped.deleteArticle(existing.id, existing.version))
            deleted += 1;
        }
        return { duplicate: false, imported, deleted, conflicts };
      });
    } catch (error) {
      // Interactive transactions are unavailable in D1. Remove the checkpoint
      // reservation after a partial failure so the idempotent upserts can retry.
      // Transactional adapters have already rolled back, making this a no-op.
      try {
        await this.executor.run(
          "DELETE FROM cms_sync_checkpoints WHERE checkpoint_id = ? AND commit_sha = ?",
          [input.checkpointId, input.commitSha],
        );
      } catch {
        // Preserve the original failure; recovery jobs can remove the key later.
      }
      throw error;
    }
  }
}
