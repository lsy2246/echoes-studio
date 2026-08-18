import {
  AppError,
  badRequest,
  conflict,
  localizeErrorMessage,
  notFound,
} from "../core/errors";
import { parseFrontmatter, titleFromFrontmatter } from "../core/frontmatter";
import { constantTimeEqual, sha256Text } from "../core/hash";
import { hashPassword, verifyPassword } from "../core/password";
import { createAdminSession, verifyAdminSession } from "../core/session";
import {
  RepositoryBatchContentConflictError,
  RepositoryContentConflictError,
  type RepositoryBatchPublishChange,
  type RepositoryPublishResult,
} from "../core/git-repository-port";
import type {
  Article,
  ArticleFormat,
  ArticleRevisionKind,
  Draft,
  Frontmatter,
  ImportArticleInput,
  JsonValue,
} from "../core/types";
import type { AuthScope, CreateAppOptions } from "./types";

const DEFAULT_MAX_BODY_BYTES = 2 * 1024 * 1024;
const SESSION_COOKIE = "echoes_session";
// The JWT itself intentionally has no exp claim. A persistent cookie still
// needs a browser retention bound; 400 days matches current browser caps and
// is renewed by signing in again. The product exposes no expiry setting.
const SESSION_COOKIE_MAX_AGE = 400 * 24 * 60 * 60;

function randomSecret(bytes = 32): string {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  return new Response(JSON.stringify(data), { ...init, headers });
}

function errorResponse(error: AppError, requestId: string): Response {
  const headers = new Headers();
  if (
    error.code === "method_not_allowed" &&
    isRecord(error.details) &&
    Array.isArray(error.details.allowed)
  ) {
    headers.set("allow", error.details.allowed.join(", "));
  }
  return json(
    {
      error: {
        code: error.code,
        message: localizeErrorMessage(error),
        details: error.details,
      },
      requestId,
    },
    { status: error.status, headers },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(
  value: unknown,
  field: string,
  options: { max?: number; allowEmpty?: boolean } = {},
): string {
  if (typeof value !== "string" || (!options.allowEmpty && !value.trim())) {
    throw badRequest(`${field} must be a non-empty string`);
  }
  if (value.length > (options.max ?? 10_000))
    throw badRequest(`${field} is too long`);
  return value;
}

function optionalInteger(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw badRequest(`${field} must be a non-negative integer`);
  }
  return Number(value);
}

function githubRepositoryCoordinates(value: unknown): {
  owner: string;
  repository: string;
} {
  const raw = requiredString(value, "repositoryUrl", { max: 512 }).trim();
  const normalized = raw
    .replace(/^git@github\.com:/i, "")
    .replace(/^https?:\/\/(?:www\.)?github\.com\//i, "")
    .replace(/\.git$/i, "")
    .replace(/^\/+|\/+$/g, "");
  const [owner, repository, ...rest] = normalized.split("/");
  if (
    !owner ||
    !repository ||
    rest.length ||
    !/^[\w.-]+$/.test(owner) ||
    !/^[\w.-]+$/.test(repository)
  ) {
    throw badRequest(
      "repositoryUrl must be a GitHub owner/repository name or URL",
    );
  }
  return { owner, repository };
}

function boundedInteger(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): number {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < minimum ||
    Number(value) > maximum
  ) {
    throw badRequest(
      `${field} must be an integer between ${minimum} and ${maximum}`,
    );
  }
  return Number(value);
}

function articlePath(value: unknown): string {
  const path = requiredString(value, "path", { max: 512 });
  if (
    path !== path.trim() ||
    path.startsWith("/") ||
    path.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(path) ||
    path.split("/").some((part) => !part || part === ".." || part === ".") ||
    !/\.mdx?$/i.test(path)
  )
    throw badRequest("path must be a safe relative .md or .mdx path");
  return path;
}

function articleFormat(path: string, value?: unknown): ArticleFormat {
  const inferred: ArticleFormat = path.toLocaleLowerCase().endsWith(".mdx")
    ? "mdx"
    : "md";
  if (value === undefined) return inferred;
  if (value !== "md" && value !== "mdx")
    throw badRequest("format must be md or mdx");
  if (!path.toLocaleLowerCase().endsWith(`.${value}`)) {
    throw badRequest("format must match the file extension");
  }
  return value;
}

function validateFrontmatter(value: unknown): Frontmatter {
  if (!isRecord(value)) throw badRequest("frontmatter must be an object");
  try {
    JSON.stringify(value as JsonValue);
  } catch {
    throw badRequest("frontmatter must contain only JSON values");
  }
  return value as Frontmatter;
}

function parseVersion(
  request: Request,
  body?: Record<string, unknown>,
): number {
  const rawHeader = request.headers.get("if-match")?.trim();
  if (rawHeader) {
    const match = rawHeader.match(/^(?:W\/)?"?(\d+)"?$/);
    if (!match)
      throw badRequest("If-Match must contain the numeric resource version");
    return Number(match[1]);
  }
  const bodyVersion = optionalInteger(
    body?.expectedVersion ?? body?.version,
    "version",
  );
  if (bodyVersion !== undefined) return bodyVersion;
  throw new AppError(
    428,
    "precondition_required",
    "If-Match or expectedVersion is required",
  );
}

function articleMetadata(
  article: Article,
  draft: Draft | null,
): Record<string, unknown> {
  const parsed = draft
    ? parseFrontmatter(draft.source).frontmatter
    : article.frontmatter;
  const metadata: Record<string, unknown> = {
    ...parsed,
    title: typeof parsed.title === "string" ? parsed.title : article.title,
    date: typeof parsed.date === "string" ? parsed.date : "",
    tags: Array.isArray(parsed.tags)
      ? parsed.tags.filter((tag): tag is string => typeof tag === "string")
      : [],
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
  };
  delete metadata.draft;
  return metadata;
}

function articleSummary(
  article: Article,
  draft: Draft | null,
  hasConflict = false,
): Record<string, unknown> {
  return {
    id: article.id,
    path: article.path,
    format: article.format,
    syncStatus: hasConflict
      ? "conflict"
      : draft?.operation === "delete"
        ? "deleting"
        : draft
          ? "unpublished"
          : "synced",
    metadata: articleMetadata(article, draft),
    updatedAt: draft?.updatedAt ?? article.updatedAt,
    publishedAt: article.gitCommitSha ? article.updatedAt : null,
    // Zero means the first draft write should use compare-and-swap create.
    version: draft?.version ?? 0,
  };
}

function articleDocument(
  article: Article,
  draft: Draft | null,
  hasConflict = false,
): Record<string, unknown> {
  return {
    ...articleSummary(article, draft, hasConflict),
    source: draft?.source ?? article.source,
    baseGitHash: article.contentHash,
  };
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

function cookieValue(request: Request, name: string): string | null {
  const cookies = request.headers.get("cookie") ?? "";
  for (const entry of cookies.split(";")) {
    const separator = entry.indexOf("=");
    if (separator < 0 || entry.slice(0, separator).trim() !== name) continue;
    return entry.slice(separator + 1).trim() || null;
  }
  return null;
}

function sessionCookie(token: string, request: Request, clear = false): string {
  const attributes = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    clear ? "Max-Age=0" : `Max-Age=${SESSION_COOKIE_MAX_AGE}`,
  ];
  if (new URL(request.url).protocol === "https:") attributes.push("Secure");
  return attributes.join("; ");
}

async function readJson(
  request: Request,
  maxBodyBytes: number,
): Promise<Record<string, unknown>> {
  const contentType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    .trim();
  if (contentType !== "application/json") {
    throw new AppError(
      415,
      "unsupported_media_type",
      "Content-Type must be application/json",
    );
  }
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > maxBodyBytes) {
    throw new AppError(413, "payload_too_large", "Request body is too large");
  }
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > maxBodyBytes) {
    throw new AppError(413, "payload_too_large", "Request body is too large");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw badRequest("Request body is not valid JSON");
  }
  if (!isRecord(parsed)) throw badRequest("Request body must be a JSON object");
  return parsed;
}

