import type { DatabasePort } from "../core/database-port";
import { conflict } from "../core/errors";
import { parseFrontmatter, titleFromFrontmatter } from "../core/frontmatter";
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

const clone = <T>(value: T): T => structuredClone(value);

export class MemoryDatabase implements DatabasePort {
  readonly adapterName = "memory";
  private readonly articles = new Map<string, Article>();
  private readonly articleIdsByPath = new Map<string, string>();
  private readonly drafts = new Map<string, Draft>();
  private readonly articleRevisions = new Map<string, ArticleRevision>();
  private readonly publications = new Map<string, Publication>();
  private readonly contentConflicts = new Map<string, ContentConflict>();
  private readonly syncCheckpoints = new Set<string>();
  private automationSettings: AutomationSettings = {
    autoSaveSeconds: 1,
    autoSyncMinutes: 15,
    lastAutoSyncAt: null,
    updatedAt: new Date(0).toISOString(),
  };
  private systemSettings: SystemSettings = {
    repositoryConfigJson: null,
    passwordHash: null,
    passwordHashIterations: 100_000,
    installationSecret: null,
    internalToken: null,
    updatedAt: new Date(0).toISOString(),
  };

  async health(): Promise<HealthStatus> {
    return { ok: true, adapter: this.adapterName, schemaVersion: 1 };
  }

  async getAutomationSettings(): Promise<AutomationSettings> {
    return clone(this.automationSettings);
  }

  async updateAutomationSettings(
    input: UpdateAutomationSettingsInput,
  ): Promise<AutomationSettings> {
    this.automationSettings = {
      ...this.automationSettings,
      ...(input.autoSaveSeconds === undefined
        ? {}
        : { autoSaveSeconds: input.autoSaveSeconds }),
      ...(input.autoSyncMinutes === undefined
        ? {}
        : { autoSyncMinutes: input.autoSyncMinutes }),
      ...(input.lastAutoSyncAt === undefined
        ? {}
        : { lastAutoSyncAt: input.lastAutoSyncAt }),
      updatedAt: input.now,
    };
    return clone(this.automationSettings);
  }

  async getSystemSettings(): Promise<SystemSettings> {
    return clone(this.systemSettings);
  }

  async updateSystemSettings(
    input: UpdateSystemSettingsInput,
  ): Promise<SystemSettings> {
    this.systemSettings = {
      repositoryConfigJson:
        input.repositoryConfigJson === undefined
          ? this.systemSettings.repositoryConfigJson
          : input.repositoryConfigJson,
      passwordHash:
        input.passwordHash === undefined
          ? this.systemSettings.passwordHash
          : input.passwordHash,
      passwordHashIterations:
        input.passwordHashIterations === undefined
          ? this.systemSettings.passwordHashIterations
          : input.passwordHashIterations,
      installationSecret:
        input.installationSecret === undefined
          ? this.systemSettings.installationSecret
          : input.installationSecret,
      internalToken:
        input.internalToken === undefined
          ? this.systemSettings.internalToken
          : input.internalToken,
      updatedAt: input.now,
    };
    return clone(this.systemSettings);
  }

