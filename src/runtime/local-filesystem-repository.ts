import { createHash, randomUUID } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { lstat, mkdir, readFile, readdir, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

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

export interface LocalFilesystemRepositoryOptions {
  rootPath: string;
  contentRoot?: string;
  maxArticleBytes?: number;
  now?: () => Date;
}

const DEFAULT_CONTENT_ROOT = "src/content";
const DEFAULT_MAX_ARTICLE_BYTES = 1024 * 1024;
const execFile = promisify(execFileCallback);

function normalizeContentRoot(value: string): string {
  const normalized = value.trim().replace(/^\/+|\/+$/g, "");
  if (
    !normalized || normalized.includes("\\") ||
    normalized.split("/").some((part) => !part || part === "." || part === "..")
  ) throw new Error("CMS_CONTENT_ROOT must be a safe repository-relative directory");
  return normalized;
}

function repositoryPath(rootPath: string, path: string, contentRoot: string): string {
  if (
    path.includes("\\") || path.startsWith("/") ||
    path.split("/").some((part) => !part || part === "." || part === "..") ||
    !path.startsWith(`${contentRoot}/`) || !/\.(?:md|mdx)$/i.test(path)
  ) throw new Error(`Publication path must be a Markdown file inside ${contentRoot}`);
  const target = resolve(rootPath, ...path.split("/"));
  if (!target.startsWith(`${rootPath}${sep}`)) throw new Error("Publication path escapes the repository");
  return target;
}

async function markdownFiles(directory: string): Promise<string[]> {
  const result: string[] = [];
  async function walk(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && /\.(?:md|mdx)$/i.test(entry.name)) result.push(path);
    }
  }
  await walk(directory);
  return result.sort();
}

function worktreeHash(articles: RepositoryArticle[]): string {
  const hash = createHash("sha256");
  for (const article of articles) {
    hash.update(String(Buffer.byteLength(article.path))).update(":").update(article.path);
    hash.update(String(Buffer.byteLength(article.source))).update(":").update(article.source);
  }
  return hash.digest("hex");
}

