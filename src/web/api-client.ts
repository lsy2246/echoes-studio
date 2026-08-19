import type {
  ArticleDocument,
  ArticleListQuery,
  ArticleMetadata,
  ArticleRevision,
  ArticleSummary,
  CmsApiClient,
  ContentConflict,
  ContentConflictResolution,
  CreateArticleInput,
  PublishArticleInput,
  PublishArticleResult,
  PublishArticlesInput,
  PublishArticlesResult,
  RepositoryStatus,
  RepositoryConnectionSettings,
  RepositoryConnectionTestResult,
  UpdateRepositoryConnectionInput,
  RepositorySyncConflict,
  RepositorySyncResult,
  SaveDraftInput,
  SaveDraftResult,
  AutomationSettings,
} from "../shared/editor-contract";
import { localizeErrorMessage } from "../core/errors";

interface BackendArticle {
  id: string;
  path: string;
  format: "md" | "mdx";
  title: string;
  frontmatter?: Record<string, unknown>;
  source: string;
  contentHash?: string;
  gitCommitSha?: string | null;
  version: number;
  updatedAt: string;
  draft?: BackendDraft | null;
  syncStatus?: ArticleSummary["syncStatus"];
}

interface BackendDraft {
  source: string;
  operation?: "upsert" | "delete";
  baseContentHash?: string | null;
  version: number;
  updatedAt: string;
}

interface BackendPublication {
  id: string;
  status: "pending" | "dispatched" | "published" | "failed";
}

interface DataEnvelope<T> {
  data: T;
}

interface FetchCmsApiClientOptions {
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  token?: string | (() => string | null | undefined);
}

interface ListEnvelope {
  items?: Array<BackendArticle | ArticleSummary>;
  articles?: Array<BackendArticle | ArticleSummary>;
  nextCursor?: string | null;
}

interface ErrorEnvelope {
  error?: string | { code?: string; message?: string };
  message?: string;
}

interface LooseRepositoryStatus {
  configured?: unknown;
  provider?: unknown;
  owner?: unknown;
  repository?: unknown;
  repo?: unknown;
  repositoryId?: unknown;
  repository_id?: unknown;
  branch?: unknown;
  defaultBranch?: unknown;
  default_branch?: unknown;
  contentRoot?: unknown;
  content_root?: unknown;
  lastSyncedCommit?: unknown;
  last_synced_commit?: unknown;
  headCommit?: unknown;
  head_commit?: unknown;
  lastSyncedAt?: unknown;
  last_synced_at?: unknown;
  lastCheckedAt?: unknown;
  last_checked_at?: unknown;
}

interface LooseRepositorySyncResult {
  imported?: unknown;
  deleted?: unknown;
  conflicts?: unknown;
  headCommit?: unknown;
  head_commit?: unknown;
}

export class CmsApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "CmsApiError";
    this.status = status;
    this.code = code;
  }
}

/** Default HTTP adapter. Consumers can inject a different `CmsApiClient`. */
export class FetchCmsApiClient implements CmsApiClient {
  readonly #baseUrl: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #token?: string | (() => string | null | undefined);

  constructor(options: FetchCmsApiClientOptions = {}) {
    this.#baseUrl = (options.baseUrl ?? "/api").replace(/\/$/, "");
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#token = options.token;
  }

  async listArticles(query: ArticleListQuery = {}): Promise<ArticleSummary[]> {
    const params = new URLSearchParams({ limit: "100" });
    if (query.search) params.set("search", query.search);
    const articles: Array<BackendArticle | ArticleSummary> = [];
    let cursor: string | null = null;
    do {
      if (cursor) params.set("cursor", cursor);
      const payload = await this.#request<
        DataEnvelope<ListEnvelope> | ListEnvelope | BackendArticle[]
      >(`/articles?${params.toString()}`);
      const list = "data" in payload ? payload.data : payload;
      if (Array.isArray(list)) {
        articles.push(...list);
        cursor = null;
      } else {
        articles.push(...(list.items ?? list.articles ?? []));
        cursor = typeof list.nextCursor === "string" ? list.nextCursor : null;
      }
    } while (cursor);
    return articles.map((article) =>
      "metadata" in article ? article : this.#toSummary(article),
    );
  }