  async listArticles(query: ArticleListQuery): Promise<ArticleListResult> {
    const normalizedSearch = query.search?.trim().toLocaleLowerCase();
    let items = [...this.articles.values()]
      .filter(
        (article) =>
          !normalizedSearch ||
          article.title.toLocaleLowerCase().includes(normalizedSearch) ||
          article.path.toLocaleLowerCase().includes(normalizedSearch),
      )
      .sort(
        (left, right) =>
          right.updatedAt.localeCompare(left.updatedAt) ||
          left.id.localeCompare(right.id),
      );
    if (query.cursor) {
      const index = items.findIndex((article) => article.id === query.cursor);
      if (index >= 0) items = items.slice(index + 1);
    }
    const page = items.slice(0, query.limit);
    return {
      items: clone(page),
      nextCursor: items.length > query.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async getArticle(id: string): Promise<Article | null> {
    const article = this.articles.get(id);
    return article ? clone(article) : null;
  }

  async getArticleByPath(path: string): Promise<Article | null> {
    const id = this.articleIdsByPath.get(path);
    return id ? this.getArticle(id) : null;
  }

  async createArticle(input: CreateArticleInput): Promise<Article> {
    if (this.articles.has(input.id) || this.articleIdsByPath.has(input.path)) {
      throw conflict("Article id or path already exists");
    }
    const article: Article = {
      id: input.id,
      path: input.path,
      format: input.format,
      title: input.title,
      frontmatter: clone(input.frontmatter),
      source: input.source,
      contentHash: input.contentHash,
      gitCommitSha: input.gitCommitSha ?? null,
      version: 1,
      createdAt: input.now,
      updatedAt: input.now,
    };
    this.articles.set(article.id, article);
    this.articleIdsByPath.set(article.path, article.id);
    return clone(article);
  }

  async updateArticle(
    id: string,
    input: UpdateArticleInput,
  ): Promise<Article | null> {
    const current = this.articles.get(id);
    if (!current || current.version !== input.expectedVersion) return null;
    const nextPath = input.path ?? current.path;
    const existingPathId = this.articleIdsByPath.get(nextPath);
    if (existingPathId && existingPathId !== id)
      throw conflict("Article path already exists");
    const next: Article = {
      ...current,
      path: nextPath,
      format: input.format ?? current.format,
      title: input.title ?? current.title,
      frontmatter: input.frontmatter
        ? clone(input.frontmatter)
        : current.frontmatter,
      source: input.source ?? current.source,
      contentHash: input.contentHash ?? current.contentHash,
      gitCommitSha:
        input.gitCommitSha === undefined
          ? current.gitCommitSha
          : input.gitCommitSha,
      version: current.version + 1,
      updatedAt: input.now,
    };
    if (nextPath !== current.path) this.articleIdsByPath.delete(current.path);
    this.articleIdsByPath.set(nextPath, id);
    this.articles.set(id, next);
    return clone(next);
  }

  async deleteArticle(id: string, expectedVersion: number): Promise<boolean> {
    const article = this.articles.get(id);
    if (!article || article.version !== expectedVersion) return false;
    this.articles.delete(id);
    this.articleIdsByPath.delete(article.path);
    this.drafts.delete(id);
    for (const [revisionId, revision] of this.articleRevisions) {
      if (revision.articleId === id) this.articleRevisions.delete(revisionId);
    }
    for (const [publicationId, publication] of this.publications) {
      if (publication.articleId === id) this.publications.delete(publicationId);
    }
    return true;
  }

  async listArticleRevisions(
    articleId: string,
    limit = 100,
  ): Promise<ArticleRevision[]> {
    return [...this.articleRevisions.values()]
      .filter((revision) => revision.articleId === articleId)
      .sort(
        (left, right) =>
          right.createdAt.localeCompare(left.createdAt) ||
          right.id.localeCompare(left.id),
      )
      .slice(0, Math.max(1, Math.min(limit, 200)))
      .map(clone);
  }

  async getArticleRevision(id: string): Promise<ArticleRevision | null> {
    const revision = this.articleRevisions.get(id);
    return revision ? clone(revision) : null;
  }

  async createArticleRevision(
    input: CreateArticleRevisionInput,
  ): Promise<ArticleRevision> {
    if (!this.articles.has(input.articleId))
      throw conflict("Article does not exist");
    const revision: ArticleRevision = {
      id: input.id,
      articleId: input.articleId,
      kind: input.kind,
      path: input.path,
      source: input.source,
      contentHash: input.contentHash,
      gitCommitSha: input.gitCommitSha ?? null,
      createdAt: input.now,
    };
    this.articleRevisions.set(revision.id, revision);
    return clone(revision);
  }

  async getDraft(articleId: string): Promise<Draft | null> {
    const draft = this.drafts.get(articleId);
    return draft ? clone(draft) : null;
  }

  async upsertDraft(input: UpsertDraftInput): Promise<Draft | null> {
    if (!this.articles.has(input.articleId)) return null;
    const current = this.drafts.get(input.articleId);
    if (current && input.expectedVersion !== current.version) return null;
    if (
      !current &&
      input.expectedVersion !== null &&
      input.expectedVersion !== 0
    )
      return null;
    const draft: Draft = {
      articleId: input.articleId,
      operation: input.operation ?? "upsert",
      basePath: input.basePath,
      source: input.source,
      contentHash: input.contentHash,
      baseContentHash: input.baseContentHash,
      baseSource: input.baseSource,
      version: (current?.version ?? 0) + 1,
      createdAt: current?.createdAt ?? input.now,
      updatedAt: input.now,
    };
    this.drafts.set(input.articleId, draft);
    return clone(draft);
  }

  async deleteDraft(
    articleId: string,
    expectedVersion: number,
  ): Promise<boolean> {
    const draft = this.drafts.get(articleId);
    if (!draft || draft.version !== expectedVersion) return false;
    this.drafts.delete(articleId);
    return true;
  }

  async listContentConflicts(): Promise<ContentConflict[]> {
    return [...this.contentConflicts.values()]
      .filter((item) => item.status === "open")
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map(clone);
  }

  async getContentConflict(id: string): Promise<ContentConflict | null> {
    const item = this.contentConflicts.get(id);
    return item ? clone(item) : null;
  }

  async getOpenContentConflictByArticle(
    articleId: string,
  ): Promise<ContentConflict | null> {
    const item = [...this.contentConflicts.values()].find(
      (candidate) =>
        candidate.articleId === articleId && candidate.status === "open",
    );
    return item ? clone(item) : null;
  }

  async recordContentConflict(
    input: RecordContentConflictInput,
  ): Promise<ContentConflict> {
    const existing = await this.getOpenContentConflictByArticle(
      input.articleId,
    );
    const item: ContentConflict = {
      ...input,
      id: existing?.id ?? input.id,
      status: "open",
      resolution: null,
      createdAt: existing?.createdAt ?? input.now,
      updatedAt: input.now,
      resolvedAt: null,
    };
    this.contentConflicts.set(item.id, item);
    return clone(item);
  }

  async resolveContentConflict(
    id: string,
    resolution: ContentConflictResolution,
    now: string,
  ): Promise<ContentConflict | null> {
    const current = this.contentConflicts.get(id);
    if (!current || current.status !== "open") return null;
    const resolved: ContentConflict = {
      ...current,
      status: "resolved",
      resolution,
      updatedAt: now,
      resolvedAt: now,
    };
    this.contentConflicts.set(id, resolved);
    return clone(resolved);
  }

  async createPublication(input: CreatePublicationInput): Promise<Publication> {
    if (this.publications.has(input.id))
      throw conflict("Publication already exists");
    const publication: Publication = {
      id: input.id,
      articleId: input.articleId,
      articlePath: input.articlePath,
      source: input.source,
      contentHash: input.contentHash,
      draftVersion: input.draftVersion,
      status: "pending",
      commitSha: null,
      error: null,
      createdAt: input.now,
      updatedAt: input.now,
      completedAt: null,
    };
    this.publications.set(publication.id, publication);
    return clone(publication);
  }

  async getPublication(id: string): Promise<Publication | null> {
    const publication = this.publications.get(id);
    return publication ? clone(publication) : null;
  }

  async markPublicationDispatched(id: string, now: string): Promise<void> {
    const publication = this.publications.get(id);
    if (!publication || publication.status !== "pending") return;
    this.publications.set(id, {
      ...publication,
      status: "dispatched",
      updatedAt: now,
    });
  }

  async completePublication(
    input: CompletePublicationInput,
  ): Promise<Publication | null> {
    const current = this.publications.get(input.id);
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
      return clone(current);
    }
    if (input.contentHash && input.contentHash !== current.contentHash) {
      throw conflict(
        "Published content hash does not match publication snapshot",
      );
    }
    const completed: Publication = {
      ...current,
      status: input.status,
      commitSha: input.commitSha ?? null,
      error: input.error?.slice(0, 4000) ?? null,
      updatedAt: input.now,
      completedAt: input.now,
    };
    this.publications.set(input.id, completed);
    if (input.status === "published") {
      const article = this.articles.get(current.articleId);
      if (article) {
        const parsed = parseFrontmatter(current.source);
        this.articles.set(article.id, {
          ...article,
          path: current.articlePath,
          format: current.articlePath.toLowerCase().endsWith(".mdx")
            ? "mdx"
            : "md",
          title: titleFromFrontmatter(parsed.frontmatter, current.articlePath),
          frontmatter: parsed.frontmatter,
          source: current.source,
          contentHash: current.contentHash,
          gitCommitSha: input.commitSha ?? article.gitCommitSha,
          version: article.version + 1,
          updatedAt: input.now,
        });
      }
      const draft = this.drafts.get(current.articleId);
      if (draft?.version === current.draftVersion)
        this.drafts.delete(current.articleId);
    }
    return clone(completed);
  }

  async importBatch(input: ImportBatchInput): Promise<ImportBatchResult> {
    if (this.syncCheckpoints.has(input.checkpointId)) {
      return { duplicate: true, imported: 0, deleted: 0, conflicts: [] };
    }
    // Record before applying: retries after a partial failure are intentionally
    // suppressed. Persistent adapters wrap this operation in a transaction.
    this.syncCheckpoints.add(input.checkpointId);
    let imported = 0;
    let deleted = 0;
    const conflicts: ImportBatchResult["conflicts"] = [];
    for (const item of input.articles) {
      const existing = await this.getArticleByPath(item.path);
      if (!existing) {
        const created = await this.createArticle({
          ...item,
          id: crypto.randomUUID(),
          gitCommitSha: input.commitSha,
          now: input.now,
        });
        await this.createArticleRevision({
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
        const draft = this.drafts.get(existing.id);
        const baseHash = draft?.baseContentHash ?? existing.contentHash;
        if (
          draft &&
          draft.contentHash !== baseHash &&
          item.contentHash !== baseHash &&
          draft.contentHash !== item.contentHash
        ) {
          const recorded = await this.recordContentConflict({
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
        await this.updateArticle(existing.id, {
          expectedVersion: existing.version,
          format: item.format,
          title: item.title,
          frontmatter: item.frontmatter,
          source: item.source,
          contentHash: item.contentHash,
          gitCommitSha: input.commitSha,
          now: input.now,
        });
        const latest = (await this.listArticleRevisions(existing.id, 1))[0];
        if (
          !latest ||
          latest.contentHash !== item.contentHash ||
          latest.path !== item.path ||
          latest.kind !== "repository"
        ) {
          await this.createArticleRevision({
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
          const open = await this.getOpenContentConflictByArticle(existing.id);
          if (open)
            await this.resolveContentConflict(open.id, "converged", input.now);
          if (item.contentHash === draft.contentHash)
            this.drafts.delete(existing.id);
        }
        imported += 1;
      }

      // A merged PR is confirmed by the next service-owned repository snapshot.
      // Reconcile every matching publication idempotently by path and hash.
      for (const publication of this.publications.values()) {
        if (
          publication.status !== "dispatched" ||
          publication.articlePath !== item.path ||
          publication.contentHash !== item.contentHash
        )
          continue;
        this.publications.set(publication.id, {
          ...publication,
          status: "published",
          commitSha: input.commitSha,
          error: null,
          updatedAt: input.now,
          completedAt: input.now,
        });
        const draft = this.drafts.get(publication.articleId);
        if (draft?.version === publication.draftVersion) {
          this.drafts.delete(publication.articleId);
        }
      }
    }
    for (const path of input.deletedPaths) {
      const existing = await this.getArticleByPath(path);
      if (!existing) continue;
      if (this.drafts.has(existing.id)) {
        const draft = this.drafts.get(existing.id)!;
        const recorded = await this.recordContentConflict({
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
      if (await this.deleteArticle(existing.id, existing.version)) deleted += 1;
    }
    return { duplicate: false, imported, deleted, conflicts };
  }
}
