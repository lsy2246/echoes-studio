import type {
  GitRepositoryPort,
  RepositoryArticle,
  RepositoryArticleRevision,
  RepositoryBatchPublishRequest,
  RepositoryDeleteRequest,
  RepositoryDeleteResult,
  RepositoryPublishRequest,
  RepositoryPublishResult,
  RepositorySnapshot,
  RepositoryStatus,
} from "../core/git-repository-port.ts";
import { RepositoryBatchContentConflictError, RepositoryContentConflictError } from "../core/git-repository-port.ts";
import { sha256Text } from "../core/hash.ts";
import { walkTarArchive } from "./tar-archive.ts";

interface GitHubRepositoryOptions {
  owner: string;
  repository: string;
  branch?: string;
  contentRoot?: string;
  writeMode?: "pull-request" | "direct";
  token?: () => Promise<string>;
  apiBaseUrl?: string;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
  maxArticleBytes?: number;
  blobConcurrency?: number;
}

interface GitHubErrorPayload {
  message?: string;
  documentation_url?: string;
}

interface GitHubRefPayload {
  object?: { sha?: string };
}

interface GitHubCommitPayload {
  sha?: string;
  tree?: { sha?: string };
}

interface GitHubRepositoryPayload {
  default_branch?: string;
}

interface GitHubCommitListItem {
  sha?: string;
  commit?: { author?: { date?: string }; message?: string };
}

interface GitHubContentPayload {
  sha?: string;
  content?: string;
  encoding?: string;
}

interface GitHubWritePayload {
  content?: { sha?: string };
  commit?: { sha?: string };
}

interface GitHubObjectPayload {
  sha?: string;
}

interface GitHubPullPayload {
  html_url?: string;
}

const DEFAULT_API_BASE = "https://api.github.com";
const DEFAULT_CONTENT_ROOT = "src/content";
const DEFAULT_MAX_ARTICLE_BYTES = 1024 * 1024;
const MAX_COMPRESSED_ARCHIVE_BYTES = 24 * 1024 * 1024;
const MAX_EXPANDED_ARCHIVE_BYTES = 64 * 1024 * 1024;

function trimSlashes(value: string): string {
  return value.trim().replace(/^\/+|\/+$/g, "");
}

function encodePath(value: string): string {
  return value.split("/").map(encodeURIComponent).join("/");
}

function isArticlePath(path: string, contentRoot: string): boolean {
  return path.startsWith(`${contentRoot}/`) && /\.(?:md|mdx)$/i.test(path);
}

function assertArticlePath(path: string, contentRoot: string): void {
  if (!isArticlePath(path, contentRoot) || path.includes("\\") || path.split("/").includes("..")) {
    throw new Error(`Publication path must be a Markdown file inside ${contentRoot}`);
  }
}

function decodeBase64(value: string): Uint8Array {
  const normalized = value.replace(/\s+/g, "");
  const binary = atob(normalized);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function decodeUtf8Base64(value: string): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(decodeBase64(value));
}

function branchForPublication(publicationId: string): string {
  const safe = publicationId.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return `echoes-studio/${(safe || "publication").slice(0, 80)}`;
}

async function mapConcurrent<T, R>(
  values: T[],
  concurrency: number,
  map: (value: T) => Promise<R>,
): Promise<R[]> {
  const result = new Array<R>(values.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (index < values.length) {
      const current = index++;
      result[current] = await map(values[current]!);
    }
  });
  await Promise.all(workers);
  return result;
}

async function readLimited(
  stream: ReadableStream<Uint8Array>,
  limit: number,
  label: string,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > limit) {
      await reader.cancel();
      throw new Error(`${label} exceeds the ${limit}-byte limit`);
    }
    chunks.push(value);
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function expandTarArchive(response: Response): Promise<Uint8Array> {
  if (!response.body) throw new Error("GitHub archive response was empty");
  const compressed = await readLimited(
    response.body,
    MAX_COMPRESSED_ARCHIVE_BYTES,
    "GitHub compressed archive",
  );
  if (compressed[0] !== 0x1f || compressed[1] !== 0x8b) return compressed;
  const archiveBuffer = new ArrayBuffer(compressed.byteLength);
  new Uint8Array(archiveBuffer).set(compressed);
  const source = new Blob([archiveBuffer]).stream();
  return readLimited(
    source.pipeThrough(new DecompressionStream("gzip")),
    MAX_EXPANDED_ARCHIVE_BYTES,
    "GitHub expanded archive",
  );
}

