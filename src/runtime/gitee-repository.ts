import type {
  GitRepositoryPort,
  RepositoryArticle,
  RepositoryArticleRevision,
  RepositoryBatchConflict,
  RepositoryBatchPublishChange,
  RepositoryBatchPublishRequest,
  RepositoryDeleteRequest,
  RepositoryDeleteResult,
  RepositoryPublishRequest,
  RepositoryPublishResult,
  RepositorySnapshot,
  RepositoryStatus,
} from "../core/git-repository-port.ts";
import {
  RepositoryBatchContentConflictError,
  RepositoryContentConflictError,
} from "../core/git-repository-port.ts";
import { sha256Text } from "../core/hash.ts";

interface GiteeRepositoryOptions {
  owner: string;
  repository: string;
  branch?: string;
  contentRoot?: string;
  token?: () => Promise<string>;
  apiBaseUrl?: string;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  maxArticleBytes?: number;
  blobConcurrency?: number;
}

interface GiteeErrorPayload { message?: string; error?: string }
interface GiteeRepositoryPayload { default_branch?: string }
interface GiteeBranchPayload { commit?: { sha?: string } }
interface GiteeTreeEntry { path?: string; type?: string; sha?: string; size?: number }
interface GiteeTreePayload { tree?: GiteeTreeEntry[]; truncated?: boolean }
interface GiteeBlobPayload { content?: string; encoding?: string; size?: number }
interface GiteeContentPayload { sha?: string; content?: string; encoding?: string }
interface GiteeCommitPayload {
  sha?: string;
  html_url?: string;
  commit?: { author?: { date?: string }; message?: string };
}
interface GiteePullPayload { html_url?: string }

interface RemoteContent {
  source: string | null;
  hash: string | null;
  sha: string | null;
}

const DEFAULT_API_BASE = "https://gitee.com/api/v5";
const DEFAULT_CONTENT_ROOT = "src/content";
const DEFAULT_MAX_ARTICLE_BYTES = 1024 * 1024;

function trimSlashes(value: string): string {
  return value.trim().replace(/^\/+|\/+$/g, "");
}

function encodePath(value: string): string {
  return value.split("/").map(encodeURIComponent).join("/");
}

function decodeBase64(value: string): string {
  const normalized = value.replace(/\s+/g, "");
  const binary = atob(normalized);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function assertArticlePath(path: string, contentRoot: string): void {
  if (
    !path.startsWith(`${contentRoot}/`) ||
    !/\.(?:md|mdx)$/i.test(path) ||
    path.includes("\\") ||
    path.split("/").some((part) => part === ".." || part === ".")
  ) {
    throw new Error(`文章必须是 ${contentRoot} 目录内的 Markdown 文件`);
  }
}

function branchForPublication(publicationId: string): string {
  const safe = publicationId
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `echoes-studio/${(safe || "publication").slice(0, 80)}`;
}

async function mapConcurrent<T, R>(
  values: T[],
  concurrency: number,
  map: (value: T) => Promise<R>,
): Promise<R[]> {
  const result = new Array<R>(values.length);
  let index = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (index < values.length) {
        const current = index++;
        result[current] = await map(values[current]!);
      }
    },
  );
  await Promise.all(workers);
  return result;
}

