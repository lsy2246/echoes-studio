import type { DatabasePort } from "../core/database-port";
import type { GitRepositoryPort } from "../core/git-repository-port";
import type { RepositorySettingsService } from "../core/repository-settings";

export type AuthScope = "admin" | "internal";

export interface CreateAppOptions {
  database: DatabasePort;
  repository: GitRepositoryPort;
  repositorySettings?: RepositorySettingsService;
  adminToken?: string;
  /** HMAC secret for the browser's HttpOnly admin session cookie. */
  sessionSecret?: string;
  /** Used only by the service's own scheduler at /api/internal/reconcile. */
  internalToken?: string;
  allowUnauthenticated?: boolean;
  authorize?: (request: Request, scope: AuthScope) => boolean | Promise<boolean>;
  maxBodyBytes?: number;
  now?: () => Date;
  id?: () => string;
  onError?: (error: unknown, request: Request) => void;
}
