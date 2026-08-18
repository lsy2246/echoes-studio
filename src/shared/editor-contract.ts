export type ArticleFormat = "md" | "mdx";

export type CmsSyncStatus =
  "synced" | "unpublished" | "deleting" | "syncing" | "conflict" | "error";

export interface ArticleMetadata {
  title: string;
  date: string;
  tags: string[];
  summary: string;
  [key: string]: unknown;
}

export interface ArticleSummary {
  id: string;
  path: string;
  format: ArticleFormat;
  syncStatus: CmsSyncStatus;
  metadata: ArticleMetadata;
  updatedAt: string;
  publishedAt?: string | null;
  version: number;
}

/**
 * `source` is the canonical value. It contains the complete, byte-preserving
 * Markdown/MDX document, including frontmatter when present.
 */
export interface ArticleDocument extends ArticleSummary {
  source: string;
  baseGitHash?: string | null;
}

export type ArticleRevisionKind =
  | "repository"
  | "autosave"
  | "move"
  | "publish"
  | "restore"
  | "delete"
  | "create";

export interface ArticleRevision {
  id: string;
  articleId: string;
  kind: ArticleRevisionKind;
  path: string;
  source: string;
  contentHash: string;
  gitCommitSha: string | null;
  gitCommitMessage?: string | null;
  createdAt: string;
}

export interface ArticleListQuery {
  search?: string;
}

export interface CreateArticleInput {
  path: string;
  format: ArticleFormat;
  source: string;
}

export interface SaveDraftInput {
  id: string;
  path: string;
  source: string;
  /** Optimistic concurrency token. */
  version: number;
}

export interface PublishArticleInput {
  id: string;
  version: number;
  mode?: "pull-request" | "direct";
  commitMessage?: string;
}

export interface SaveDraftResult {
  article: ArticleDocument;
  savedAt: string;
}

export interface PublishArticleResult {
  article: ArticleDocument | null;
  publicationId: string;
  pullRequestUrl?: string | null;
  branch?: string | null;
}

export interface PublishArticlesInput {
  items: Array<{ id: string; version: number }>;
  mode?: "pull-request" | "direct";
  commitMessage?: string;
}

export interface PublishArticlesResult {
  articles: Array<ArticleDocument | null>;
  publicationIds: string[];
  commitSha?: string | null;
  branch?: string | null;
}

export interface MediaAsset {
  id: string;
  name: string;
  url: string;
  markdownUrl?: string;
}

export interface RepositoryStatus {
  configured: boolean;
  provider: string;
  owner: string;
  repository: string;
  branch: string;
  contentRoot: string;
  headCommit: string | null;
  checkedAt: string | null;
}

export interface RepositoryConnectionSettings {
  provider: "filesystem" | "github" | "gitee";
  owner: string;
  repository: string;
  branch: string;
  contentRoot: string;
  filesystemPath: string;
  tokenConfigured: boolean;
  updatedAt: string | null;
}

export interface UpdateRepositoryConnectionInput {
  provider: "filesystem" | "github" | "gitee";
  owner?: string;
  repository?: string;
  branch?: string;
  contentRoot: string;
  filesystemPath?: string;
  token?: string;
  clearToken?: boolean;
}

export interface RepositoryConnectionTestResult {
  ok: true;
  provider: "filesystem" | "github" | "gitee";
  branch: string;
  headCommit: string;
  checkedAt: string;
  message: string;
}

export type RepositorySyncConflict =
  | string
  | {
      path?: string;
      reason?: string;
      [key: string]: unknown;
    };

export interface RepositorySyncResult {
  imported: number;
  deleted: number;
  conflicts: RepositorySyncConflict[];
  headCommit: string | null;
}

export type ContentConflictResolution = "remote" | "cms" | "merged";

export interface ContentConflict {
  id: string;
  articleId: string;
  kind: "edit_edit" | "delete_edit" | "path_collision";
  basePath: string | null;
  baseSource: string | null;
  remotePath: string | null;
  remoteSource: string | null;
  remoteCommitSha: string;
  draftPath: string;
  draftSource: string;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationSettings {
  autoSaveSeconds: number;
  autoSyncMinutes: number;
  lastAutoSyncAt: string | null;
  updatedAt: string;
}

/**
 * The web app depends on this port rather than a particular backend runtime.
 * Tests and alternative deployments can inject their own implementation.
 */
export interface CmsApiClient {
  listArticles(query?: ArticleListQuery): Promise<ArticleSummary[]>;
  getArticle(id: string): Promise<ArticleDocument>;
  createArticle(input: CreateArticleInput): Promise<ArticleDocument>;
  saveDraft(input: SaveDraftInput): Promise<SaveDraftResult>;
  discardDraft(id: string, version: number): Promise<ArticleDocument | null>;
  publishArticle(input: PublishArticleInput): Promise<PublishArticleResult>;
  publishArticles(input: PublishArticlesInput): Promise<PublishArticlesResult>;
  deleteArticle(id: string, version: number): Promise<ArticleDocument | null>;
  listArticleRevisions(id: string): Promise<ArticleRevision[]>;
  restoreArticleRevision(
    id: string,
    revisionId: string,
    version: number,
  ): Promise<ArticleDocument>;
  getRepositoryStatus(): Promise<RepositoryStatus>;
  syncRepository(): Promise<RepositorySyncResult>;
  getRepositorySettings?(): Promise<RepositoryConnectionSettings>;
  updateRepositorySettings?(
    input: UpdateRepositoryConnectionInput,
  ): Promise<RepositoryConnectionSettings>;
  testRepositorySettings?(
    input: UpdateRepositoryConnectionInput,
  ): Promise<RepositoryConnectionTestResult>;
  changePassword?(currentPassword: string, newPassword: string): Promise<void>;
  getInternalToken?(): Promise<string>;
  rotateInternalToken?(): Promise<string>;
  listConflicts(): Promise<ContentConflict[]>;
  resolveConflict(
    id: string,
    input: {
      resolution: ContentConflictResolution;
      mergedSource?: string;
      mergedPath?: string;
    },
  ): Promise<ArticleDocument | null>;
  getAutomationSettings?(): Promise<AutomationSettings>;
  updateAutomationSettings?(
    input: Pick<AutomationSettings, "autoSaveSeconds" | "autoSyncMinutes">,
  ): Promise<AutomationSettings>;
  uploadMedia?(articleId: string, file: File): Promise<MediaAsset>;
}

export type EditorView = "editOnly" | "edit&preview" | "previewOnly";

export type EditorDiagnosticSeverity = "info" | "warning" | "error";

export interface EditorDiagnostic {
  code: string;
  message: string;
  severity: EditorDiagnosticSeverity;
  line?: number;
}

/** Stable adapter boundary around Cherry Markdown. */
export interface MarkdownEditorDriver {
  getSource(): string;
  setSource(source: string, keepCursor?: boolean): void;
  insert(source: string, select?: boolean): void;
  setView(view: EditorView): void;
  focus(): void;
  validate(): EditorDiagnostic[];
  destroy(): void;
}
