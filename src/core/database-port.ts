import type {
  Article,
  ArticleRevision,
  AutomationSettings,
  ArticleListQuery,
  ArticleListResult,
  CompletePublicationInput,
  ContentConflict,
  ContentConflictResolution,
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
} from "./types";

/**
 * The only persistence boundary used by the backend. Implementations must make
 * compare-and-swap operations atomic and treat idempotency keys as unique.
 */
export interface DatabasePort {
  readonly adapterName: string;
  health(): Promise<HealthStatus>;
  getAutomationSettings(): Promise<AutomationSettings>;
  updateAutomationSettings(input: UpdateAutomationSettingsInput): Promise<AutomationSettings>;
  getSystemSettings(): Promise<SystemSettings>;
  updateSystemSettings(input: UpdateSystemSettingsInput): Promise<SystemSettings>;

  listArticles(query: ArticleListQuery): Promise<ArticleListResult>;
  getArticle(id: string): Promise<Article | null>;
  getArticleByPath(path: string): Promise<Article | null>;
  createArticle(input: CreateArticleInput): Promise<Article>;
  updateArticle(id: string, input: UpdateArticleInput): Promise<Article | null>;
  deleteArticle(id: string, expectedVersion: number): Promise<boolean>;

  listArticleRevisions(articleId: string, limit?: number): Promise<ArticleRevision[]>;
  getArticleRevision(id: string): Promise<ArticleRevision | null>;
  createArticleRevision(input: CreateArticleRevisionInput): Promise<ArticleRevision>;

  getDraft(articleId: string): Promise<Draft | null>;
  upsertDraft(input: UpsertDraftInput): Promise<Draft | null>;
  deleteDraft(articleId: string, expectedVersion: number): Promise<boolean>;

  listContentConflicts(): Promise<ContentConflict[]>;
  getContentConflict(id: string): Promise<ContentConflict | null>;
  getOpenContentConflictByArticle(articleId: string): Promise<ContentConflict | null>;
  recordContentConflict(input: RecordContentConflictInput): Promise<ContentConflict>;
  resolveContentConflict(id: string, resolution: ContentConflictResolution, now: string): Promise<ContentConflict | null>;

  createPublication(input: CreatePublicationInput): Promise<Publication>;
  getPublication(id: string): Promise<Publication | null>;
  markPublicationDispatched(id: string, now: string): Promise<void>;
  completePublication(input: CompletePublicationInput): Promise<Publication | null>;

  importBatch(input: ImportBatchInput): Promise<ImportBatchResult>;
}