/** GitHub REST implementation owned entirely by Echoes Studio. */
export function createGitHubRepository(options: GitHubRepositoryOptions): GitRepositoryPort {
  const owner = options.owner.trim();
  const repository = options.repository.trim();
  if (!owner || !repository) throw new Error("GitHub owner and repository are required");

  const request = options.fetch ?? globalThis.fetch;
  const apiBase = (options.apiBaseUrl ?? DEFAULT_API_BASE).replace(/\/$/, "");
  const contentRoot = trimSlashes(options.contentRoot ?? DEFAULT_CONTENT_ROOT);
  if (
    !contentRoot || contentRoot.includes("\\") ||
    contentRoot.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error("CMS_CONTENT_ROOT must be a safe repository-relative directory");
  }
  const maxArticleBytes = options.maxArticleBytes ?? DEFAULT_MAX_ARTICLE_BYTES;
  const blobConcurrency = Math.max(1, options.blobConcurrency ?? 6);
  const now = options.now ?? (() => new Date());
  const repositoryId = `github:${owner}/${repository}`;
  let resolvedDefaultBranch: string | null = options.branch?.trim() || null;
  let lastCheckedAt: string | null = null;

  async function headers(write = false): Promise<Headers> {
    const result = new Headers({
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "user-agent": "Echoes-Studio",
      "x-github-api-version": "2022-11-28",
    });
    const token = options.token ? await options.token() : null;
    if (token) result.set("authorization", `Bearer ${token}`);
    if (write && !token) {
      throw new Error("GitHub credentials are required to publish content");
    }
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
    let payload: T | GitHubErrorPayload | null = null;
    const text = await response.text();
    if (text) {
      try {
        payload = JSON.parse(text) as T | GitHubErrorPayload;
      } catch {
        if (!response.ok && !allowedStatuses.includes(response.status)) {
          throw new Error(`GitHub API failed (${response.status}): ${text.slice(0, 300)}`);
        }
      }
    }
    if (!response.ok && !allowedStatuses.includes(response.status)) {
      const error = payload as GitHubErrorPayload | null;
      throw new Error(`GitHub API failed (${response.status}): ${error?.message ?? "unknown error"}`);
    }
    return { response, payload: payload as T | null };
  }

  async function archive(commitSha: string): Promise<Uint8Array> {
    const response = await request(
      `${apiBase}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/tarball/${encodeURIComponent(commitSha)}`,
      { headers: await headers(false), redirect: "follow" },
    );
    if (!response.ok) {
      const message = (await response.text()).slice(0, 300) || "unknown error";
      throw new Error(`GitHub archive download failed (${response.status}): ${message}`);
    }
    return expandTarArchive(response);
  }

  async function defaultBranch(): Promise<string> {
    if (resolvedDefaultBranch) return resolvedDefaultBranch;
    const { payload } = await call<GitHubRepositoryPayload>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`,
    );
    if (!payload?.default_branch) throw new Error("GitHub repository has no default branch");
    resolvedDefaultBranch = payload.default_branch;
    return resolvedDefaultBranch;
  }

  async function headCommit(branch: string): Promise<string> {
    const { payload } = await call<GitHubRefPayload>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/git/ref/heads/${encodePath(branch)}`,
    );
    const sha = payload?.object?.sha;
    if (!sha) throw new Error(`GitHub branch ${branch} did not return a commit SHA`);
    return sha;
  }

  async function snapshot(): Promise<RepositorySnapshot> {
    const branch = await defaultBranch();
    const commitSha = await headCommit(branch);
    const bytes = await archive(commitSha);
    const articles: RepositoryArticle[] = [];
    let contentRootFound = false;
    walkTarArchive(bytes, (entry) => {
      const normalized = entry.path.replace(/^\.\//, "");
      const slash = normalized.indexOf("/");
      if (slash < 0) return;
      const path = normalized.slice(slash + 1);
      if (path === contentRoot || path.startsWith(`${contentRoot}/`)) {
        contentRootFound = true;
      }
      if (entry.type !== "file" || !/\.(?:md|mdx)$/i.test(path)) return;
      if (!path.startsWith(`${contentRoot}/`)) return;
      if (entry.data.byteLength > maxArticleBytes) {
        throw new Error(`Article ${path} exceeds the ${maxArticleBytes}-byte limit`);
      }
      articles.push({
        path,
        source: new TextDecoder("utf-8", { fatal: true }).decode(entry.data),
        format: path.toLowerCase().endsWith(".mdx") ? "mdx" : "md",
      });
    });
    if (!contentRootFound) {
      throw new Error(`Configured content directory ${contentRoot} does not exist at ${commitSha}`);
    }
    articles.sort((left, right) => left.path.localeCompare(right.path));
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
      provider: "github",
      defaultBranch: branch,
      headCommit: commitSha,
      contentRoot,
      lastCheckedAt,
    };
  }

  async function contentAt(path: string, branch: string): Promise<GitHubContentPayload | null> {
    const { response, payload } = await call<GitHubContentPayload>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`,
      {},
      [404],
    );
    return response.status === 404 ? null : payload;
  }

  async function history(path: string, limit = 50): Promise<RepositoryArticleRevision[]> {
    assertArticlePath(path, contentRoot);
    const branch = await defaultBranch();
    const safeLimit = Math.max(1, Math.min(limit, 100));
    const { payload } = await call<GitHubCommitListItem[]>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/commits?sha=${encodeURIComponent(branch)}&path=${encodePath(path)}&per_page=${safeLimit}`,
    );
    if (!Array.isArray(payload)) return [];
    const entries = payload.filter((entry) =>
      typeof entry.sha === "string" && typeof entry.commit?.author?.date === "string"
    );
    const resolved = await mapConcurrent(entries, Math.min(blobConcurrency, 4), async (entry) => {
      const content = await contentAt(path, entry.sha!);
      if (typeof content?.content !== "string" || content.encoding !== "base64") return null;
      const source = decodeUtf8Base64(content.content);
      if (new TextEncoder().encode(source).byteLength > maxArticleBytes) return null;
      return {
        path,
        source,
        commitSha: entry.sha!,
        commitMessage: entry.commit?.message?.split(/\r?\n/, 1)[0]?.trim() || "未命名提交",
        committedAt: entry.commit!.author!.date!,
      } satisfies RepositoryArticleRevision;
    });
    return resolved.filter((entry): entry is RepositoryArticleRevision => entry !== null);
  }

  async function writeContent(
    input: RepositoryPublishRequest,
    branch: string,
  ): Promise<{ commitSha: string; changed: boolean }> {
    const current = await contentAt(input.path, branch);
    if (current?.content && current.encoding === "base64" && decodeUtf8Base64(current.content) === input.source) {
      return { commitSha: await headCommit(branch), changed: false };
    }
    const body: Record<string, string> = {
      message: input.commitMessage ?? `content: publish ${input.path} via Echoes Studio`,
      content: encodeBase64(input.source),
      branch,
    };
    if (current?.sha) body.sha = current.sha;
    const { payload } = await call<GitHubWritePayload>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/contents/${encodePath(input.path)}`,
      { method: "PUT", headers: await headers(true), body: JSON.stringify(body) },
    );
    const commitSha = payload?.commit?.sha;
    if (!commitSha) throw new Error("GitHub content update did not return a commit SHA");
    return { commitSha, changed: true };
  }

  async function deleteContent(path: string, branch: string): Promise<string | null> {
    const current = await contentAt(path, branch);
    if (!current?.sha) return null;
    const { payload } = await call<GitHubWritePayload>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/contents/${encodePath(path)}`,
      {
        method: "DELETE",
        headers: await headers(true),
        body: JSON.stringify({
          message: `content: move ${path} via Echoes Studio`,
          sha: current.sha,
          branch,
        }),
      },
    );
    const commitSha = payload?.commit?.sha;
    if (!commitSha) throw new Error("GitHub content deletion did not return a commit SHA");
    return commitSha;
  }

  async function writeDirect(
    input: RepositoryPublishRequest,
    branch: string,
    expectedHead: string,
  ): Promise<string> {
    const current = await contentAt(input.path, expectedHead);
    if (
      (!input.previousPath || input.previousPath === input.path) &&
      typeof current?.content === "string" && current.encoding === "base64" &&
      decodeUtf8Base64(current.content) === input.source
    ) return expectedHead;

    const { payload: blob } = await call<GitHubObjectPayload>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/git/blobs`,
      {
        method: "POST",
        headers: await headers(true),
        body: JSON.stringify({ content: input.source, encoding: "utf-8" }),
      },
    );
    if (!blob?.sha) throw new Error("GitHub blob creation did not return a SHA");

    const { payload: baseCommit } = await call<GitHubCommitPayload>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/git/commits/${encodeURIComponent(expectedHead)}`,
    );
    if (!baseCommit?.tree?.sha) throw new Error("GitHub base commit did not return a tree SHA");
    const { payload: tree } = await call<GitHubObjectPayload>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/git/trees`,
      {
        method: "POST",
        headers: await headers(true),
        body: JSON.stringify({
          base_tree: baseCommit.tree.sha,
          tree: [
            { path: input.path, mode: "100644", type: "blob", sha: blob.sha },
            ...(input.previousPath && input.previousPath !== input.path
              ? [{ path: input.previousPath, mode: "100644", type: "blob", sha: null }]
              : []),
          ],
        }),
      },
    );
    if (!tree?.sha) throw new Error("GitHub tree creation did not return a SHA");
    const { payload: commit } = await call<GitHubObjectPayload>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/git/commits`,
      {
        method: "POST",
        headers: await headers(true),
        body: JSON.stringify({
          message: input.commitMessage ?? `content: publish ${input.path} via Echoes Studio`,
          tree: tree.sha,
          parents: [expectedHead],
        }),
      },
    );
    if (!commit?.sha) throw new Error("GitHub commit creation did not return a SHA");
    const updated = await call<GitHubRefPayload>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/git/refs/heads/${encodePath(branch)}`,
      {
        method: "PATCH",
        headers: await headers(true),
        body: JSON.stringify({ sha: commit.sha, force: false }),
      },
      [409, 422],
    );
    if (updated.response.status === 409 || updated.response.status === 422) {
      throw new Error("The repository changed while publishing; synchronize and retry");
    }
    return commit.sha;
  }

  async function deleteArticle(input: RepositoryDeleteRequest): Promise<RepositoryDeleteResult> {
    assertArticlePath(input.path, contentRoot);
    const branch = await defaultBranch();
    const baseHead = await headCommit(branch);
    const remote = await contentAt(input.path, baseHead);
    if (!remote) return { status: "deleted", commitSha: baseHead, branch };
    const remoteSource = typeof remote.content === "string" && remote.encoding === "base64"
      ? decodeUtf8Base64(remote.content) : null;
    const remoteHash = remoteSource === null ? null : await sha256Text(remoteSource);
    if (input.baseContentHash != null && remoteHash !== input.baseContentHash) {
      throw new RepositoryContentConflictError({
        kind: "delete_edit",
        remotePath: input.path,
        remoteSource,
        remoteContentHash: remoteHash,
        remoteCommitSha: baseHead,
      });
    }
    if (input.baseContentHash == null && input.expectedHeadCommit && input.expectedHeadCommit !== baseHead) {
      throw new Error("The repository changed after the article was loaded; synchronize before deleting");
    }
    const { payload: baseCommit } = await call<GitHubCommitPayload>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/git/commits/${encodeURIComponent(baseHead)}`,
    );
    if (!baseCommit?.tree?.sha) throw new Error("GitHub base commit did not return a tree SHA");
    const { payload: tree } = await call<GitHubObjectPayload>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/git/trees`,
      {
        method: "POST",
        headers: await headers(true),
        body: JSON.stringify({
          base_tree: baseCommit.tree.sha,
          tree: [{ path: input.path, mode: "100644", type: "blob", sha: null }],
        }),
      },
    );
    if (!tree?.sha) throw new Error("GitHub deletion tree did not return a SHA");
    const { payload: commit } = await call<GitHubObjectPayload>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/git/commits`,
      {
        method: "POST",
        headers: await headers(true),
        body: JSON.stringify({
          message: input.commitMessage ?? `content: delete ${input.path} via Echoes Studio`,
          tree: tree.sha,
          parents: [baseHead],
        }),
      },
    );
    if (!commit?.sha) throw new Error("GitHub deletion commit did not return a SHA");
    const updated = await call<GitHubRefPayload>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/git/refs/heads/${encodePath(branch)}`,
      {
        method: "PATCH",
        headers: await headers(true),
        body: JSON.stringify({ sha: commit.sha, force: false }),
      },
      [409, 422],
    );
    if (updated.response.status === 409 || updated.response.status === 422) {
      throw new Error("The repository changed while deleting; synchronize and retry");
    }
    return { status: "deleted", commitSha: commit.sha, branch };
  }

  async function createOrFindPullRequest(
    input: RepositoryPublishRequest,
    branch: string,
    base: string,
  ): Promise<string> {
    const title = `Publish ${input.path}`;
    const body = [
      "Published by Echoes Studio.",
      "",
      `Publication: \`${input.publicationId}\``,
      `Content SHA-256: \`${input.contentHash}\``,
    ].join("\n");
    const created = await call<GitHubPullPayload>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/pulls`,
      {
        method: "POST",
        headers: await headers(true),
        body: JSON.stringify({ title, body, head: branch, base }),
      },
      [422],
    );
    if (created.response.status !== 422 && created.payload?.html_url) return created.payload.html_url;
    const query = new URLSearchParams({ state: "open", head: `${owner}:${branch}`, base });
    const existing = await call<GitHubPullPayload[]>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/pulls?${query.toString()}`,
    );
    const pullRequestUrl = existing.payload?.[0]?.html_url;
    if (!pullRequestUrl) {
      throw new Error("GitHub rejected the pull request and no matching open pull request exists");
    }
    return pullRequestUrl;
  }

  async function publish(input: RepositoryPublishRequest): Promise<RepositoryPublishResult> {
    assertArticlePath(input.path, contentRoot);
    if (input.previousPath) assertArticlePath(input.previousPath, contentRoot);
    if (new TextEncoder().encode(input.source).byteLength > maxArticleBytes) {
      throw new Error(`Article ${input.path} exceeds the ${maxArticleBytes}-byte limit`);
    }
    const base = await defaultBranch();
    const baseHead = await headCommit(base);
    if (input.baseContentHash === undefined && input.expectedHeadCommit && input.expectedHeadCommit !== baseHead) {
      throw new Error("The repository changed after the draft was created; synchronize before publishing");
    }
    const remotePath = input.remoteCheckPath ?? input.basePath ?? input.path;
    let remoteHash: string | null | undefined;
    if (input.baseContentHash !== undefined) {
      const remoteAtBase = await contentAt(remotePath, baseHead);
      const remoteSource = typeof remoteAtBase?.content === "string" && remoteAtBase.encoding === "base64"
        ? decodeUtf8Base64(remoteAtBase.content) : null;
      remoteHash = remoteSource === null ? null : await sha256Text(remoteSource);
      const targetAtBase = remotePath === input.path ? remoteAtBase : await contentAt(input.path, baseHead);
      const targetSource = typeof targetAtBase?.content === "string" && targetAtBase.encoding === "base64"
        ? decodeUtf8Base64(targetAtBase.content) : null;
      const targetHash = targetSource === null ? null : await sha256Text(targetSource);
      const remoteDiverged = input.basePath != null && remoteHash !== input.baseContentHash;
      const targetCollision = remotePath !== input.path && targetHash !== null && targetHash !== input.contentHash;
      const newPathCollision = input.basePath == null && remotePath === input.path && targetHash !== null && targetHash !== input.contentHash;
      if (targetCollision || newPathCollision || (remoteDiverged && remoteHash !== input.contentHash)) {
        throw new RepositoryContentConflictError({
          kind: targetCollision || newPathCollision ? "path_collision" : remoteHash === null ? "delete_edit" : "edit_edit",
          remotePath: targetCollision || newPathCollision ? input.path : remoteHash === null ? null : remotePath,
          remoteSource: targetCollision || newPathCollision ? targetSource : remoteSource,
          remoteContentHash: targetCollision || newPathCollision ? targetHash : remoteHash,
          remoteCommitSha: baseHead,
        });
      }
    }
    const mode = input.mode ?? options.writeMode ?? "pull-request";
    if (remoteHash !== undefined && remoteHash === input.contentHash && remotePath === input.path) {
      return { mode, status: "published", commitSha: baseHead, branch: base };
    }
    if (mode === "direct") {
      const commitSha = await writeDirect(input, base, baseHead);
      return { mode, status: "published", commitSha, branch: base };
    }

    const baseContent = await contentAt(input.path, baseHead);
    if (
      (!input.previousPath || input.previousPath === input.path) &&
      typeof baseContent?.content === "string" && baseContent.encoding === "base64" &&
      decodeUtf8Base64(baseContent.content) === input.source
    ) {
      return { mode, status: "published", commitSha: baseHead, branch: base };
    }

    const branch = branchForPublication(input.publicationId);
    const refPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/git/ref/heads/${encodePath(branch)}`;
    const currentRef = await call<GitHubRefPayload>(refPath, {}, [404]);
    if (currentRef.response.status === 404) {
      await call<GitHubRefPayload>(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/git/refs`,
        {
          method: "POST",
          headers: await headers(true),
          body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseHead }),
        },
      );
    }
    const update = await writeContent(input, branch);
    const deleteCommit = input.previousPath && input.previousPath !== input.path
      ? await deleteContent(input.previousPath, branch)
      : null;
    const pullRequestUrl = await createOrFindPullRequest(input, branch, base);
    return {
      mode,
      status: "pending",
      commitSha: deleteCommit ?? update.commitSha,
      pullRequestUrl,
      branch,
    };
  }

  async function publishBatch(input: RepositoryBatchPublishRequest): Promise<RepositoryPublishResult> {
    if (input.mode !== "direct") {
      throw new Error("Batch publishing currently requires direct mode");
    }
    if (input.changes.length === 0) throw new Error("Batch publication has no changes");
    const seenTargets = new Set<string>();
    for (const change of input.changes) {
      assertArticlePath(change.path, contentRoot);
      if (change.operation === "upsert") {
        if (change.previousPath) assertArticlePath(change.previousPath, contentRoot);
        if (new TextEncoder().encode(change.source).byteLength > maxArticleBytes) {
          throw new Error(`Article ${change.path} exceeds the ${maxArticleBytes}-byte limit`);
        }
        if (seenTargets.has(change.path)) throw new Error(`Batch publication contains duplicate path ${change.path}`);
        seenTargets.add(change.path);
      }
    }

    const branch = await defaultBranch();
    const baseHead = await headCommit(branch);
    const vacatedPaths = new Set(input.changes.flatMap((change) => {
      if (change.operation === "delete") return [change.path];
      return change.previousPath && change.previousPath !== change.path ? [change.previousPath] : [];
    }));

    const remoteCache = new Map<string, { source: string | null; hash: string | null }>();
    const remoteAt = async (path: string) => {
      const cached = remoteCache.get(path);
      if (cached) return cached;
      const content = await contentAt(path, baseHead);
      const source = typeof content?.content === "string" && content.encoding === "base64"
        ? decodeUtf8Base64(content.content) : null;
      const value = { source, hash: source === null ? null : await sha256Text(source) };
      remoteCache.set(path, value);
      return value;
    };

    const conflicts = [];
    for (const change of input.changes) {
      if (change.operation === "delete") {
        const remote = await remoteAt(change.path);
        if (change.baseContentHash != null && remote.hash !== null && remote.hash !== change.baseContentHash) {
          conflicts.push({
            publicationId: change.publicationId,
            snapshot: {
              kind: "delete_edit" as const,
              remotePath: change.path,
              remoteSource: remote.source,
              remoteContentHash: remote.hash,
              remoteCommitSha: baseHead,
            },
          });
        }
        continue;
      }
      const remotePath = change.remoteCheckPath ?? change.basePath ?? change.path;
      const remote = await remoteAt(remotePath);
      const target = remotePath === change.path ? remote : await remoteAt(change.path);
      const remoteDiverged = change.basePath != null && remote.hash !== change.baseContentHash;
      const collisionWillMove = remotePath !== change.path && target.hash !== null && vacatedPaths.has(change.path);
      const targetCollision = remotePath !== change.path && target.hash !== null
        && target.hash !== change.contentHash && !collisionWillMove;
      const newPathCollision = change.basePath == null && remotePath === change.path
        && target.hash !== null && target.hash !== change.contentHash;
      if (targetCollision || newPathCollision || (remoteDiverged && remote.hash !== change.contentHash)) {
        conflicts.push({
          publicationId: change.publicationId,
          snapshot: {
            kind: targetCollision || newPathCollision ? "path_collision" as const
              : remote.hash === null ? "delete_edit" as const : "edit_edit" as const,
            remotePath: targetCollision || newPathCollision ? change.path : remote.hash === null ? null : remotePath,
            remoteSource: targetCollision || newPathCollision ? target.source : remote.source,
            remoteContentHash: targetCollision || newPathCollision ? target.hash : remote.hash,
            remoteCommitSha: baseHead,
          },
        });
      }
    }
    if (conflicts.length > 0) throw new RepositoryBatchContentConflictError(conflicts);

    const blobChanges = input.changes.filter((change) => change.operation === "upsert");
    const blobs = await mapConcurrent(blobChanges, blobConcurrency, async (change) => {
      const remote = await remoteAt(change.path);
      if (remote.source === change.source) return { change, sha: null };
      const { payload } = await call<GitHubObjectPayload>(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/git/blobs`,
        {
          method: "POST",
          headers: await headers(true),
          body: JSON.stringify({ content: change.source, encoding: "utf-8" }),
        },
      );
      if (!payload?.sha) throw new Error(`GitHub blob creation did not return a SHA for ${change.path}`);
      return { change, sha: payload.sha };
    });

    const treeEntries = new Map<string, { path: string; mode: string; type: string; sha: string | null }>();
    for (const change of input.changes) {
      if (change.operation === "delete") {
        if ((await remoteAt(change.path)).source !== null) {
          treeEntries.set(change.path, { path: change.path, mode: "100644", type: "blob", sha: null });
        }
      } else if (change.previousPath && change.previousPath !== change.path) {
        treeEntries.set(change.previousPath, { path: change.previousPath, mode: "100644", type: "blob", sha: null });
      }
    }
    for (const { change, sha } of blobs) {
      if (sha) treeEntries.set(change.path, { path: change.path, mode: "100644", type: "blob", sha });
      else treeEntries.delete(change.path);
    }
    if (treeEntries.size === 0) {
      return { mode: "direct", status: "published", commitSha: baseHead, branch };
    }

    const { payload: baseCommit } = await call<GitHubCommitPayload>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/git/commits/${encodeURIComponent(baseHead)}`,
    );
    if (!baseCommit?.tree?.sha) throw new Error("GitHub base commit did not return a tree SHA");
    const { payload: tree } = await call<GitHubObjectPayload>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/git/trees`,
      {
        method: "POST",
        headers: await headers(true),
        body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree: [...treeEntries.values()] }),
      },
    );
    if (!tree?.sha) throw new Error("GitHub batch tree creation did not return a SHA");
    const { payload: commit } = await call<GitHubObjectPayload>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/git/commits`,
      {
        method: "POST",
        headers: await headers(true),
        body: JSON.stringify({
          message: input.commitMessage ?? `content: publish ${input.changes.length} articles via Echoes Studio`,
          tree: tree.sha,
          parents: [baseHead],
        }),
      },
    );
    if (!commit?.sha) throw new Error("GitHub batch commit creation did not return a SHA");
    const updated = await call<GitHubRefPayload>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/git/refs/heads/${encodePath(branch)}`,
      {
        method: "PATCH",
        headers: await headers(true),
        body: JSON.stringify({ sha: commit.sha, force: false }),
      },
      [409, 422],
    );
    if (updated.response.status === 409 || updated.response.status === 422) {
      throw new Error("The repository changed while batch publishing; synchronize and retry");
    }
    return { mode: "direct", status: "published", commitSha: commit.sha, branch };
  }

  return { snapshot, status, history, publish, publishBatch, delete: deleteArticle };
}

export type { GitHubRepositoryOptions };