function methodNotAllowed(allowed: string[]): never {
  throw new AppError(
    405,
    "method_not_allowed",
    `Allowed methods: ${allowed.join(", ")}`,
    {
      allowed,
    },
  );
}

export function createApp(
  options: CreateAppOptions,
): (request: Request) => Promise<Response> {
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const now = () => (options.now?.() ?? new Date()).toISOString();
  const id = options.id ?? (() => crypto.randomUUID());
  let generatedSecretsPromise: ReturnType<
    typeof ensureGeneratedSecrets
  > | null = null;

  async function ensureGeneratedSecrets() {
    const stored = await options.database.getSystemSettings();
    if (stored.installationSecret && stored.internalToken) return stored;
    return options.database.updateSystemSettings({
      installationSecret: stored.installationSecret ?? randomSecret(),
      internalToken: stored.internalToken ?? randomSecret(),
      now: now(),
    });
  }

  async function generatedSecrets() {
    generatedSecretsPromise ??= ensureGeneratedSecrets();
    try {
      return await generatedSecretsPromise;
    } catch (error) {
      generatedSecretsPromise = null;
      throw error;
    }
  }

  async function passwordIdentity(): Promise<string | null> {
    const stored = await options.database.getSystemSettings();
    return stored.passwordHash ?? options.adminToken ?? null;
  }

  async function matchesAdminPassword(password: string): Promise<boolean> {
    const stored = await options.database.getSystemSettings();
    return stored.passwordHash
      ? verifyPassword(password, stored.passwordHash)
      : Boolean(
          options.adminToken && constantTimeEqual(password, options.adminToken),
        );
  }

  async function effectiveSessionSecret(): Promise<string | null> {
    const baseSecret =
      options.sessionSecret ?? (await generatedSecrets()).installationSecret;
    if (!baseSecret) return null;
    const identity = await passwordIdentity();
    return identity ? `${baseSecret}:${identity}` : baseSecret;
  }

  async function effectiveInternalToken(): Promise<string | null> {
    return options.internalToken ?? (await generatedSecrets()).internalToken;
  }

  async function recordRevision(
    articleId: string,
    kind: ArticleRevisionKind,
    path: string,
    source: string,
    contentHash: string,
    gitCommitSha: string | null = null,
  ): Promise<void> {
    const latest = (
      await options.database.listArticleRevisions(articleId, 1)
    )[0];
    if (
      latest &&
      latest.path === path &&
      latest.contentHash === contentHash &&
      latest.kind === kind
    )
      return;
    if (kind === "autosave" && latest?.kind === "autosave") {
      const elapsed = Date.now() - new Date(latest.createdAt).getTime();
      if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < 5 * 60_000)
        return;
    }
    await options.database.createArticleRevision({
      id: id(),
      articleId,
      kind,
      path,
      source,
      contentHash,
      gitCommitSha,
      now: now(),
    });
  }

  async function authorize(request: Request, scope: AuthScope): Promise<void> {
    if (options.authorize) {
      if (await options.authorize(request, scope)) return;
      throw new AppError(403, "forbidden", "Access denied");
    }
    if (options.allowUnauthenticated === true) return;
    const actual = bearerToken(request);
    if (scope === "internal") {
      const expected = await effectiveInternalToken();
      if (expected && actual && constantTimeEqual(actual, expected)) return;
      throw new AppError(
        401,
        "unauthorized",
        "A valid bearer token is required",
      );
    }
    if (
      options.adminToken &&
      actual &&
      constantTimeEqual(actual, options.adminToken)
    )
      return;
    const sessionSecret = await effectiveSessionSecret();
    if (sessionSecret) {
      const session = cookieValue(request, SESSION_COOKIE);
      if (session && (await verifyAdminSession(session, sessionSecret))) return;
    }
    if (!(await passwordIdentity())) {
      throw new AppError(
        503,
        "service_unavailable",
        "Password login is not configured",
      );
    }
    throw new AppError(401, "unauthorized", "A valid bearer token is required");
  }

  async function synchronizeRepository(): Promise<Record<string, unknown>> {
    try {
      const snapshot = await options.repository.snapshot();
      if (!snapshot.repositoryId.trim() || !snapshot.branch.trim()) {
        throw new AppError(
          502,
          "bad_gateway",
          "Repository returned an invalid identity",
        );
      }
      if (!/^[0-9a-f]{7,64}$/i.test(snapshot.headCommit)) {
        throw new AppError(
          502,
          "bad_gateway",
          "Repository returned an invalid head commit",
        );
      }
      const articles: ImportArticleInput[] = [];
      const seenPaths = new Set<string>();
      for (const [index, entry] of snapshot.articles.entries()) {
        const pathValue = articlePath(entry.path);
        if (seenPaths.has(pathValue)) {
          throw new AppError(
            502,
            "bad_gateway",
            `Repository returned duplicate path ${pathValue}`,
          );
        }
        seenPaths.add(pathValue);
        if (new TextEncoder().encode(entry.source).byteLength > maxBodyBytes) {
          throw new AppError(
            413,
            "payload_too_large",
            `Repository article ${index} is too large`,
          );
        }
        const contentHash = await sha256Text(entry.source);
        if (
          entry.contentHash !== undefined &&
          entry.contentHash !== contentHash
        ) {
          throw new AppError(
            502,
            "bad_gateway",
            `Repository hash mismatch for ${pathValue}`,
          );
        }
        const parsed = parseFrontmatter(entry.source);
        articles.push({
          path: pathValue,
          format: articleFormat(pathValue, entry.format),
          source: entry.source,
          contentHash,
          frontmatter: parsed.frontmatter,
          title: titleFromFrontmatter(parsed.frontmatter, pathValue),
        });
      }
      const databasePaths = new Set<string>();
      let cursor: string | undefined;
      do {
        const page = await options.database.listArticles({
          cursor,
          limit: 100,
        });
        for (const article of page.items) databasePaths.add(article.path);
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      const deletedPaths = [...databasePaths].filter(
        (pathValue) => !seenPaths.has(pathValue),
      );
      const result = await options.database.importBatch({
        checkpointId: `${snapshot.repositoryId}:${snapshot.branch}:${snapshot.headCommit}`,
        commitSha: snapshot.headCommit,
        articles,
        deletedPaths,
        now: now(),
      });
      return {
        repositoryId: snapshot.repositoryId,
        branch: snapshot.branch,
        headCommit: snapshot.headCommit,
        ...result,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        502,
        "bad_gateway",
        "Repository synchronization failed",
      );
    }
  }

  async function synchronizeAndRecord(): Promise<Record<string, unknown>> {
    const result = await synchronizeRepository();
    const completedAt = now();
    await options.database.updateAutomationSettings({
      lastAutoSyncAt: completedAt,
      now: completedAt,
    });
    return result;
  }

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (path === "/api/health") {
      if (request.method !== "GET") methodNotAllowed(["GET"]);
      const health = await options.database.health();
      return json({ data: health }, { status: health.ok ? 200 : 503 });
    }

    if (path === "/api/setup/status") {
      if (request.method !== "GET") methodNotAllowed(["GET"]);
      return json({
        data: {
          required:
            !(await passwordIdentity()) &&
            options.allowUnauthenticated !== true,
          database: (await options.database.health()).adapter,
        },
      });
    }

    if (path === "/api/setup/initialize") {
      if (request.method !== "POST") methodNotAllowed(["POST"]);
      if (options.allowUnauthenticated === true) {
        throw new AppError(
          409,
          "conflict",
          "Setup is disabled while authentication is bypassed",
        );
      }
      if (await passwordIdentity()) {
        throw new AppError(
          409,
          "conflict",
          "Studio has already been initialized",
        );
      }
      const body = await readJson(request, Math.min(maxBodyBytes, 8192));
      const password = requiredString(body.password, "password", { max: 1024 });
      if (password.length < 8)
        throw badRequest("password must contain at least 8 characters");
      const current = await generatedSecrets();
      if (body.repositoryUrl !== undefined || body.githubToken !== undefined) {
        if (!options.repositorySettings) {
          throw new AppError(
            503,
            "service_unavailable",
            "Repository settings are unavailable",
          );
        }
        const coordinates = githubRepositoryCoordinates(body.repositoryUrl);
        await options.repositorySettings.update({
          provider: "github",
          ...coordinates,
          branch: typeof body.branch === "string" ? body.branch : "",
          contentRoot:
            typeof body.contentRoot === "string"
              ? body.contentRoot
              : "src/content",
          token: requiredString(body.githubToken, "githubToken", { max: 4096 }),
        });
      }
      const passwordHash = await hashPassword(password);
      await options.database.updateSystemSettings({
        passwordHash,
        installationSecret: current.installationSecret,
        internalToken: current.internalToken,
        now: now(),
      });
      const sessionSecret = await effectiveSessionSecret();
      if (!sessionSecret)
        throw new AppError(
          503,
          "service_unavailable",
          "Password login is not configured",
        );
      const token = await createAdminSession(sessionSecret, new Date(now()));
      return json(
        { data: { initialized: true } },
        {
          status: 201,
          headers: { "set-cookie": sessionCookie(token, request) },
        },
      );
    }

    if (path === "/api/auth/login") {
      if (request.method !== "POST") methodNotAllowed(["POST"]);
      const sessionSecret = await effectiveSessionSecret();
      if (!(await passwordIdentity()) || !sessionSecret) {
        throw new AppError(
          503,
          "service_unavailable",
          "Password login is not configured",
        );
      }
      const body = await readJson(request, Math.min(maxBodyBytes, 4096));
      const password = requiredString(body.password, "password", { max: 1024 });
      if (!(await matchesAdminPassword(password))) {
        throw new AppError(
          401,
          "unauthorized",
          "A valid bearer token is required",
        );
      }
      const token = await createAdminSession(sessionSecret, new Date(now()));
      return json(
        { data: { authenticated: true } },
        {
          headers: { "set-cookie": sessionCookie(token, request) },
        },
      );
    }

    if (path === "/api/auth/logout") {
      if (request.method !== "POST") methodNotAllowed(["POST"]);
      return json(
        { data: { authenticated: false } },
        {
          headers: { "set-cookie": sessionCookie("", request, true) },
        },
      );
    }

    if (path === "/api/internal/reconcile") {
      await authorize(request, "internal");
      if (request.method !== "POST") methodNotAllowed(["POST"]);
      if (url.searchParams.get("scheduled") === "true") {
        const settings = await options.database.getAutomationSettings();
        if (settings.autoSyncMinutes === 0) {
          return json({
            data: { skipped: true, reason: "automatic_sync_disabled" },
          });
        }
        const last = settings.lastAutoSyncAt
          ? new Date(settings.lastAutoSyncAt).getTime()
          : 0;
        const current = new Date(now()).getTime();
        const dueAt = last + settings.autoSyncMinutes * 60_000;
        if (last > 0 && current < dueAt) {
          return json({
            data: {
              skipped: true,
              reason: "not_due",
              nextSyncAt: new Date(dueAt).toISOString(),
            },
          });
        }
      }
      return json({ data: await synchronizeAndRecord() });
    }

    await authorize(request, "admin");

    if (path === "/api/settings/internal-token") {
      if (request.method === "GET") {
        return json({ data: { token: await effectiveInternalToken() } });
      }
      if (request.method === "POST") {
        if (options.internalToken) {
          throw new AppError(
            409,
            "conflict",
            "Internal token is managed by the deployment environment",
          );
        }
        const settings = await options.database.updateSystemSettings({
          internalToken: randomSecret(),
          now: now(),
        });
        generatedSecretsPromise = Promise.resolve(settings);
        return json({ data: { token: settings.internalToken } });
      }
      methodNotAllowed(["GET", "POST"]);
    }

    if (path === "/api/settings/password") {
      if (request.method !== "POST") methodNotAllowed(["POST"]);
      const body = await readJson(request, Math.min(maxBodyBytes, 8192));
      const currentPassword = requiredString(
        body.currentPassword,
        "currentPassword",
        { max: 1024 },
      );
      const newPassword = requiredString(body.newPassword, "newPassword", {
        max: 1024,
      });
      if (newPassword.length < 8)
        throw badRequest("newPassword must contain at least 8 characters");
      if (!(await matchesAdminPassword(currentPassword))) {
        throw new AppError(
          401,
          "unauthorized",
          "Current password is incorrect",
        );
      }
      const passwordHash = await hashPassword(newPassword);
      await options.database.updateSystemSettings({ passwordHash, now: now() });
      const nextSecret = await effectiveSessionSecret();
      if (!nextSecret)
        throw new AppError(
          503,
          "service_unavailable",
          "Password login is not configured",
        );
      const token = await createAdminSession(nextSecret, new Date(now()));
      return json(
        { data: { changed: true } },
        {
          headers: { "set-cookie": sessionCookie(token, request) },
        },
      );
    }

    if (path === "/api/settings/repository") {
      if (!options.repositorySettings)
        throw new AppError(
          503,
          "service_unavailable",
          "Repository settings are unavailable",
        );
      if (request.method === "GET")
        return json({ data: await options.repositorySettings.get() });
      if (request.method === "PUT") {
        const body = await readJson(request, Math.min(maxBodyBytes, 64 * 1024));
        if (body.provider !== "filesystem" && body.provider !== "github") {
          throw badRequest("provider must be filesystem or github");
        }
        try {
          return json({
            data: await options.repositorySettings.update({
              provider: body.provider,
              owner: typeof body.owner === "string" ? body.owner : undefined,
              repository:
                typeof body.repository === "string"
                  ? body.repository
                  : undefined,
              branch: typeof body.branch === "string" ? body.branch : undefined,
              contentRoot: requiredString(body.contentRoot, "contentRoot", {
                max: 512,
              }),
              filesystemPath:
                typeof body.filesystemPath === "string"
                  ? body.filesystemPath
                  : undefined,
              token: typeof body.token === "string" ? body.token : undefined,
              clearToken: body.clearToken === true,
            }),
          });
        } catch (error) {
          if (error instanceof AppError) throw error;
          throw badRequest(
            error instanceof Error
              ? error.message
              : "Repository settings are invalid",
          );
        }
      }
      methodNotAllowed(["GET", "PUT"]);
    }

    if (path === "/api/repository/status") {
      if (request.method !== "GET") methodNotAllowed(["GET"]);
      try {
        return json({ data: await options.repository.status() });
      } catch {
        throw new AppError(
          502,
          "bad_gateway",
          "Repository status is unavailable",
        );
      }
    }

    if (path === "/api/repository/sync") {
      if (request.method !== "POST") methodNotAllowed(["POST"]);
      return json({ data: await synchronizeAndRecord() });
    }

    if (path === "/api/settings/automation") {
      if (request.method === "GET") {
        return json({ data: await options.database.getAutomationSettings() });
      }
      if (request.method === "PATCH") {
        const body = await readJson(request, maxBodyBytes);
        const autoSaveSeconds =
          body.autoSaveSeconds === undefined
            ? undefined
            : boundedInteger(body.autoSaveSeconds, "autoSaveSeconds", 1, 30);
        const autoSyncMinutes =
          body.autoSyncMinutes === undefined
            ? undefined
            : boundedInteger(body.autoSyncMinutes, "autoSyncMinutes", 0, 1440);
        if (autoSaveSeconds === undefined && autoSyncMinutes === undefined) {
          throw badRequest("At least one automation setting is required");
        }
        return json({
          data: await options.database.updateAutomationSettings({
            autoSaveSeconds,
            autoSyncMinutes,
            now: now(),
          }),
        });
      }
      methodNotAllowed(["GET", "PATCH"]);
    }

    if (path === "/api/articles/publish-batch") {
      if (request.method !== "POST") methodNotAllowed(["POST"]);
      const body = await readJson(request, maxBodyBytes);
      if (
        !Array.isArray(body.items) ||
        body.items.length === 0 ||
        body.items.length > 100
      ) {
        throw badRequest("items must contain between 1 and 100 articles");
      }
      const mode = body.mode === undefined ? "direct" : body.mode;
      if (mode !== "direct")
        throw badRequest("Batch publishing currently requires direct mode");
      if (
        body.commitMessage !== undefined &&
        typeof body.commitMessage !== "string"
      ) {
        throw badRequest("commitMessage must be a string");
      }
      const commitMessage =
        typeof body.commitMessage === "string"
          ? body.commitMessage.trim()
          : undefined;
      if (body.commitMessage !== undefined && !commitMessage)
        throw badRequest("commitMessage must not be empty");
      if (commitMessage && commitMessage.length > 200)
        throw badRequest("commitMessage must be at most 200 characters");

      const requested = body.items.map((value, index) => {
        if (!isRecord(value))
          throw badRequest(`items[${index}] must be an object`);
        const articleId = requiredString(value.id, `items[${index}].id`, {
          max: 200,
        });
        const expectedVersion = optionalInteger(
          value.expectedVersion,
          `items[${index}].expectedVersion`,
        );
        if (expectedVersion === undefined) {
          throw new AppError(
            428,
            "precondition_required",
            `items[${index}].expectedVersion is required`,
          );
        }
        return { articleId, expectedVersion };
      });
      if (
        new Set(requested.map((item) => item.articleId)).size !==
        requested.length
      ) {
        throw badRequest("items must not contain duplicate article ids");
      }

      const prepared: Array<{
        article: Article;
        draft: Draft;
        publicationId: string;
        change: RepositoryBatchPublishChange;
        publicationCreated: boolean;
      }> = [];
      for (const item of requested) {
        const article = await options.database.getArticle(item.articleId);
        if (!article) throw notFound("Article not found");
        const draft = await options.database.getDraft(item.articleId);
        if (!draft) throw notFound("Draft not found");
        if (draft.version !== item.expectedVersion) {
          throw conflict("Draft version is stale", {
            articleId: item.articleId,
            currentVersion: draft.version,
          });
        }
        const existingConflict =
          await options.database.getOpenContentConflictByArticle(
            item.articleId,
          );
        if (existingConflict) {
          throw conflict(
            "Resolve the open content conflict before publishing",
            {
              articleId: item.articleId,
              conflictId: existingConflict.id,
            },
          );
        }
        const publicationId = id();
        const change: RepositoryBatchPublishChange =
          draft.operation === "delete"
            ? {
                operation: "delete",
                publicationId,
                path: draft.basePath ?? article.path,
                baseContentHash: draft.baseContentHash,
              }
            : {
                operation: "upsert",
                publicationId,
                path: article.path,
                previousPath:
                  draft.basePath && draft.basePath !== article.path
                    ? draft.basePath
                    : undefined,
                source: draft.source,
                contentHash: draft.contentHash,
                basePath: draft.basePath,
                baseContentHash: draft.baseContentHash,
              };
        prepared.push({
          article,
          draft,
          publicationId,
          change,
          publicationCreated: false,
        });
      }

      for (const item of prepared) {
        if (item.change.operation === "delete") continue;
        await recordRevision(
          item.article.id,
          "publish",
          item.article.path,
          item.draft.source,
          item.draft.contentHash,
          item.article.gitCommitSha,
        );
        await options.database.createPublication({
          id: item.publicationId,
          articleId: item.article.id,
          articlePath: item.article.path,
          source: item.draft.source,
          contentHash: item.draft.contentHash,
          draftVersion: item.draft.version,
          now: now(),
        });
        await options.database.markPublicationDispatched(
          item.publicationId,
          now(),
        );
        item.publicationCreated = true;
      }

      const failPublications = async (message: string) => {
        await Promise.all(
          prepared
            .filter((item) => item.publicationCreated)
            .map((item) =>
              options.database.completePublication({
                id: item.publicationId,
                status: "failed",
                error: message,
                now: now(),
              }),
            ),
        );
      };

      let result: RepositoryPublishResult;
      try {
        result = await options.repository.publishBatch({
          batchId: id(),
          changes: prepared.map((item) => item.change),
          mode: "direct",
          commitMessage,
        });
      } catch (error) {
        options.onError?.(error, request);
        await failPublications("Repository batch publish failed");
        if (error instanceof RepositoryBatchContentConflictError) {
          const recordedIds: string[] = [];
          for (const entry of error.conflicts) {
            const item = prepared.find(
              (candidate) => candidate.publicationId === entry.publicationId,
            );
            if (!item) continue;
            const recorded = await options.database.recordContentConflict({
              id: id(),
              articleId: item.article.id,
              kind: entry.snapshot.kind,
              basePath: item.draft.basePath,
              baseSource: item.draft.baseSource,
              baseHash: item.draft.baseContentHash,
              remotePath: entry.snapshot.remotePath,
              remoteSource: entry.snapshot.remoteSource,
              remoteHash: entry.snapshot.remoteContentHash,
              remoteCommitSha: entry.snapshot.remoteCommitSha,
              draftPath: item.article.path,
              draftSource: item.draft.source,
              draftHash: item.draft.contentHash,
              draftVersion: item.draft.version,
              now: now(),
            });
            recordedIds.push(recorded.id);
          }
          throw conflict(
            "Repository and CMS both changed one or more selected articles",
            { conflictIds: recordedIds },
          );
        }
        throw new AppError(
          502,
          "bad_gateway",
          "Repository batch publish failed",
        );
      }
      if (
        result.mode !== "direct" ||
        result.status !== "published" ||
        !result.commitSha
      ) {
        await failPublications(
          "Repository returned an invalid batch publish result",
        );
        throw new AppError(
          502,
          "bad_gateway",
          "Repository returned an invalid batch publish result",
        );
      }
      if (!/^[0-9a-f]{7,64}$/i.test(result.commitSha)) {
        await failPublications("Repository returned an invalid commit SHA");
        throw new AppError(
          502,
          "bad_gateway",
          "Repository returned an invalid commit SHA",
        );
      }

      const articles: Array<Record<string, unknown> | null> = [];
      for (const item of prepared) {
        if (item.change.operation === "delete") {
          if (
            !(await options.database.deleteArticle(
              item.article.id,
              item.article.version,
            ))
          ) {
            throw conflict("Article changed while completing batch deletion", {
              articleId: item.article.id,
            });
          }
          articles.push(null);
          continue;
        }
        await options.database.completePublication({
          id: item.publicationId,
          status: "published",
          contentHash: item.draft.contentHash,
          commitSha: result.commitSha,
          now: now(),
        });
        const article = await options.database.getArticle(item.article.id);
        articles.push(
          article
            ? articleDocument(
                article,
                await options.database.getDraft(article.id),
              )
            : null,
        );
      }
      return json({
        articles,
        publicationIds: prepared.map((item) => item.publicationId),
        commitSha: result.commitSha,
        branch: result.branch ?? null,
      });
    }

    if (path === "/api/conflicts") {
      if (request.method !== "GET") methodNotAllowed(["GET"]);
      return json({ data: await options.database.listContentConflicts() });
    }

    const conflictResolveRoute = path.match(
      /^\/api\/conflicts\/([^/]+)\/resolve$/,
    );
    if (conflictResolveRoute) {
      if (request.method !== "POST") methodNotAllowed(["POST"]);
      const conflictId = decodeURIComponent(conflictResolveRoute[1]);
      const currentConflict =
        await options.database.getContentConflict(conflictId);
      if (!currentConflict || currentConflict.status !== "open")
        throw notFound("Content conflict not found");
      const article = await options.database.getArticle(
        currentConflict.articleId,
      );
      const draft = await options.database.getDraft(currentConflict.articleId);
      if (!article || !draft)
        throw conflict("The conflicted article or draft no longer exists");
      const body = await readJson(request, maxBodyBytes);
      const resolution = requiredString(body.resolution, "resolution", {
        max: 20,
      });
      if (
        !(["remote", "cms", "merged"] as const).includes(
          resolution as "remote" | "cms" | "merged",
        )
      ) {
        throw badRequest("resolution must be remote, cms or merged");
      }
      if (resolution === "remote") {
        if (currentConflict.remoteCommitSha.startsWith("cms-draft-v")) {
          await options.database.resolveContentConflict(
            conflictId,
            "remote",
            now(),
          );
          return json({
            data: { ...article, draft, syncStatus: "unpublished" },
          });
        }
        if (!(await options.database.deleteDraft(article.id, draft.version))) {
          throw conflict("Draft changed while resolving the conflict");
        }
        await options.database.resolveContentConflict(
          conflictId,
          "remote",
          now(),
        );
        if (currentConflict.kind === "path_collision") {
          if (
            !currentConflict.basePath ||
            currentConflict.baseSource === null
          ) {
            await options.database.deleteArticle(article.id, article.version);
            return json({ data: null });
          }
          const parsed = parseFrontmatter(currentConflict.baseSource);
          const restored = await options.database.updateArticle(article.id, {
            expectedVersion: article.version,
            path: currentConflict.basePath,
            format: articleFormat(currentConflict.basePath),
            title: titleFromFrontmatter(
              parsed.frontmatter,
              currentConflict.basePath,
            ),
            frontmatter: parsed.frontmatter,
            source: currentConflict.baseSource,
            contentHash:
              currentConflict.baseHash ??
              (await sha256Text(currentConflict.baseSource)),
            gitCommitSha: currentConflict.remoteCommitSha,
            now: now(),
          });
          return json({
            data: restored
              ? { ...restored, draft: null, syncStatus: "synced" }
              : null,
          });
        }
        if (
          currentConflict.remotePath === null ||
          currentConflict.remoteSource === null
        ) {
          await options.database.deleteArticle(article.id, article.version);
          return json({ data: null });
        }
        const parsed = parseFrontmatter(currentConflict.remoteSource);
        const accepted = await options.database.updateArticle(article.id, {
          expectedVersion: article.version,
          path: currentConflict.remotePath,
          format: articleFormat(currentConflict.remotePath),
          title: titleFromFrontmatter(
            parsed.frontmatter,
            currentConflict.remotePath,
          ),
          frontmatter: parsed.frontmatter,
          source: currentConflict.remoteSource,
          contentHash:
            currentConflict.remoteHash ??
            (await sha256Text(currentConflict.remoteSource)),
          gitCommitSha: currentConflict.remoteCommitSha,
          now: now(),
        });
        return json({
          data: accepted
            ? { ...accepted, draft: null, syncStatus: "synced" }
            : null,
        });
      }

      const resolvedSource =
        resolution === "merged"
          ? requiredString(body.mergedSource, "mergedSource", {
              max: maxBodyBytes,
              allowEmpty: true,
            })
          : currentConflict.draftSource;
      parseFrontmatter(resolvedSource);
      const resolvedPath =
        body.mergedPath === undefined
          ? article.path
          : articlePath(body.mergedPath);
      const contentHash = await sha256Text(resolvedSource);
      const cmsConcurrent =
        currentConflict.remoteCommitSha.startsWith("cms-draft-v");
      const comparePath = cmsConcurrent
        ? (draft.basePath ?? resolvedPath)
        : (currentConflict.remotePath ??
          currentConflict.basePath ??
          resolvedPath);
      const compareHash = cmsConcurrent
        ? draft.baseContentHash
        : currentConflict.remoteHash;
      const previousPath = cmsConcurrent
        ? draft.basePath
        : currentConflict.basePath;
      let publication = await options.database.createPublication({
        id: id(),
        articleId: article.id,
        articlePath: resolvedPath,
        source: resolvedSource,
        contentHash,
        draftVersion: draft.version,
        now: now(),
      });
      await options.database.markPublicationDispatched(publication.id, now());
      try {
        const result = await options.repository.publish({
          publicationId: publication.id,
          path: resolvedPath,
          previousPath:
            previousPath && previousPath !== resolvedPath
              ? previousPath
              : undefined,
          source: resolvedSource,
          contentHash,
          mode: "direct",
          basePath: previousPath,
          remoteCheckPath: comparePath,
          baseContentHash: compareHash,
          expectedHeadCommit: currentConflict.remoteCommitSha,
        });
        if (result.status !== "published" || !result.commitSha) {
          throw new Error(
            "Conflict resolution did not complete the direct publish",
          );
        }
        publication = (await options.database.completePublication({
          id: publication.id,
          status: "published",
          contentHash,
          commitSha: result.commitSha,
          now: now(),
        }))!;
      } catch (error) {
        await options.database.completePublication({
          id: publication.id,
          status: "failed",
          error: "Conflict resolution publish failed",
          now: now(),
        });
        if (error instanceof RepositoryContentConflictError) {
          await options.database.recordContentConflict({
            id: currentConflict.id,
            articleId: article.id,
            kind: error.snapshot.kind,
            basePath: currentConflict.basePath,
            baseSource: currentConflict.baseSource,
            baseHash: currentConflict.baseHash,
            remotePath: error.snapshot.remotePath,
            remoteSource: error.snapshot.remoteSource,
            remoteHash: error.snapshot.remoteContentHash,
            remoteCommitSha: error.snapshot.remoteCommitSha,
            draftPath: resolvedPath,
            draftSource: resolvedSource,
            draftHash: contentHash,
            draftVersion: draft.version,
            now: now(),
          });
          throw conflict(
            "The remote article changed again; review the refreshed conflict",
          );
        }
        throw new AppError(
          502,
          "bad_gateway",
          "Conflict resolution publish failed",
        );
      }
      await options.database.resolveContentConflict(
        conflictId,
        resolution === "merged" ? "merged" : "cms",
        now(),
      );
      const published = await options.database.getArticle(article.id);
      return json({
        data: published
          ? { ...published, draft: null, syncStatus: "synced", publication }
          : null,
      });
    }

    if (path === "/api/articles") {
      if (request.method === "GET") {
        const limitValue = Number(url.searchParams.get("limit") ?? 30);
        if (
          !Number.isInteger(limitValue) ||
          limitValue < 1 ||
          limitValue > 100
        ) {
          throw badRequest("limit must be an integer between 1 and 100");
        }
        const result = await options.database.listArticles({
          limit: limitValue,
          cursor: url.searchParams.get("cursor") ?? undefined,
          search: url.searchParams.get("search")?.slice(0, 200),
        });
        const entries = await Promise.all(
          result.items.map(async (article) => ({
            article,
            draft: await options.database.getDraft(article.id),
            hasConflict: Boolean(
              await options.database.getOpenContentConflictByArticle(
                article.id,
              ),
            ),
          })),
        );
        const filtered = entries.map(({ article, draft, hasConflict }) => ({
          ...article,
          draft,
          syncStatus: hasConflict
            ? "conflict"
            : draft?.operation === "delete"
              ? "deleting"
              : undefined,
        }));
        return json({ items: filtered, nextCursor: result.nextCursor });
      }
      if (request.method === "POST") {
        const body = await readJson(request, maxBodyBytes);
        const pathValue = articlePath(body.path);
        const source = requiredString(body.source ?? "", "source", {
          max: maxBodyBytes,
          allowEmpty: true,
        });
        const parsed = parseFrontmatter(source);
        const metadata =
          body.frontmatter === undefined
            ? parsed.frontmatter
            : validateFrontmatter(body.frontmatter);
        const sourceHash = await sha256Text(source);
        const article = await options.database.createArticle({
          id: id(),
          path: pathValue,
          format: articleFormat(pathValue, body.format),
          title:
            body.title === undefined
              ? titleFromFrontmatter(metadata, pathValue)
              : requiredString(body.title, "title", { max: 300 }),
          frontmatter: metadata,
          source,
          contentHash: sourceHash,
          now: now(),
        });
        await recordRevision(
          article.id,
          "create",
          article.path,
          source,
          sourceHash,
        );
        let draft = null;
        if (body.createDraft !== false) {
          draft = await options.database.upsertDraft({
            articleId: article.id,
            basePath: null,
            expectedVersion: null,
            source,
            contentHash: sourceHash,
            baseContentHash: null,
            baseSource: null,
            now: now(),
          });
        }
        return json(articleDocument(article, draft), {
          status: 201,
          headers: {
            location: `/api/articles/${article.id}`,
            etag: `"${article.version}"`,
          },
        });
      }
      methodNotAllowed(["GET", "POST"]);
    }

    const draftRoute = path.match(/^\/api\/articles\/([^/]+)\/draft$/);
    if (draftRoute) {
      const articleId = decodeURIComponent(draftRoute[1]);
      const article = await options.database.getArticle(articleId);
      if (!article) throw notFound("Article not found");
      if (request.method === "GET") {
        const draft = await options.database.getDraft(articleId);
        if (!draft) throw notFound("Draft not found");
        return json(
          { data: draft },
          { headers: { etag: `"${draft.version}"` } },
        );
      }
      if (request.method === "PUT") {
        const body = await readJson(request, maxBodyBytes);
        const expectedVersion = parseVersion(request, body);
        const source = requiredString(body.source, "source", {
          max: maxBodyBytes,
          allowEmpty: true,
        });
        parseFrontmatter(source);
        const sourceHash = await sha256Text(source);
        const existingDraft = await options.database.getDraft(articleId);
        const openConflict =
          await options.database.getOpenContentConflictByArticle(articleId);
        if (existingDraft && existingDraft.version !== expectedVersion) {
          const proposedPath =
            body.path === undefined ? article.path : articlePath(body.path);
          if (
            existingDraft.source === source &&
            proposedPath === article.path
          ) {
            return json(
              {
                article: articleDocument(
                  article,
                  existingDraft,
                  Boolean(openConflict),
                ),
                savedAt: existingDraft.updatedAt,
              },
              { headers: { etag: `"${existingDraft.version}"` } },
            );
          }
          const recorded = await options.database.recordContentConflict({
            id: id(),
            articleId,
            kind: "edit_edit",
            basePath: existingDraft.basePath,
            baseSource: existingDraft.baseSource,
            baseHash: existingDraft.baseContentHash,
            remotePath: article.path,
            remoteSource: existingDraft.source,
            remoteHash: existingDraft.contentHash,
            remoteCommitSha: `cms-draft-v${existingDraft.version}`,
            draftPath: proposedPath,
            draftSource: source,
            draftHash: sourceHash,
            draftVersion: expectedVersion,
            now: now(),
          });
          throw conflict("Another device saved a newer CMS draft", {
            conflictId: recorded.id,
          });
        }
        const draftBasePath =
          existingDraft?.basePath ??
          (article.gitCommitSha ? article.path : null);
        let currentArticle = article;
        if (body.path !== undefined) {
          const nextPath = articlePath(body.path);
          if (nextPath !== article.path) {
            const renamed = await options.database.updateArticle(article.id, {
              expectedVersion: article.version,
              path: nextPath,
              format: articleFormat(nextPath),
              now: now(),
            });
            if (!renamed)
              throw conflict("Article changed while saving its path");
            currentArticle = renamed;
          }
        }
        // Returning byte-for-byte to the repository version should converge to
        // CLEAN instead of leaving a meaningless draft row behind. New local
        // articles have no Git commit yet, so they remain unpublished.
        if (
          currentArticle.gitCommitSha &&
          currentArticle.path === draftBasePath &&
          sourceHash === currentArticle.contentHash
        ) {
          if (existingDraft) {
            if (
              existingDraft.version !== expectedVersion ||
              !(await options.database.deleteDraft(articleId, expectedVersion))
            ) {
              throw conflict("Draft version is stale", {
                current: await options.database.getDraft(articleId),
              });
            }
          } else if (expectedVersion !== 0) {
            throw conflict("Draft version is stale", { current: null });
          }
          const savedAt = now();
          if (openConflict) {
            await options.database.resolveContentConflict(
              openConflict.id,
              "converged",
              savedAt,
            );
          }
          return json(
            {
              article: articleDocument(currentArticle, null),
              savedAt,
            },
            { headers: { etag: '"0"' } },
          );
        }
        const draft = await options.database.upsertDraft({
          articleId,
          basePath: draftBasePath,
          expectedVersion: expectedVersion === 0 ? null : expectedVersion,
          source,
          contentHash: sourceHash,
          baseContentHash:
            body.baseContentHash === undefined
              ? currentArticle.contentHash
              : body.baseContentHash === null
                ? null
                : requiredString(body.baseContentHash, "baseContentHash", {
                    max: 64,
                  }),
          baseSource: existingDraft?.baseSource ?? currentArticle.source,
          now: now(),
        });
        if (!draft)
          throw conflict("Draft version is stale", {
            current: await options.database.getDraft(articleId),
          });
        await recordRevision(
          articleId,
          currentArticle.path !== article.path ? "move" : "autosave",
          currentArticle.path,
          source,
          sourceHash,
          currentArticle.gitCommitSha,
        );
        return json(
          {
            article: articleDocument(
              currentArticle,
              draft,
              Boolean(openConflict),
            ),
            savedAt: draft.updatedAt,
          },
          { headers: { etag: `"${draft.version}"` } },
        );
      }
      if (request.method === "DELETE") {
        const body = await readJson(request, maxBodyBytes);
        const expectedVersion = parseVersion(request, body);
        const draft = await options.database.getDraft(articleId);
        if (!draft || draft.version !== expectedVersion) {
          throw conflict("Draft version is stale");
        }
        if (await options.database.getOpenContentConflictByArticle(articleId)) {
          throw conflict(
            "Resolve the open content conflict before discarding the draft",
          );
        }
        // A local-only article has no repository baseline to restore. In that
        // case discarding its sole draft removes the CMS record altogether.
        if (!article.gitCommitSha) {
          if (
            !(await options.database.deleteArticle(articleId, article.version))
          ) {
            throw conflict("Article version is stale", {
              currentVersion: article.version,
            });
          }
          return json({ data: null });
        }

        // Draft moves update the article lookup path so the tree can react
        // immediately. Restore that lookup path before dropping the draft.
        let restoredArticle = article;
        if (draft.basePath && draft.basePath !== article.path) {
          const restored = await options.database.updateArticle(articleId, {
            expectedVersion: article.version,
            path: draft.basePath,
            format: articleFormat(draft.basePath),
            now: now(),
          });
          if (!restored)
            throw conflict(
              "Article changed while restoring its repository path",
            );
          restoredArticle = restored;
        }
        if (!(await options.database.deleteDraft(articleId, expectedVersion))) {
          throw conflict("Draft version is stale");
        }
        return json({ data: articleDocument(restoredArticle, null) });
      }
      methodNotAllowed(["GET", "PUT", "DELETE"]);
    }

    const publishRoute = path.match(
      /^\/api\/articles\/([^/]+)\/(?:publications|publish)$/,
    );
    if (publishRoute) {
      if (request.method !== "POST") methodNotAllowed(["POST"]);
      const articleId = decodeURIComponent(publishRoute[1]);
      const article = await options.database.getArticle(articleId);
      if (!article) throw notFound("Article not found");
      const body = await readJson(request, maxBodyBytes);
      const draft = await options.database.getDraft(articleId);
      if (!draft) throw notFound("Draft not found");
      if (
        body.commitMessage !== undefined &&
        typeof body.commitMessage !== "string"
      ) {
        throw badRequest("commitMessage must be a string");
      }
      const commitMessage =
        typeof body.commitMessage === "string"
          ? body.commitMessage.trim()
          : undefined;
      if (body.commitMessage !== undefined && !commitMessage) {
        throw badRequest("commitMessage must not be empty");
      }
      if (commitMessage && commitMessage.length > 200) {
        throw badRequest("commitMessage must be at most 200 characters");
      }
      const existingConflict =
        await options.database.getOpenContentConflictByArticle(articleId);
      if (existingConflict) {
        throw conflict("Resolve the open content conflict before publishing", {
          conflictId: existingConflict.id,
        });
      }
      const expectedDraftVersion = parseVersion(request, body);
      if (draft.version !== expectedDraftVersion) {
        throw conflict("Draft version is stale", {
          currentVersion: draft.version,
        });
      }
      const mode = body.mode === undefined ? "direct" : body.mode;
      if (mode !== "pull-request" && mode !== "direct") {
        throw badRequest("mode must be pull-request or direct");
      }
      if (draft.operation === "delete") {
        if (mode !== "direct")
          throw badRequest("Article deletion currently requires direct mode");
        let deleted;
        try {
          deleted = await options.repository.delete({
            path: draft.basePath ?? article.path,
            commitMessage,
            expectedHeadCommit: article.gitCommitSha ?? undefined,
            baseContentHash: draft.baseContentHash,
          });
        } catch (error) {
          options.onError?.(error, request);
          if (error instanceof RepositoryContentConflictError) {
            throw conflict(
              "The repository article changed; pull before deleting",
              {
                remoteCommitSha: error.snapshot.remoteCommitSha,
              },
            );
          }
          throw new AppError(502, "bad_gateway", "Repository deletion failed");
        }
        if (
          !(await options.database.deleteArticle(articleId, article.version))
        ) {
          throw conflict("Article changed while completing deletion");
        }
        return json({
          article: null,
          publicationId: `delete:${articleId}`,
          pullRequestUrl: null,
          branch: deleted.branch,
        });
      }
      await recordRevision(
        articleId,
        "publish",
        article.path,
        draft.source,
        draft.contentHash,
        article.gitCommitSha,
      );
      let publication = await options.database.createPublication({
        id: id(),
        articleId,
        articlePath: article.path,
        source: draft.source,
        contentHash: draft.contentHash,
        draftVersion: draft.version,
        now: now(),
      });
      // Mark the durable snapshot as in-flight before the external mutation. If
      // the provider succeeds but the response is lost, the next pull can still
      // reconcile it by path+hash.
      await options.database.markPublicationDispatched(publication.id, now());
      publication = (await options.database.getPublication(publication.id))!;
      let publishResult: RepositoryPublishResult;
      try {
        publishResult = await options.repository.publish({
          publicationId: publication.id,
          path: publication.articlePath,
          previousPath:
            draft.basePath && draft.basePath !== publication.articlePath
              ? draft.basePath
              : undefined,
          source: publication.source,
          contentHash: publication.contentHash,
          mode,
          commitMessage,
          expectedHeadCommit: article.gitCommitSha ?? undefined,
          basePath: draft.basePath,
          baseContentHash: draft.baseContentHash,
        });
      } catch (error) {
        options.onError?.(error, request);
        await options.database.completePublication({
          id: publication.id,
          status: "failed",
          error: "Repository publish failed",
          now: now(),
        });
        if (error instanceof RepositoryContentConflictError) {
          const recorded = await options.database.recordContentConflict({
            id: id(),
            articleId,
            kind: error.snapshot.kind,
            basePath: draft.basePath,
            baseSource: draft.baseSource,
            baseHash: draft.baseContentHash,
            remotePath: error.snapshot.remotePath,
            remoteSource: error.snapshot.remoteSource,
            remoteHash: error.snapshot.remoteContentHash,
            remoteCommitSha: error.snapshot.remoteCommitSha,
            draftPath: publication.articlePath,
            draftSource: publication.source,
            draftHash: publication.contentHash,
            draftVersion: draft.version,
            now: now(),
          });
          throw conflict("Repository and CMS both changed this article", {
            conflictId: recorded.id,
          });
        }
        throw new AppError(502, "bad_gateway", "Repository publish failed");
      }
      const invalidResult = async (message: string): Promise<never> => {
        await options.database.completePublication({
          id: publication.id,
          status: "failed",
          error: message,
          now: now(),
        });
        throw new AppError(502, "bad_gateway", message);
      };
      if (publishResult.mode !== mode) {
        await invalidResult("Repository returned a mismatched publish mode");
      }
      if (
        publishResult.commitSha !== undefined &&
        !/^[0-9a-f]{7,64}$/i.test(publishResult.commitSha)
      ) {
        await invalidResult("Repository returned an invalid commit SHA");
      }
      if (mode === "direct" && publishResult.status !== "published") {
        await invalidResult("Direct publishing did not complete");
      }
      if (publishResult.status === "published") {
        if (!publishResult.commitSha) {
          await invalidResult("Published result is missing commit SHA");
        }
        publication = (await options.database.completePublication({
          id: publication.id,
          status: "published",
          contentHash: publication.contentHash,
          commitSha: publishResult.commitSha,
          now: now(),
        }))!;
      }
      const latestArticle =
        (await options.database.getArticle(articleId)) ?? article;
      const latestDraft = await options.database.getDraft(articleId);
      return json(
        {
          article: articleDocument(latestArticle, latestDraft),
          publicationId: publication.id,
          pullRequestUrl: publishResult.pullRequestUrl ?? null,
          branch: publishResult.branch ?? null,
        },
        {
          status: publication.status === "published" ? 200 : 202,
          headers: { location: `/api/publications/${publication.id}` },
        },
      );
    }

    const publicationRoute = path.match(/^\/api\/publications\/([^/]+)$/);
    if (publicationRoute) {
      if (request.method !== "GET") methodNotAllowed(["GET"]);
      const publication = await options.database.getPublication(
        decodeURIComponent(publicationRoute[1]),
      );
      if (!publication) throw notFound("Publication not found");
      return json({ data: publication });
    }

    const revisionRestoreRoute = path.match(
      /^\/api\/articles\/([^/]+)\/revisions\/([^/]+)\/restore$/,
    );
    if (revisionRestoreRoute) {
      if (request.method !== "POST") methodNotAllowed(["POST"]);
      const articleId = decodeURIComponent(revisionRestoreRoute[1]);
      const revisionId = decodeURIComponent(revisionRestoreRoute[2]);
      let article = await options.database.getArticle(articleId);
      if (!article) throw notFound("Article not found");
      const revision = await options.database.getArticleRevision(revisionId);
      if (!revision || revision.articleId !== articleId)
        throw notFound("Article revision not found");
      if (await options.database.getOpenContentConflictByArticle(articleId)) {
        throw conflict(
          "Resolve the open content conflict before restoring a version",
        );
      }
      const body = await readJson(request, maxBodyBytes);
      const expectedVersion = parseVersion(request, body);
      const currentDraft = await options.database.getDraft(articleId);
      const currentPath = article.path;
      if ((currentDraft?.version ?? 0) !== expectedVersion) {
        throw conflict("Draft version is stale", {
          currentVersion: currentDraft?.version ?? 0,
        });
      }
      if (revision.path !== article.path) {
        const moved = await options.database.updateArticle(articleId, {
          expectedVersion: article.version,
          path: revision.path,
          format: articleFormat(revision.path),
          now: now(),
        });
        if (!moved) throw conflict("Article changed while restoring its path");
        article = moved;
      }
      const restored = await options.database.upsertDraft({
        articleId,
        operation: "upsert",
        basePath:
          currentDraft?.basePath ?? (article.gitCommitSha ? currentPath : null),
        expectedVersion: currentDraft?.version ?? null,
        source: revision.source,
        contentHash: revision.contentHash,
        baseContentHash: currentDraft?.baseContentHash ?? article.contentHash,
        baseSource: currentDraft?.baseSource ?? article.source,
        now: now(),
      });
      if (!restored) throw conflict("Draft version is stale");
      await recordRevision(
        articleId,
        "restore",
        revision.path,
        revision.source,
        revision.contentHash,
        revision.gitCommitSha,
      );
      return json({ data: articleDocument(article, restored) });
    }

    const revisionsRoute = path.match(/^\/api\/articles\/([^/]+)\/revisions$/);
    if (revisionsRoute) {
      if (request.method !== "GET") methodNotAllowed(["GET"]);
      const articleId = decodeURIComponent(revisionsRoute[1]);
      const article = await options.database.getArticle(articleId);
      if (!article) throw notFound("Article not found");
      const limit = boundedInteger(
        Number(url.searchParams.get("limit") ?? 100),
        "limit",
        1,
        200,
      );
      let nativeHistoryCount = 0;
      const nativeCommitShas = new Set<string>();
      const nativeCommitMessages = new Map<string, string>();
      if (options.repository.history) {
        try {
          const repositoryHistory = await options.repository.history(
            article.path,
            Math.min(limit, 100),
          );
          nativeHistoryCount = repositoryHistory.length;
          repositoryHistory.forEach((entry) => {
            nativeCommitShas.add(entry.commitSha);
            nativeCommitMessages.set(entry.commitSha, entry.commitMessage);
          });
          const existing = await options.database.listArticleRevisions(
            articleId,
            200,
          );
          const existingCommits = new Set(
            existing
              .filter(
                (revision) =>
                  revision.kind === "repository" && revision.gitCommitSha,
              )
              .map((revision) => revision.gitCommitSha),
          );
          for (const entry of repositoryHistory) {
            if (existingCommits.has(entry.commitSha)) continue;
            await options.database.createArticleRevision({
              id: id(),
              articleId,
              kind: "repository",
              path: entry.path,
              source: entry.source,
              contentHash: await sha256Text(entry.source),
              gitCommitSha: entry.commitSha,
              now: entry.committedAt,
            });
            existingCommits.add(entry.commitSha);
          }
        } catch (error) {
          options.onError?.(error, request);
          // CMS snapshots remain usable if a provider temporarily cannot return Git history.
        }
      }
      const revisions = await options.database.listArticleRevisions(
        articleId,
        200,
      );
      const visible =
        nativeHistoryCount > 0
          ? revisions.filter(
              (revision) =>
                revision.kind !== "repository" ||
                (revision.gitCommitSha !== null &&
                  nativeCommitShas.has(revision.gitCommitSha)),
            )
          : revisions;
      const seenRepositoryCommits = new Set<string>();
      const deduplicated = visible.filter((revision) => {
        if (revision.kind !== "repository" || !revision.gitCommitSha)
          return true;
        if (seenRepositoryCommits.has(revision.gitCommitSha)) return false;
        seenRepositoryCommits.add(revision.gitCommitSha);
        return true;
      });
      return json({
        data: deduplicated.slice(0, limit).map((revision) => ({
          ...revision,
          gitCommitMessage: revision.gitCommitSha
            ? (nativeCommitMessages.get(revision.gitCommitSha) ?? null)
            : null,
        })),
      });
    }

    const articleRoute = path.match(/^\/api\/articles\/([^/]+)$/);
    if (articleRoute) {
      const articleId = decodeURIComponent(articleRoute[1]);
      if (request.method === "GET") {
        const article = await options.database.getArticle(articleId);
        if (!article) throw notFound("Article not found");
        const draft = await options.database.getDraft(articleId);
        const hasConflict = Boolean(
          await options.database.getOpenContentConflictByArticle(articleId),
        );
        return json(articleDocument(article, draft, hasConflict), {
          headers: { etag: `"${draft?.version ?? 0}"` },
        });
      }
      if (request.method === "PATCH") {
        const body = await readJson(request, maxBodyBytes);
        const current = await options.database.getArticle(articleId);
        if (!current) throw notFound("Article not found");
        const expectedVersion = parseVersion(request, body);
        const nextPath =
          body.path === undefined ? undefined : articlePath(body.path);
        const updated = await options.database.updateArticle(articleId, {
          expectedVersion,
          path: nextPath,
          format:
            body.format === undefined
              ? undefined
              : articleFormat(nextPath ?? current.path, body.format),
          title:
            body.title === undefined
              ? undefined
              : requiredString(body.title, "title", { max: 300 }),
          frontmatter:
            body.frontmatter === undefined
              ? undefined
              : validateFrontmatter(body.frontmatter),
          now: now(),
        });
        if (!updated)
          throw conflict("Article version is stale", {
            currentVersion: current.version,
          });
        return json(
          { data: updated },
          { headers: { etag: `"${updated.version}"` } },
        );
      }
      if (request.method === "DELETE") {
        const current = await options.database.getArticle(articleId);
        if (!current) throw notFound("Article not found");
        const body = await readJson(request, maxBodyBytes);
        const expectedVersion = parseVersion(request, body);
        const draft = await options.database.getDraft(articleId);
        if ((draft?.version ?? 0) !== expectedVersion) {
          throw conflict("Article draft version is stale", {
            currentVersion: draft?.version ?? 0,
          });
        }
        if (await options.database.getOpenContentConflictByArticle(articleId)) {
          throw conflict("Resolve the open content conflict before deleting");
        }
        // A never-published CMS draft has no repository file to preserve, so it
        // can be removed locally. Published articles become a durable delete
        // draft and require the separate Publish action to touch the repository.
        if (!current.gitCommitSha) {
          if (
            !(await options.database.deleteArticle(articleId, current.version))
          ) {
            throw conflict("Article version is stale", {
              currentVersion: current.version,
            });
          }
          return json({ data: null });
        }
        const pendingDeletion = await options.database.upsertDraft({
          articleId,
          operation: "delete",
          basePath: draft?.basePath ?? current.path,
          expectedVersion: draft?.version ?? null,
          source: draft?.source ?? current.source,
          contentHash: draft?.contentHash ?? current.contentHash,
          baseContentHash: draft?.baseContentHash ?? current.contentHash,
          baseSource: draft?.baseSource ?? current.source,
          now: now(),
        });
        if (!pendingDeletion) throw conflict("Article draft version is stale");
        await recordRevision(
          articleId,
          "delete",
          current.path,
          pendingDeletion.source,
          pendingDeletion.contentHash,
          current.gitCommitSha,
        );
        return json({ data: articleDocument(current, pendingDeletion) });
      }
      methodNotAllowed(["GET", "PATCH", "DELETE"]);
    }

    throw notFound();
  }

  return async (request: Request): Promise<Response> => {
    const requestId =
      request.headers.get("x-request-id")?.slice(0, 100) ?? crypto.randomUUID();
    try {
      const response = await handle(request);
      response.headers.set("x-request-id", requestId);
      return response;
    } catch (error) {
      if (error instanceof AppError) return errorResponse(error, requestId);
      options.onError?.(error, request);
      return errorResponse(
        new AppError(500, "internal_error", "An unexpected error occurred"),
        requestId,
      );
    }
  };
}
