import type { ArticleFormat } from "./types";

export interface RepositoryArticle {
  path: string;
  source: string;
  /** Optional provider-side digest; the service always verifies SHA-256 itself. */
  contentHash?: string;
  format?: ArticleFormat;
}

export interface RepositorySnapshot {
  /** Stable identity, e.g. github:owner/repository. */
  repositoryId: string;
  branch: string;
  headCommit: string;
  articles: RepositoryArticle[];
}

export interface RepositoryArticleRevision {
  path: string;
  source: string;
  commitSha: string;
  commitMessage: string;
  committedAt: string;
}

export interface RepositoryStatus {
  configured: boolean;
  repositoryId: string;
  provider: string;
  defaultBranch: string;
  headCommit: string;
  contentRoot?: string;
  lastCheckedAt?: string | null;
}

export type RepositoryPublishMode = "pull-request" | "direct";

export interface RepositoryPublishRequest {
  publicationId: string;
  path: string;
  /** Delete this path after writing `path` when the publication is a move. */
  previousPath?: string;
  source: string;
  contentHash: string;
  mode: RepositoryPublishMode;
  /** Human-readable Git commit message supplied by the publisher. */
  commitMessage?: string;
  /** Enables provider-side compare-and-swap where supported. */
  expectedHeadCommit?: string;
  /** Common article ancestor. Unrelated repository commits do not block a publish. */
  basePath?: string | null;
  baseContentHash?: string | null;
  /** Path whose current content is compared with baseContentHash. */
  remoteCheckPath?: string | null;
}

export interface RepositoryConflictSnapshot {
  kind: "edit_edit" | "delete_edit" | "path_collision";
  remotePath: string | null;
  remoteSource: string | null;
  remoteContentHash: string | null;
  remoteCommitSha: string;
}

export class RepositoryContentConflictError extends Error {
  constructor(readonly snapshot: RepositoryConflictSnapshot) {
    super("Repository content changed after the CMS draft diverged");
    this.name = "RepositoryContentConflictError";
  }
}

export interface RepositoryPublishResult {
  mode: RepositoryPublishMode;
  /** Direct writes finish immediately; PR writes normally remain pending. */
  status: "published" | "pending";
  commitSha?: string;
  pullRequestUrl?: string;
  branch?: string;
}

export type RepositoryBatchPublishChange =
  | {
      operation: "upsert";
      publicationId: string;
      path: string;
      previousPath?: string;
      source: string;
      contentHash: string;
      basePath?: string | null;
      baseContentHash?: string | null;
      remoteCheckPath?: string | null;
    }
  | {
      operation: "delete";
      publicationId: string;
      path: string;
      baseContentHash?: string | null;
    };

export interface RepositoryBatchPublishRequest {
  batchId: string;
  changes: RepositoryBatchPublishChange[];
  mode: RepositoryPublishMode;
  commitMessage?: string;
}

export interface RepositoryBatchConflict {
  publicationId: string;
  snapshot: RepositoryConflictSnapshot;
}

export class RepositoryBatchContentConflictError extends Error {
  constructor(readonly conflicts: RepositoryBatchConflict[]) {
    super("One or more repository articles changed after the CMS drafts diverged");
    this.name = "RepositoryBatchContentConflictError";
  }
}

export interface RepositoryDeleteRequest {
  path: string;
  /** Human-readable Git commit message supplied by the publisher. */
  commitMessage?: string;
  /** Last repository version known by the CMS. */
  expectedHeadCommit?: string;
  /** Canonical content hash used to reject delete-after-edit races. */
  baseContentHash?: string | null;
}

export interface RepositoryDeleteResult {
  status: "deleted";
  commitSha: string;
  branch: string;
}

/**
 * Outbound repository boundary. Echoes Studio initiates every read and write;
 * content repositories never need a webhook, callback, or reusable workflow.
 */
export interface GitRepositoryPort {
  snapshot(): Promise<RepositorySnapshot>;
  status(): Promise<RepositoryStatus>;
  /** Provider-native commit history for one article, newest first. */
  history?(path: string, limit?: number): Promise<RepositoryArticleRevision[]>;
  publish(input: RepositoryPublishRequest): Promise<RepositoryPublishResult>;
  /** Atomically writes all changes as one provider commit. */
  publishBatch(input: RepositoryBatchPublishRequest): Promise<RepositoryPublishResult>;
  delete(input: RepositoryDeleteRequest): Promise<RepositoryDeleteResult>;
}
