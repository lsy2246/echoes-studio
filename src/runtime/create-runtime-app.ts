import { createApp } from "../backend/index.ts";
import type { DatabasePort } from "../core/database-port.ts";
import type { GitRepositoryPort } from "../core/git-repository-port.ts";
import type { RuntimeEnv } from "./env.ts";
import { readBoolean, readInteger } from "./env.ts";
import { githubTokenProviderFromEnv } from "./github-app-token.ts";
import { createGitHubRepository } from "./github-repository.ts";
import { ConfigurableRepository } from "./configurable-repository.ts";

export interface RuntimeAppOptions {
  allowUnauthenticatedByDefault?: boolean;
  repository?: GitRepositoryPort;
  createFilesystemRepository?: (
    path: string,
    contentRoot: string,
  ) => Promise<GitRepositoryPort>;
  onError?: (error: unknown, request: Request) => void;
}

function unconfiguredRepository(): GitRepositoryPort {
  const error = () =>
    Promise.reject(new Error("GitHub repository is not configured"));
  return {
    snapshot: error,
    publish: error,
    publishBatch: error,
    delete: error,
    status: async () => ({
      configured: false,
      repositoryId: "",
      provider: "github",
      defaultBranch: "",
      headCommit: "",
      lastCheckedAt: null,
    }),
  };
}

function createRepository(env: RuntimeEnv): GitRepositoryPort {
  const owner = env.CMS_GITHUB_OWNER?.trim();
  const repository = env.CMS_GITHUB_REPO?.trim();
  if (!owner && !repository) return unconfiguredRepository();
  if (!owner || !repository) {
    throw new Error(
      "CMS_GITHUB_OWNER and CMS_GITHUB_REPO must be configured together",
    );
  }
  return createGitHubRepository({
    owner,
    repository,
    branch: env.CMS_GITHUB_BRANCH,
    contentRoot: env.CMS_CONTENT_ROOT,
    token: githubTokenProviderFromEnv(env) ?? undefined,
    apiBaseUrl: env.CMS_GITHUB_API_URL,
    maxArticleBytes: readInteger(env, "CMS_MAX_ARTICLE_BYTES", 1024 * 1024),
    blobConcurrency: readInteger(env, "CMS_GITHUB_BLOB_CONCURRENCY", 6),
  });
}

export function createRuntimeApp(
  database: DatabasePort,
  env: RuntimeEnv,
  options: RuntimeAppOptions = {},
): (request: Request) => Promise<Response> {
  const adminPassword =
    env.CMS_ADMIN_PASSWORD?.trim() || env.CMS_ADMIN_TOKEN?.trim();
  const configuredSessionSecret = env.CMS_SESSION_SECRET?.trim();
  const encryptionSecret = async () => {
    if (configuredSessionSecret) return configuredSessionSecret;
    const settings = await database.getSystemSettings();
    if (!settings.installationSecret) {
      throw new Error("Studio 尚未完成首次初始化");
    }
    return settings.installationSecret;
  };
  const fallbackRepository = options.repository ?? createRepository(env);
  const repositoryDriver = env.CMS_REPOSITORY_DRIVER?.trim().toLowerCase();
  const repository = new ConfigurableRepository({
    database,
    fallback: fallbackRepository,
    fallbackSettings:
      repositoryDriver === "filesystem"
        ? {
            provider: "filesystem",
            owner: "",
            repository: "",
            branch: "working-tree",
            contentRoot: env.CMS_CONTENT_ROOT?.trim() || "src/content",
            filesystemPath: env.CMS_REPOSITORY_PATH?.trim() || "../blog",
            tokenConfigured: false,
            updatedAt: null,
          }
        : {
            provider: "github",
            owner: env.CMS_GITHUB_OWNER?.trim() || "",
            repository: env.CMS_GITHUB_REPO?.trim() || "",
            branch: env.CMS_GITHUB_BRANCH?.trim() || "",
            contentRoot: env.CMS_CONTENT_ROOT?.trim() || "src/content",
            filesystemPath: "",
            tokenConfigured: Boolean(githubTokenProviderFromEnv(env)),
            updatedAt: null,
          },
    encryptionSecret,
    fallbackGithubToken: githubTokenProviderFromEnv(env) ?? undefined,
    githubApiBaseUrl: env.CMS_GITHUB_API_URL,
    maxArticleBytes: readInteger(env, "CMS_MAX_ARTICLE_BYTES", 1024 * 1024),
    blobConcurrency: readInteger(env, "CMS_GITHUB_BLOB_CONCURRENCY", 6),
    createFilesystem: options.createFilesystemRepository,
  });
  return createApp({
    database,
    repository,
    repositorySettings: repository,
    // Password is the product-facing name. Keep CMS_ADMIN_TOKEN as a
    // backwards-compatible alias for existing deployments.
    adminToken: adminPassword,
    // createApp binds the current database-backed password identity into this
    // base secret, so changing the password revokes other browser sessions.
    sessionSecret: configuredSessionSecret,
    internalToken: env.CMS_INTERNAL_TOKEN,
    allowUnauthenticated: readBoolean(
      env,
      "CMS_ALLOW_UNAUTHENTICATED",
      options.allowUnauthenticatedByDefault ?? false,
    ),
    maxBodyBytes: readInteger(env, "CMS_MAX_BODY_BYTES", 4 * 1024 * 1024),
    onError:
      options.onError ??
      ((error, request) => {
        console.error(
          "[echoes-studio] request failed",
          request.method,
          request.url,
          error,
        );
      }),
  });
}