  async getArticle(id: string): Promise<ArticleDocument> {
    const payload = await this.#request<
      DataEnvelope<BackendArticle> | BackendArticle | ArticleDocument
    >(`/articles/${encodeURIComponent(id)}`);
    if ("metadata" in payload) return payload;
    return this.#toDocument("data" in payload ? payload.data : payload);
  }

  async createArticle(input: CreateArticleInput): Promise<ArticleDocument> {
    const payload = await this.#request<
      | DataEnvelope<
          | { article: BackendArticle; draft?: BackendDraft | null }
          | BackendArticle
        >
      | ArticleDocument
    >("/articles", {
      method: "POST",
      body: JSON.stringify(input),
    });
    if ("metadata" in payload) return payload;
    const data = payload.data;
    const article =
      "article" in data ? { ...data.article, draft: data.draft } : data;
    return this.#toDocument(article);
  }

  async saveDraft(input: SaveDraftInput): Promise<SaveDraftResult> {
    const payload = await this.#request<
      SaveDraftResult | DataEnvelope<BackendDraft>
    >(`/articles/${encodeURIComponent(input.id)}/draft`, {
      method: "PUT",
      body: JSON.stringify({
        source: input.source,
        expectedVersion: input.version,
        path: input.path,
      }),
    });
    if ("article" in payload) return payload;
    const current = await this.getArticle(input.id);
    return {
      article: this.#toDocument({
        ...this.#fromDocument(current),
        path: input.path,
        source: payload.data.source,
        draft: payload.data,
        version: payload.data.version,
        updatedAt: payload.data.updatedAt,
      }),
      savedAt: payload.data.updatedAt,
    };
  }

  async publishArticle(
    input: PublishArticleInput,
  ): Promise<PublishArticleResult> {
    const payload = await this.#request<
      PublishArticleResult | DataEnvelope<BackendPublication>
    >(`/articles/${encodeURIComponent(input.id)}/publish`, {
      method: "POST",
      body: JSON.stringify({
        expectedVersion: input.version,
        mode: input.mode,
        commitMessage: input.commitMessage,
      }),
    });
    if ("article" in payload) return payload;
    const before = await this.getArticle(input.id);
    return {
      article: {
        ...before,
        syncStatus: payload.data.status === "published" ? "synced" : "syncing",
      },
      publicationId: payload.data.id,
    };
  }

  async publishArticles(
    input: PublishArticlesInput,
  ): Promise<PublishArticlesResult> {
    return this.#request<PublishArticlesResult>("/articles/publish-batch", {
      method: "POST",
      body: JSON.stringify({
        items: input.items.map((item) => ({
          id: item.id,
          expectedVersion: item.version,
        })),
        mode: input.mode,
        commitMessage: input.commitMessage,
      }),
    });
  }

  async discardDraft(
    id: string,
    version: number,
  ): Promise<ArticleDocument | null> {
    const payload = await this.#request<{ data: BackendArticle | null }>(
      `/articles/${encodeURIComponent(id)}/draft`,
      {
        method: "DELETE",
        body: JSON.stringify({ expectedVersion: version }),
      },
    );
    return payload.data ? this.#toDocument(payload.data) : null;
  }

  async deleteArticle(
    id: string,
    version: number,
  ): Promise<ArticleDocument | null> {
    const payload = await this.#request<{ data: BackendArticle | null }>(
      `/articles/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
        body: JSON.stringify({ expectedVersion: version }),
      },
    );
    return payload.data ? this.#toDocument(payload.data) : null;
  }

  async listArticleRevisions(id: string): Promise<ArticleRevision[]> {
    const payload = await this.#request<DataEnvelope<ArticleRevision[]>>(
      `/articles/${encodeURIComponent(id)}/revisions?limit=100`,
    );
    return payload.data;
  }

  async restoreArticleRevision(
    id: string,
    revisionId: string,
    version: number,
  ): Promise<ArticleDocument> {
    const payload = await this.#request<DataEnvelope<BackendArticle>>(
      `/articles/${encodeURIComponent(id)}/revisions/${encodeURIComponent(revisionId)}/restore`,
      { method: "POST", body: JSON.stringify({ expectedVersion: version }) },
    );
    return this.#toDocument(payload.data);
  }

  async getRepositoryStatus(): Promise<RepositoryStatus> {
    const payload = await this.#request<
      DataEnvelope<LooseRepositoryStatus> | LooseRepositoryStatus
    >("/repository/status");
    const status = "data" in payload ? payload.data : payload;
    const repositoryIdentity = this.#repositoryIdentity(
      status.repositoryId ?? status.repository_id,
    );
    return {
      configured: status.configured !== false,
      provider: this.#string(status.provider, "github"),
      owner: this.#string(status.owner, repositoryIdentity.owner),
      repository: this.#string(
        status.repository ?? status.repo,
        repositoryIdentity.repository,
      ),
      branch: this.#string(
        status.branch ?? status.defaultBranch ?? status.default_branch,
        "main",
      ),
      contentRoot: this.#string(
        status.contentRoot ?? status.content_root,
        "src/content",
      ),
      headCommit: this.#nullableString(
        status.lastSyncedCommit ??
          status.last_synced_commit ??
          status.headCommit ??
          status.head_commit,
      ),
      checkedAt: this.#nullableString(
        status.lastSyncedAt ??
          status.last_synced_at ??
          status.lastCheckedAt ??
          status.last_checked_at,
      ),
    };
  }

  async syncRepository(): Promise<RepositorySyncResult> {
    const payload = await this.#request<
      DataEnvelope<LooseRepositorySyncResult> | LooseRepositorySyncResult
    >("/repository/sync", { method: "POST" });
    const result = "data" in payload ? payload.data : payload;
    const conflicts: RepositorySyncConflict[] = Array.isArray(result.conflicts)
      ? result.conflicts.filter(
          (item): item is RepositorySyncConflict =>
            typeof item === "string" ||
            (typeof item === "object" && item !== null),
        )
      : [];
    return {
      imported: this.#count(result.imported),
      deleted: this.#count(result.deleted),
      conflicts,
      headCommit: this.#nullableString(result.headCommit ?? result.head_commit),
    };
  }

  async getRepositorySettings(): Promise<RepositoryConnectionSettings> {
    const payload = await this.#request<
      DataEnvelope<RepositoryConnectionSettings>
    >("/settings/repository");
    return payload.data;
  }

  async updateRepositorySettings(
    input: UpdateRepositoryConnectionInput,
  ): Promise<RepositoryConnectionSettings> {
    const payload = await this.#request<
      DataEnvelope<RepositoryConnectionSettings>
    >("/settings/repository", {
      method: "PUT",
      body: JSON.stringify(input),
    });
    return payload.data;
  }

  async testRepositorySettings(
    input: UpdateRepositoryConnectionInput,
  ): Promise<RepositoryConnectionTestResult> {
    const payload = await this.#request<
      DataEnvelope<RepositoryConnectionTestResult>
    >("/settings/repository/test", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return payload.data;
  }

  async getPasswordSettings() {
    const payload = await this.#request<
      DataEnvelope<{ iterations: 100000 | 150000 | 210000 }>
    >("/settings/password");
    return payload.data;
  }

  async updatePasswordSettings(input: {
    currentPassword: string;
    newPassword?: string;
    iterations: 100000 | 150000 | 210000;
  }) {
    const payload = await this.#request<
      DataEnvelope<{ changed: boolean; iterations: 100000 | 150000 | 210000 }>
    >("/settings/password", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return { iterations: payload.data.iterations };
  }

  async getInternalToken(): Promise<string> {
    const payload = await this.#request<DataEnvelope<{ token: string }>>(
      "/settings/internal-token",
    );
    return payload.data.token;
  }

  async rotateInternalToken(): Promise<string> {
    const payload = await this.#request<DataEnvelope<{ token: string }>>(
      "/settings/internal-token",
      {
        method: "POST",
      },
    );
    return payload.data.token;
  }

  async listConflicts(): Promise<ContentConflict[]> {
    const payload =
      await this.#request<DataEnvelope<ContentConflict[]>>("/conflicts");
    return payload.data;
  }

  async resolveConflict(
    id: string,
    input: {
      resolution: ContentConflictResolution;
      mergedSource?: string;
      mergedPath?: string;
    },
  ): Promise<ArticleDocument | null> {
    const payload = await this.#request<DataEnvelope<BackendArticle | null>>(
      `/conflicts/${encodeURIComponent(id)}/resolve`,
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    );
    return payload.data ? this.#toDocument(payload.data) : null;
  }

  async getAutomationSettings(): Promise<AutomationSettings> {
    const payload = await this.#request<DataEnvelope<AutomationSettings>>(
      "/settings/automation",
    );
    return payload.data;
  }

  async updateAutomationSettings(
    input: Pick<AutomationSettings, "autoSaveSeconds" | "autoSyncMinutes">,
  ): Promise<AutomationSettings> {
    const payload = await this.#request<DataEnvelope<AutomationSettings>>(
      "/settings/automation",
      {
        method: "PATCH",
        body: JSON.stringify(input),
      },
    );
    return payload.data;
  }

  async #request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    const token =
      typeof this.#token === "function" ? this.#token() : this.#token;
    if (token) headers.set("Authorization", `Bearer ${token}`);
    if (init.body && !(init.body instanceof FormData)) {
      headers.set("Content-Type", "application/json");
    }

    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}${path}`, {
        ...init,
        headers,
      });
    } catch {
      throw new CmsApiError(
        localizeErrorMessage({ code: "network_error" }),
        0,
        "network_error",
      );
    }

    if (!response.ok) {
      let rawMessage: string | undefined;
      let code: string | undefined;
      try {
        const payload = (await response.json()) as ErrorEnvelope;
        if (typeof payload.error === "object") {
          rawMessage = payload.error.message;
          code = payload.error.code;
        } else {
          rawMessage = payload.error;
        }
        rawMessage ??= payload.message;
      } catch {
        // Keep the status-based fallback for non-JSON platform errors.
      }
      const message = localizeErrorMessage({
        code,
        status: response.status,
        message: rawMessage,
      });
      throw new CmsApiError(message, response.status, code);
    }

    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  #metadata(article: BackendArticle): ArticleMetadata {
    const frontmatter = article.frontmatter ?? {};
    const metadata: ArticleMetadata = {
      ...frontmatter,
      title:
        typeof frontmatter.title === "string"
          ? frontmatter.title
          : article.title,
      date: typeof frontmatter.date === "string" ? frontmatter.date : "",
      tags: Array.isArray(frontmatter.tags)
        ? frontmatter.tags.filter(
            (tag): tag is string => typeof tag === "string",
          )
        : [],
      summary:
        typeof frontmatter.summary === "string" ? frontmatter.summary : "",
    };
    delete metadata.draft;
    return metadata;
  }

  #string(value: unknown, fallback = ""): string {
    return typeof value === "string" && value.trim() ? value : fallback;
  }

  #nullableString(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value : null;
  }

  #count(value: unknown): number {
    if (Array.isArray(value)) return value.length;
    const count = typeof value === "number" ? value : Number(value);
    return Number.isFinite(count) && count >= 0 ? Math.floor(count) : 0;
  }

  #repositoryIdentity(value: unknown): { owner: string; repository: string } {
    if (typeof value !== "string") return { owner: "", repository: "" };
    const identity = value
      .replace(/^[a-z][a-z0-9+.-]*:/i, "")
      .replace(/^\/+/, "");
    const [owner = "", repository = ""] = identity.split("/");
    return { owner, repository };
  }

  #toSummary(article: BackendArticle): ArticleSummary {
    return {
      id: article.id,
      path: article.path,
      format: article.format,
      syncStatus:
        article.syncStatus ??
        (article.draft?.operation === "delete"
          ? "deleting"
          : article.draft
            ? "unpublished"
            : "synced"),
      metadata: this.#metadata(article),
      updatedAt: article.draft?.updatedAt ?? article.updatedAt,
      publishedAt: article.gitCommitSha ? article.updatedAt : null,
      // The editor version is the draft CAS token, not the article-row token.
      // Zero means the first draft write must create the draft atomically.
      version: article.draft?.version ?? 0,
    };
  }

  #toDocument(article: BackendArticle): ArticleDocument {
    return {
      ...this.#toSummary(article),
      source: article.draft?.source ?? article.source,
      baseGitHash:
        article.draft?.baseContentHash ?? article.contentHash ?? null,
    };
  }

  #fromDocument(article: ArticleDocument): BackendArticle {
    return {
      id: article.id,
      path: article.path,
      format: article.format,
      title: article.metadata.title,
      frontmatter: article.metadata,
      source: article.source,
      contentHash: article.baseGitHash ?? undefined,
      version: article.version,
      updatedAt: article.updatedAt,
    };
  }
}
