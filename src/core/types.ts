export type ArticleFormat = "md" | "mdx";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type Frontmatter = Record<string, JsonValue>;

export interface Article {
  id: string;
  path: string;
  format: ArticleFormat;
  title: string;
  frontmatter: Frontmatter;
  source: string;
  contentHash: string;
  gitCommitSha: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface Draft {
  articleId: string;
  operation: "upsert" | "delete";
  /** Repository path at the common Git/DB baseline; used for durable renames. */
  basePath: string | null;
  source: string;
  contentHash: string;
  baseContentHash: string | null;
  /** Full common ancestor used by the three-way conflict editor. */
  baseSource: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type ArticleRevisionKind =
  | "repository"
  | "autosave"
  | "move"
  | "publish"
  | "restore"
  | "delete"
  | "create";

/** Immutable article snapshot used by the history and diff interface. */
export interface ArticleRevision {
  id: string;
  articleId: string;
  kind: ArticleRevisionKind;
  path: string;
  source: string;
  contentHash: string;
  gitCommitSha: string | null;
  createdAt: string;
}

export interface CreateArticleRevisionInput {
  id: string;
  articleId: string;
  kind: ArticleRevisionKind;
  path: string;
  source: string;
  contentHash: string;
  gitCommitSha?: string | null;
  now: string;
}

export type ContentConflictKind =
  "edit_edit" | "delete_edit" | "path_collision";
export type ContentConflictResolution =
  "remote" | "cms" | "merged" | "converged";

export interface ContentConflict {
  id: string;
  articleId: string;
  kind: ContentConflictKind;
  basePath: string | null;
  baseSource: string | null;
  baseHash: string | null;
  remotePath: string | null;
  remoteSource: string | null;
  remoteHash: string | null;
  remoteCommitSha: string;
  draftPath: string;
  draftSource: string;
  draftHash: string;
  draftVersion: number;
  status: "open" | "resolved";
  resolution: ContentConflictResolution | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface RecordContentConflictInput {
  id: string;
  articleId: string;
  kind: ContentConflictKind;
  basePath: string | null;
  baseSource: string | null;
  baseHash: string | null;
  remotePath: string | null;
  remoteSource: string | null;
  remoteHash: string | null;
  remoteCommitSha: string;
  draftPath: string;
  draftSource: string;
  draftHash: string;
  draftVersion: number;
  now: string;
}

export type PublicationStatus =
  "pending" | "dispatched" | "published" | "failed";

export interface Publication {
  id: string;
  articleId: string;
  articlePath: string;
  source: string;
  contentHash: string;
  draftVersion: number;
  status: PublicationStatus;
  commitSha: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface ArticleListQuery {
  cursor?: string;
  limit: number;
  search?: string;
}

export interface ArticleListResult {
  items: Article[];
  nextCursor: string | null;
}

export interface CreateArticleInput {
  id: string;
  path: string;
  format: ArticleFormat;
  title: string;
  frontmatter: Frontmatter;
  source: string;
  contentHash: string;
  gitCommitSha?: string | null;
  now: string;
}

export interface UpdateArticleInput {
  expectedVersion: number;
  path?: string;
  format?: ArticleFormat;
  title?: string;
  frontmatter?: Frontmatter;
  source?: string;
  contentHash?: string;
  gitCommitSha?: string | null;
  now: string;
}

export interface UpsertDraftInput {
  articleId: string;
  operation?: "upsert" | "delete";
  basePath: string | null;
  expectedVersion: number | null;
  source: string;
  contentHash: string;
  baseContentHash: string | null;
  baseSource: string | null;
  now: string;
}

export interface CreatePublicationInput {
  id: string;
  articleId: string;
  articlePath: string;
  source: string;
  contentHash: string;
  draftVersion: number;
  now: string;
}

export interface CompletePublicationInput {
  id: string;
  status: "published" | "failed";
  contentHash?: string;
  commitSha?: string | null;
  error?: string | null;
  now: string;
}

export interface ImportArticleInput {
  path: string;
  format: ArticleFormat;
  title: string;
  frontmatter: Frontmatter;
  source: string;
  contentHash: string;
}

export interface ImportBatchInput {
  checkpointId: string;
  commitSha: string;
  articles: ImportArticleInput[];
  deletedPaths: string[];
  now: string;
}

export interface ImportBatchResult {
  duplicate: boolean;
  imported: number;
  deleted: number;
  conflicts: Array<{
    id: string;
    articleId: string;
    path: string;
    reason: string;
  }>;
}

export interface HealthStatus {
  ok: boolean;
  adapter: string;
  schemaVersion: number;
}

export interface AutomationSettings {
  autoSaveSeconds: number;
  autoSyncMinutes: number;
  lastAutoSyncAt: string | null;
  updatedAt: string;
}

export interface UpdateAutomationSettingsInput {
  autoSaveSeconds?: number;
  autoSyncMinutes?: number;
  lastAutoSyncAt?: string | null;
  now: string;
}

export interface SystemSettings {
  repositoryConfigJson: string | null;
  passwordHash: string | null;
  passwordHashIterations: number;
  installationSecret: string | null;
  internalToken: string | null;
  updatedAt: string;
}

export interface UpdateSystemSettingsInput {
  repositoryConfigJson?: string | null;
  passwordHash?: string | null;
  passwordHashIterations?: number;
  installationSecret?: string | null;
  internalToken?: string | null;
  now: string;
}