/** Node-only adapter for previewing and editing a local New Echoes checkout. */
export async function createLocalFilesystemRepository(
  options: LocalFilesystemRepositoryOptions,
): Promise<GitRepositoryPort> {
  const rootPath = await realpath(resolve(options.rootPath));
  const contentRoot = normalizeContentRoot(options.contentRoot ?? DEFAULT_CONTENT_ROOT);
  const contentDirectory = await realpath(resolve(rootPath, ...contentRoot.split("/")));
  if (!contentDirectory.startsWith(`${rootPath}${sep}`)) {
    throw new Error("CMS_CONTENT_ROOT resolves outside CMS_REPOSITORY_PATH");
  }
  const maxArticleBytes = options.maxArticleBytes ?? DEFAULT_MAX_ARTICLE_BYTES;
  const now = options.now ?? (() => new Date());
  const repositoryId = `filesystem:local/${basename(rootPath)}`;
  let lastCheckedAt: string | null = null;

  async function readSnapshot(): Promise<RepositorySnapshot> {
    const files = await markdownFiles(contentDirectory);
    const articles = await Promise.all(files.map(async (filename): Promise<RepositoryArticle> => {
      const bytes = await readFile(filename);
      const path = relative(rootPath, filename).split(sep).join("/");
      if (bytes.byteLength > maxArticleBytes) {
        throw new Error(`Article ${path} exceeds the ${maxArticleBytes}-byte limit`);
      }
      return {
        path,
        source: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
        format: path.toLowerCase().endsWith(".mdx") ? "mdx" : "md",
      };
    }));
    lastCheckedAt = now().toISOString();
    return {
      repositoryId,
      branch: "working-tree",
      headCommit: worktreeHash(articles),
      articles,
    };
  }

  async function status(): Promise<RepositoryStatus> {
    const current = await readSnapshot();
    return {
      configured: true,
      repositoryId,
      provider: "filesystem",
      defaultBranch: current.branch,
      headCommit: current.headCommit,
      contentRoot,
      lastCheckedAt,
    };
  }

  async function history(path: string, limit = 50): Promise<RepositoryArticleRevision[]> {
    repositoryPath(rootPath, path, contentRoot);
    const safeLimit = Math.max(1, Math.min(limit, 100));
    let stdout: string;
    try {
      ({ stdout } = await execFile("git", [
        "-c", "core.quotepath=false", "log", "--follow", `--max-count=${safeLimit}`,
        "--format=%x1e%H%x1f%cI%x1f%s", "--name-only", "--", path,
      ], { cwd: rootPath, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }));
    } catch {
      return [];
    }
    const revisions: RepositoryArticleRevision[] = [];
    for (const record of stdout.split("\x1e")) {
      const lines = record.split("\n").map((line) => line.trim()).filter(Boolean);
      const [commitSha, committedAt, commitMessage = "未命名提交"] = (lines.shift() ?? "").split("\x1f");
      if (!/^[0-9a-f]{40}$/i.test(commitSha ?? "") || !committedAt) continue;
      const historicalPath = [...lines].reverse().find((entry) => /\.mdx?$/i.test(entry)) ?? path;
      try {
        const shown = await execFile("git", ["show", `${commitSha}:${historicalPath}`], {
          cwd: rootPath, encoding: "buffer", maxBuffer: maxArticleBytes + 1024,
        });
        const bytes = new Uint8Array(shown.stdout);
        if (bytes.byteLength > maxArticleBytes) continue;
        revisions.push({
          path: historicalPath,
          source: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
          commitSha,
          commitMessage,
          committedAt,
        });
      } catch {
        // A deletion or unusual rename commit has no readable blob; keep walking.
      }
    }
    return revisions;
  }

  async function publish(input: RepositoryPublishRequest): Promise<RepositoryPublishResult> {
    const target = repositoryPath(rootPath, input.path, contentRoot);
    const previousTarget = input.previousPath
      ? repositoryPath(rootPath, input.previousPath, contentRoot)
      : null;
    if (new TextEncoder().encode(input.source).byteLength > maxArticleBytes) {
      throw new Error(`Article ${input.path} exceeds the ${maxArticleBytes}-byte limit`);
    }
    const before = await readSnapshot();
    if (input.baseContentHash === undefined && input.expectedHeadCommit && input.expectedHeadCommit !== before.headCommit) {
      throw new Error("The local content directory changed; synchronize before publishing");
    }
    if (input.baseContentHash !== undefined) {
      const remotePath = input.remoteCheckPath ?? input.basePath ?? input.path;
      const remoteEntry = before.articles.find((article) => article.path === remotePath);
      const targetEntry = before.articles.find((article) => article.path === input.path);
      const remoteHash = remoteEntry ? await sha256Text(remoteEntry.source) : null;
      const targetHash = targetEntry ? await sha256Text(targetEntry.source) : null;
      const remoteDiverged = input.basePath != null && remoteHash !== input.baseContentHash;
      const targetCollision = remotePath !== input.path && targetHash !== null && targetHash !== input.contentHash;
      const newPathCollision = input.basePath == null && remotePath === input.path && targetHash !== null && targetHash !== input.contentHash;
      if (targetCollision || newPathCollision || (remoteDiverged && remoteHash !== input.contentHash)) {
        throw new RepositoryContentConflictError({
          kind: targetCollision || newPathCollision ? "path_collision" : remoteHash === null ? "delete_edit" : "edit_edit",
          remotePath: targetCollision || newPathCollision ? input.path : remoteHash === null ? null : remotePath,
          remoteSource: targetCollision || newPathCollision ? targetEntry?.source ?? null : remoteEntry?.source ?? null,
          remoteContentHash: targetCollision || newPathCollision ? targetHash : remoteHash,
          remoteCommitSha: before.headCommit,
        });
      }
    }
    try {
      if ((await lstat(target)).isSymbolicLink()) throw new Error("Refusing to replace a symbolic link");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await mkdir(dirname(target), { recursive: true });
    const temporary = resolve(dirname(target), `.echoes-studio-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, input.source, { encoding: "utf8", flag: "wx" });
      await rename(temporary, target);
      if (previousTarget && previousTarget !== target) {
        await unlink(previousTarget).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        });
      }
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
    const after = await readSnapshot();
    return {
      mode: input.mode,
      status: "published",
      commitSha: after.headCommit,
      branch: "local",
    };
  }

  async function deleteArticle(input: RepositoryDeleteRequest): Promise<RepositoryDeleteResult> {
    const target = repositoryPath(rootPath, input.path, contentRoot);
    const before = await readSnapshot();
    const remote = before.articles.find((article) => article.path === input.path);
    if (!remote) return { status: "deleted", commitSha: before.headCommit, branch: "local" };
    const remoteHash = await sha256Text(remote.source);
    if (input.baseContentHash != null && remoteHash !== input.baseContentHash) {
      throw new RepositoryContentConflictError({
        kind: "delete_edit",
        remotePath: input.path,
        remoteSource: remote.source,
        remoteContentHash: remoteHash,
        remoteCommitSha: before.headCommit,
      });
    }
    if (input.baseContentHash == null && input.expectedHeadCommit && input.expectedHeadCommit !== before.headCommit) {
      throw new Error("The local content directory changed; synchronize before deleting");
    }
    try {
      if ((await lstat(target)).isSymbolicLink()) throw new Error("Refusing to delete a symbolic link");
      await unlink(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const after = await readSnapshot();
    return { status: "deleted", commitSha: after.headCommit, branch: "local" };
  }

  async function publishBatch(input: RepositoryBatchPublishRequest): Promise<RepositoryPublishResult> {
    if (input.mode !== "direct") throw new Error("Batch publishing currently requires direct mode");
    if (input.changes.length === 0) throw new Error("Batch publication has no changes");
    const before = await readSnapshot();
    const byPath = new Map(before.articles.map((article) => [article.path, article]));
    const vacatedPaths = new Set(input.changes.flatMap((change) => {
      if (change.operation === "delete") return [change.path];
      return change.previousPath && change.previousPath !== change.path ? [change.previousPath] : [];
    }));
    const conflicts = [];
    const targetPaths = new Set<string>();

    for (const change of input.changes) {
      repositoryPath(rootPath, change.path, contentRoot);
      if (change.operation === "delete") {
        const remote = byPath.get(change.path);
        const remoteHash = remote ? await sha256Text(remote.source) : null;
        if (change.baseContentHash != null && remoteHash !== null && remoteHash !== change.baseContentHash) {
          conflicts.push({
            publicationId: change.publicationId,
            snapshot: {
              kind: "delete_edit" as const,
              remotePath: change.path,
              remoteSource: remote?.source ?? null,
              remoteContentHash: remoteHash,
              remoteCommitSha: before.headCommit,
            },
          });
        }
        continue;
      }
      if (change.previousPath) repositoryPath(rootPath, change.previousPath, contentRoot);
      if (targetPaths.has(change.path)) throw new Error(`Batch publication contains duplicate path ${change.path}`);
      targetPaths.add(change.path);
      if (new TextEncoder().encode(change.source).byteLength > maxArticleBytes) {
        throw new Error(`Article ${change.path} exceeds the ${maxArticleBytes}-byte limit`);
      }
      const remotePath = change.remoteCheckPath ?? change.basePath ?? change.path;
      const remote = byPath.get(remotePath);
      const target = byPath.get(change.path);
      const remoteHash = remote ? await sha256Text(remote.source) : null;
      const targetHash = target ? await sha256Text(target.source) : null;
      const remoteDiverged = change.basePath != null && remoteHash !== change.baseContentHash;
      const targetCollision = remotePath !== change.path && targetHash !== null
        && targetHash !== change.contentHash && !vacatedPaths.has(change.path);
      const newPathCollision = change.basePath == null && remotePath === change.path
        && targetHash !== null && targetHash !== change.contentHash;
      if (targetCollision || newPathCollision || (remoteDiverged && remoteHash !== change.contentHash)) {
        conflicts.push({
          publicationId: change.publicationId,
          snapshot: {
            kind: targetCollision || newPathCollision ? "path_collision" as const
              : remoteHash === null ? "delete_edit" as const : "edit_edit" as const,
            remotePath: targetCollision || newPathCollision ? change.path : remoteHash === null ? null : remotePath,
            remoteSource: targetCollision || newPathCollision ? target?.source ?? null : remote?.source ?? null,
            remoteContentHash: targetCollision || newPathCollision ? targetHash : remoteHash,
            remoteCommitSha: before.headCommit,
          },
        });
      }
    }
    if (conflicts.length > 0) throw new RepositoryBatchContentConflictError(conflicts);

    const temporaryFiles: Array<{ temporary: string; target: string }> = [];
    try {
      for (const change of input.changes) {
        if (change.operation !== "upsert") continue;
        const target = repositoryPath(rootPath, change.path, contentRoot);
        try {
          if ((await lstat(target)).isSymbolicLink()) throw new Error("Refusing to replace a symbolic link");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        await mkdir(dirname(target), { recursive: true });
        const temporary = resolve(dirname(target), `.echoes-studio-${randomUUID()}.tmp`);
        await writeFile(temporary, change.source, { encoding: "utf8", flag: "wx" });
        temporaryFiles.push({ temporary, target });
      }
      for (const file of temporaryFiles) await rename(file.temporary, file.target);
      for (const change of input.changes) {
        const deletePaths = change.operation === "delete"
          ? [change.path]
          : change.previousPath && change.previousPath !== change.path ? [change.previousPath] : [];
        for (const path of deletePaths) {
          await unlink(repositoryPath(rootPath, path, contentRoot)).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== "ENOENT") throw error;
          });
        }
      }
    } catch (error) {
      await Promise.all(temporaryFiles.map(({ temporary }) => unlink(temporary).catch(() => undefined)));
      throw error;
    }
    const after = await readSnapshot();
    return { mode: "direct", status: "published", commitSha: after.headCommit, branch: "local" };
  }

  return { snapshot: readSnapshot, status, history, publish, publishBatch, delete: deleteArticle };
}