/** Gitee OpenAPI v5 repository adapter. */
export function createGiteeRepository(options: GiteeRepositoryOptions): GitRepositoryPort {
  const owner = options.owner.trim();
  const repository = options.repository.trim();
  if (!owner || !repository) throw new Error("Gitee 仓库所有者和仓库名不能为空");
  const request = options.fetch ?? globalThis.fetch;
  const apiBase = (options.apiBaseUrl ?? DEFAULT_API_BASE).replace(/\/$/, "");
  const contentRoot = trimSlashes(options.contentRoot ?? DEFAULT_CONTENT_ROOT);
  if (
    !contentRoot ||
    contentRoot.includes("\\") ||
    contentRoot.split("/").some((part) => !part || part === "." || part === "..")
  ) throw new Error("文章目录必须是安全的仓库相对路径");
  const maxArticleBytes = options.maxArticleBytes ?? DEFAULT_MAX_ARTICLE_BYTES;
  const blobConcurrency = Math.max(1, options.blobConcurrency ?? 6);
  const now = options.now ?? (() => new Date());
  const repositoryId = `gitee:${owner}/${repository}`;
  let resolvedDefaultBranch: string | null = options.branch?.trim() || null;
  let lastCheckedAt: string | null = null;

  async function headers(write = false): Promise<Headers> {
    const result = new Headers({ accept: "application/json", "content-type": "application/json" });
    const token = options.token ? await options.token() : "";
    if (token) result.set("authorization", `Bearer ${token}`);
    if (write && !token) throw new Error("Gitee Token 未配置，无法推送内容");
    return result;
  }

  async function call<T>(
    path: string,
    init: RequestInit = {},
    allowedStatuses: number[] = [],
  ): Promise<{ response: Response; payload: T | null }> {
    const response = await request(`${apiBase}${path}`, {
      ...init,
      headers: init.headers ?? await headers(Boolean(init.method && init.method !== "GET")),
    });
    const text = await response.text();
    let payload: T | GiteeErrorPayload | null = null;
    if (text) {
      try {
        payload = JSON.parse(text) as T | GiteeErrorPayload;
      } catch {
        if (!response.ok && !allowedStatuses.includes(response.status)) {
          throw new Error(`Gitee API 请求失败（${response.status}）`);
        }
      }
    }
    if (!response.ok && !allowedStatuses.includes(response.status)) {
      const error = payload as GiteeErrorPayload | null;
      throw new Error(
        `Gitee API 请求失败（${response.status}）：${error?.message ?? error?.error ?? "未知错误"}`,
      );
    }
    return { response, payload: payload as T | null };
  }

  async function defaultBranch(): Promise<string> {
    if (resolvedDefaultBranch) return resolvedDefaultBranch;
    const { payload } = await call<GiteeRepositoryPayload>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`,
    );
    if (!payload?.default_branch) throw new Error("Gitee 仓库没有默认分支");
    resolvedDefaultBranch = payload.default_branch;
    return resolvedDefaultBranch;
  }

  async function headCommit(branch: string): Promise<string> {
    const { payload } = await call<GiteeBranchPayload>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/branches/${encodeURIComponent(branch)}`,
    );
    const sha = payload?.commit?.sha;
    if (!sha) throw new Error(`Gitee 分支 ${branch} 没有返回 Commit SHA`);
    return sha;
  }

  async function contentAt(path: string, ref: string): Promise<GiteeContentPayload | null> {
    const { response, payload } = await call<GiteeContentPayload>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`,
      {},
      [404],
    );
    return response.status === 404 ? null : payload;
  }

  async function remoteAt(path: string, ref: string): Promise<RemoteContent> {
    const content = await contentAt(path, ref);
    const source = typeof content?.content === "string" && content.encoding === "base64"
      ? decodeBase64(content.content)
      : null;
    return {
      source,
      hash: source === null ? null : await sha256Text(source),
      sha: content?.sha ?? null,
    };
  }

  async function snapshot(): Promise<RepositorySnapshot> {
    const branch = await defaultBranch();
    const commitSha = await headCommit(branch);
    const { payload: tree } = await call<GiteeTreePayload>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/git/trees/${encodeURIComponent(commitSha)}?recursive=1`,
    );
    if (!tree?.tree) throw new Error("Gitee 仓库目录响应为空");
    if (tree.truncated) throw new Error("Gitee 返回的仓库目录不完整，请缩小文章目录范围");
    const blobs = tree.tree
      .filter((entry) =>
        entry.type === "blob" &&
        typeof entry.path === "string" &&
        entry.path.startsWith(`${contentRoot}/`) &&
        /\.(?:md|mdx)$/i.test(entry.path)
      )
      .sort((left, right) => left.path!.localeCompare(right.path!));
    const articles = await mapConcurrent(blobs, blobConcurrency, async (blob): Promise<RepositoryArticle> => {
      if (!blob.sha) throw new Error(`Gitee 文件 ${blob.path} 缺少 Blob SHA`);
      if (typeof blob.size === "number" && blob.size > maxArticleBytes) {
        throw new Error(`文章 ${blob.path} 超过 ${maxArticleBytes} 字节限制`);
      }
      const { payload } = await call<GiteeBlobPayload>(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/git/blobs/${encodeURIComponent(blob.sha)}`,
      );
      if (typeof payload?.content !== "string" || payload.encoding !== "base64") {
        throw new Error(`Gitee 文件 ${blob.path} 不是 Base64 内容`);
      }
      const source = decodeBase64(payload.content);
      if (new TextEncoder().encode(source).byteLength > maxArticleBytes) {
        throw new Error(`文章 ${blob.path} 超过 ${maxArticleBytes} 字节限制`);
      }
      return { path: blob.path!, source, format: blob.path!.toLowerCase().endsWith(".mdx") ? "mdx" : "md" };
    });
    lastCheckedAt = now().toISOString();
    return { repositoryId, branch, headCommit: commitSha, articles };
  }

  async function status(): Promise<RepositoryStatus> {
    const branch = await defaultBranch();
    const commitSha = await headCommit(branch);
    lastCheckedAt = now().toISOString();
    return {
      configured: true,
      repositoryId,
      provider: "gitee",
      defaultBranch: branch,
      headCommit: commitSha,
      contentRoot,
      lastCheckedAt,
    };
  }

  async function history(path: string, limit = 50): Promise<RepositoryArticleRevision[]> {
    assertArticlePath(path, contentRoot);
    const branch = await defaultBranch();
    const query = new URLSearchParams({ sha: branch, path, per_page: String(Math.max(1, Math.min(limit, 100))) });
    const { payload } = await call<GiteeCommitPayload[]>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/commits?${query.toString()}`,
    );
    if (!Array.isArray(payload)) return [];
    const entries = payload.filter((entry) => entry.sha && entry.commit?.author?.date);
    const revisions = await mapConcurrent(entries, Math.min(blobConcurrency, 4), async (entry) => {
      const remote = await remoteAt(path, entry.sha!);
      if (remote.source === null) return null;
      return {
        path,
        source: remote.source,
        commitSha: entry.sha!,
        commitMessage: entry.commit?.message?.split(/\r?\n/, 1)[0]?.trim() || "未命名提交",
        committedAt: entry.commit!.author!.date!,
      } satisfies RepositoryArticleRevision;
    });
    return revisions.filter((entry): entry is RepositoryArticleRevision => entry !== null);
  }

  async function checkChanges(
    changes: RepositoryBatchPublishChange[],
    baseHead: string,
  ): Promise<{ conflicts: RepositoryBatchConflict[]; remotes: Map<string, RemoteContent> }> {
    const cache = new Map<string, RemoteContent>();
    const at = async (path: string) => {
      const cached = cache.get(path);
      if (cached) return cached;
      const value = await remoteAt(path, baseHead);
      cache.set(path, value);
      return value;
    };
    const vacated = new Set(changes.flatMap((change) =>
      change.operation === "delete"
        ? [change.path]
        : change.previousPath && change.previousPath !== change.path ? [change.previousPath] : [],
    ));
    const conflicts: RepositoryBatchConflict[] = [];
    for (const change of changes) {
      if (change.operation === "delete") {
        const remote = await at(change.path);
        if (change.baseContentHash != null && remote.hash !== null && remote.hash !== change.baseContentHash) {
          conflicts.push({ publicationId: change.publicationId, snapshot: {
            kind: "delete_edit", remotePath: change.path, remoteSource: remote.source,
            remoteContentHash: remote.hash, remoteCommitSha: baseHead,
          } });
        }
        continue;
      }
      const remotePath = change.remoteCheckPath ?? change.basePath ?? change.path;
      const remote = await at(remotePath);
      const target = remotePath === change.path ? remote : await at(change.path);
      const remoteDiverged = change.basePath != null && remote.hash !== change.baseContentHash;
      const collisionWillMove = remotePath !== change.path && target.hash !== null && vacated.has(change.path);
      const targetCollision = remotePath !== change.path && target.hash !== null &&
        target.hash !== change.contentHash && !collisionWillMove;
      const newPathCollision = change.basePath == null && remotePath === change.path &&
        target.hash !== null && target.hash !== change.contentHash;
      if (targetCollision || newPathCollision || (remoteDiverged && remote.hash !== change.contentHash)) {
        conflicts.push({ publicationId: change.publicationId, snapshot: {
          kind: targetCollision || newPathCollision ? "path_collision" : remote.hash === null ? "delete_edit" : "edit_edit",
          remotePath: targetCollision || newPathCollision ? change.path : remote.hash === null ? null : remotePath,
          remoteSource: targetCollision || newPathCollision ? target.source : remote.source,
          remoteContentHash: targetCollision || newPathCollision ? target.hash : remote.hash,
          remoteCommitSha: baseHead,
        } });
      }
    }
    return { conflicts, remotes: cache };
  }

  async function commitChanges(
    changes: RepositoryBatchPublishChange[],
    branch: string,
    expectedHead: string,
    message: string,
  ): Promise<string> {
    if (await headCommit(branch) !== expectedHead) {
      throw new Error("远端仓库在推送前发生了变化，请先拉取后重试");
    }
    const actions: Array<Record<string, string>> = [];
    for (const change of changes) {
      if (change.operation === "delete") {
        if ((await remoteAt(change.path, expectedHead)).source !== null) {
          actions.push({ action: "delete", file_path: change.path });
        }
        continue;
      }
      const current = await remoteAt(change.path, expectedHead);
      if (change.previousPath && change.previousPath !== change.path) {
        if ((await remoteAt(change.previousPath, expectedHead)).source !== null) {
          actions.push({ action: "delete", file_path: change.previousPath });
        }
      }
      if (current.source !== change.source) {
        actions.push({
          action: current.source === null ? "create" : "update",
          file_path: change.path,
          content: change.source,
        });
      }
    }
    if (actions.length === 0) return expectedHead;
    const { payload } = await call<GiteeCommitPayload>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/commits`,
      {
        method: "POST",
        headers: await headers(true),
        body: JSON.stringify({ branch, commit_message: message, actions }),
      },
    );
    if (!payload?.sha) throw new Error("Gitee 批量提交没有返回 Commit SHA");
    return payload.sha;
  }

  async function publishBatch(input: RepositoryBatchPublishRequest): Promise<RepositoryPublishResult> {
    if (input.mode !== "direct") throw new Error("Gitee 批量发布当前仅支持直推模式");
    if (input.changes.length === 0) throw new Error("没有可发布的文章变更");
    const seen = new Set<string>();
    for (const change of input.changes) {
      assertArticlePath(change.path, contentRoot);
      if (seen.has(change.path)) throw new Error(`批量发布包含重复路径 ${change.path}`);
      seen.add(change.path);
      if (change.operation === "upsert") {
        if (change.previousPath) assertArticlePath(change.previousPath, contentRoot);
        if (new TextEncoder().encode(change.source).byteLength > maxArticleBytes) {
          throw new Error(`文章 ${change.path} 超过 ${maxArticleBytes} 字节限制`);
        }
      }
    }
    const branch = await defaultBranch();
    const baseHead = await headCommit(branch);
    const checked = await checkChanges(input.changes, baseHead);
    if (checked.conflicts.length) throw new RepositoryBatchContentConflictError(checked.conflicts);
    const commitSha = await commitChanges(
      input.changes,
      branch,
      baseHead,
      input.commitMessage ?? `content: publish ${input.changes.length} articles via Echoes Studio`,
    );
    return { mode: "direct", status: "published", commitSha, branch };
  }

  async function publish(input: RepositoryPublishRequest): Promise<RepositoryPublishResult> {
    assertArticlePath(input.path, contentRoot);
    if (input.previousPath) assertArticlePath(input.previousPath, contentRoot);
    if (new TextEncoder().encode(input.source).byteLength > maxArticleBytes) {
      throw new Error(`文章 ${input.path} 超过 ${maxArticleBytes} 字节限制`);
    }
    const base = await defaultBranch();
    const baseHead = await headCommit(base);
    if (input.baseContentHash === undefined && input.expectedHeadCommit && input.expectedHeadCommit !== baseHead) {
      throw new Error("远端仓库已发生变化，请先拉取后再发布");
    }
    const change: RepositoryBatchPublishChange = {
      operation: "upsert",
      publicationId: input.publicationId,
      path: input.path,
      previousPath: input.previousPath,
      source: input.source,
      contentHash: input.contentHash,
      basePath: input.basePath,
      baseContentHash: input.baseContentHash,
      remoteCheckPath: input.remoteCheckPath,
    };
    const checked = await checkChanges([change], baseHead);
    if (checked.conflicts[0]) throw new RepositoryContentConflictError(checked.conflicts[0].snapshot);
    const mode = input.mode;
    if (mode === "direct") {
      const commitSha = await commitChanges(
        [change], base, baseHead,
        input.commitMessage ?? `content: publish ${input.path} via Echoes Studio`,
      );
      return { mode, status: "published", commitSha, branch: base };
    }
    const branch = branchForPublication(input.publicationId);
    const existing = await call<GiteeBranchPayload>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/branches/${encodeURIComponent(branch)}`,
      {},
      [404],
    );
    if (existing.response.status === 404) {
      await call<GiteeBranchPayload>(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/branches`,
        {
          method: "POST",
          headers: await headers(true),
          body: JSON.stringify({ refs: base, branch_name: branch }),
        },
      );
    }
    const branchHead = existing.payload?.commit?.sha ?? baseHead;
    const commitSha = await commitChanges(
      [change], branch, branchHead,
      input.commitMessage ?? `content: publish ${input.path} via Echoes Studio`,
    );
    const { payload: pull } = await call<GiteePullPayload>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/pulls`,
      {
        method: "POST",
        headers: await headers(true),
        body: JSON.stringify({
          title: `Publish ${input.path}`,
          body: `Published by Echoes Studio.\n\nContent SHA-256: ${input.contentHash}`,
          head: branch,
          base,
        }),
      },
    );
    if (!pull?.html_url) throw new Error("Gitee 没有返回 Pull Request 地址");
    return { mode, status: "pending", commitSha, pullRequestUrl: pull.html_url, branch };
  }

  async function deleteArticle(input: RepositoryDeleteRequest): Promise<RepositoryDeleteResult> {
    assertArticlePath(input.path, contentRoot);
    const branch = await defaultBranch();
    const baseHead = await headCommit(branch);
    const remote = await remoteAt(input.path, baseHead);
    if (remote.source === null) return { status: "deleted", commitSha: baseHead, branch };
    if (input.baseContentHash != null && remote.hash !== input.baseContentHash) {
      throw new RepositoryContentConflictError({
        kind: "delete_edit", remotePath: input.path, remoteSource: remote.source,
        remoteContentHash: remote.hash, remoteCommitSha: baseHead,
      });
    }
    const commitSha = await commitChanges(
      [{ operation: "delete", publicationId: input.path, path: input.path, baseContentHash: input.baseContentHash }],
      branch,
      baseHead,
      input.commitMessage ?? `content: delete ${input.path} via Echoes Studio`,
    );
    return { status: "deleted", commitSha, branch };
  }

  return { snapshot, status, history, publish, publishBatch, delete: deleteArticle };
}

export type { GiteeRepositoryOptions };
