import type { DatabasePort } from "../core/database-port.ts";
import type {
  GitRepositoryPort,
  RepositoryArticleRevision,
  RepositoryBatchPublishRequest,
  RepositoryDeleteRequest,
  RepositoryPublishRequest,
} from "../core/git-repository-port.ts";
import type {
  RepositoryConnectionSettings,
  RepositorySettingsService,
  UpdateRepositoryConnectionInput,
} from "../core/repository-settings.ts";
import { decryptSecret, encryptSecret } from "../core/secret-box.ts";
import { createGitHubRepository } from "./github-repository.ts";
import { createGiteeRepository } from "./gitee-repository.ts";

interface StoredRepositoryConfig {
  provider: "filesystem" | "github" | "gitee";
  owner: string;
  repository: string;
  branch: string;
  contentRoot: string;
  filesystemPath: string;
  tokenCiphertext: string | null;
}

interface ConfigurableRepositoryOptions {
  database: DatabasePort;
  fallback: GitRepositoryPort;
  fallbackSettings: RepositoryConnectionSettings;
  encryptionSecret?: string | (() => Promise<string>);
  fallbackGithubToken?: () => Promise<string>;
  githubApiBaseUrl?: string;
  giteeApiBaseUrl?: string;
  maxArticleBytes?: number;
  blobConcurrency?: number;
  createFilesystem?: (
    path: string,
    contentRoot: string,
  ) => Promise<GitRepositoryPort>;
  now?: () => Date;
}

function normalizePath(value: string, fallback: string): string {
  return value.trim().replace(/^\/+|\/+$/g, "") || fallback;
}

export class ConfigurableRepository
  implements GitRepositoryPort, RepositorySettingsService
{
  private cachedJson: string | null | undefined;
  private cachedPort: GitRepositoryPort | undefined;

  constructor(private readonly options: ConfigurableRepositoryOptions) {}

  private async encryptionSecret(): Promise<string | undefined> {
    return typeof this.options.encryptionSecret === "function"
      ? this.options.encryptionSecret()
      : this.options.encryptionSecret;
  }

  private parse(value: string): StoredRepositoryConfig {
    const parsed = JSON.parse(value) as Partial<StoredRepositoryConfig>;
    if (
      parsed.provider !== "filesystem" &&
      parsed.provider !== "github" &&
      parsed.provider !== "gitee"
    )
      throw new Error("Stored repository provider is invalid");
    return {
      provider: parsed.provider,
      owner: String(parsed.owner ?? ""),
      repository: String(parsed.repository ?? ""),
      branch: String(parsed.branch ?? ""),
      contentRoot: normalizePath(
        String(parsed.contentRoot ?? ""),
        "src/content",
      ),
      filesystemPath: String(parsed.filesystemPath ?? ""),
      tokenCiphertext:
        typeof parsed.tokenCiphertext === "string"
          ? parsed.tokenCiphertext
          : null,
    };
  }

  private async stored(): Promise<{
    config: StoredRepositoryConfig;
    updatedAt: string;
  } | null> {
    const settings = await this.options.database.getSystemSettings();
    if (!settings.repositoryConfigJson) return null;
    return {
      config: this.parse(settings.repositoryConfigJson),
      updatedAt: settings.updatedAt,
    };
  }

  async get(): Promise<RepositoryConnectionSettings> {
    const stored = await this.stored();
    if (!stored) return this.options.fallbackSettings;
    const { config } = stored;
    return {
      provider: config.provider,
      owner: config.owner,
      repository: config.repository,
      branch: config.branch,
      contentRoot: config.contentRoot,
      filesystemPath: config.filesystemPath,
      tokenConfigured:
        Boolean(config.tokenCiphertext) ||
        (config.provider === "github" && Boolean(this.options.fallbackGithubToken)),
      updatedAt: stored.updatedAt,
    };
  }

  async update(
    input: UpdateRepositoryConnectionInput,
  ): Promise<RepositoryConnectionSettings> {
    const current = await this.stored();
    const contentRoot = normalizePath(input.contentRoot, "src/content");
    if (
      contentRoot
        .split("/")
        .some((part) => !part || part === "." || part === "..")
    ) {
      throw new Error("文章目录必须是安全的仓库相对路径");
    }
    if (
      (input.provider === "github" || input.provider === "gitee") &&
      (!input.owner?.trim() || !input.repository?.trim())
    ) {
      throw new Error(`${input.provider === "gitee" ? "Gitee" : "GitHub"} 仓库所有者和仓库名不能为空`);
    }
    if (input.provider === "filesystem" && !input.filesystemPath?.trim()) {
      throw new Error("本地仓库路径不能为空");
    }
    let tokenCiphertext = input.clearToken
      ? null
      : current?.config.provider === input.provider
        ? (current.config.tokenCiphertext ?? null)
        : null;
    let clearToken = input.token?.trim() || "";
    if (clearToken) {
      const secret = await this.encryptionSecret();
      if (!secret) throw new Error("服务端尚未生成安装密钥");
      tokenCiphertext = await encryptSecret(clearToken, secret);
    } else if (tokenCiphertext) {
      const secret = await this.encryptionSecret();
      if (!secret) throw new Error("服务端尚未生成安装密钥");
      clearToken = await decryptSecret(tokenCiphertext, secret);
    }
    let branch = input.branch?.trim() ?? "";
    const tested = await this.test({ ...input, contentRoot, token: clearToken || undefined });
    branch ||= tested.branch;
    const config: StoredRepositoryConfig = {
      provider: input.provider,
      owner: input.owner?.trim() ?? "",
      repository: input.repository?.trim() ?? "",
      branch,
      contentRoot,
      filesystemPath: input.filesystemPath?.trim() ?? "",
      tokenCiphertext,
    };
    await this.options.database.updateSystemSettings({
      repositoryConfigJson: JSON.stringify(config),
      now: (this.options.now?.() ?? new Date()).toISOString(),
    });
    this.cachedJson = undefined;
    this.cachedPort = undefined;
    return this.get();
  }

  async test(input: UpdateRepositoryConnectionInput) {
    const contentRoot = normalizePath(input.contentRoot, "src/content");
    let clearToken = input.token?.trim() || "";
    if (!clearToken && !input.clearToken) {
      const current = await this.stored();
      if (current?.config.tokenCiphertext && current.config.provider === input.provider) {
        const secret = await this.encryptionSecret();
        if (!secret) throw new Error("服务端尚未生成安装密钥");
        clearToken = await decryptSecret(current.config.tokenCiphertext, secret);
      }
    }
    let port: GitRepositoryPort;
    if (input.provider === "filesystem") {
      if (!input.filesystemPath?.trim()) throw new Error("本地仓库路径不能为空");
      if (!this.options.createFilesystem) throw new Error("当前运行平台不支持本地文件仓库");
      port = await this.options.createFilesystem(input.filesystemPath.trim(), contentRoot);
    } else {
      if (!input.owner?.trim() || !input.repository?.trim()) {
        throw new Error(`${input.provider === "gitee" ? "Gitee" : "GitHub"} 仓库所有者和仓库名不能为空`);
      }
      const common = {
        owner: input.owner.trim(),
        repository: input.repository.trim(),
        branch: input.branch?.trim() || undefined,
        contentRoot,
        maxArticleBytes: this.options.maxArticleBytes,
        blobConcurrency: this.options.blobConcurrency,
      };
      port = input.provider === "gitee"
        ? createGiteeRepository({
            ...common,
            token: clearToken ? async () => clearToken : undefined,
            apiBaseUrl: this.options.giteeApiBaseUrl,
          })
        : createGitHubRepository({
            ...common,
            token: clearToken ? async () => clearToken : this.options.fallbackGithubToken,
            apiBaseUrl: this.options.githubApiBaseUrl,
          });
    }
    const status = await port.status();
    return {
      ok: true as const,
      provider: input.provider,
      branch: status.defaultBranch,
      headCommit: status.headCommit,
      checkedAt: status.lastCheckedAt ?? (this.options.now?.() ?? new Date()).toISOString(),
      message: `连接成功，已读取 ${status.defaultBranch} 分支`,
    };
  }

  private async active(): Promise<GitRepositoryPort> {
    const settings = await this.options.database.getSystemSettings();
    const raw = settings.repositoryConfigJson;
    if (!raw) return this.options.fallback;
    if (this.cachedJson === raw && this.cachedPort) return this.cachedPort;
    const config = this.parse(raw);
    let port: GitRepositoryPort;
    if (config.provider === "filesystem") {
      if (!this.options.createFilesystem)
        throw new Error("当前运行平台不支持本地文件仓库");
      port = await this.options.createFilesystem(
        config.filesystemPath,
        config.contentRoot,
      );
    } else {
      let token = config.provider === "github" ? this.options.fallbackGithubToken : undefined;
      if (config.tokenCiphertext) {
        const secret = await this.encryptionSecret();
        if (!secret) throw new Error("服务端尚未生成安装密钥");
        const clear = await decryptSecret(config.tokenCiphertext, secret);
        token = async () => clear;
      }
      const common = {
        owner: config.owner,
        repository: config.repository,
        branch: config.branch || undefined,
        contentRoot: config.contentRoot,
        token,
        maxArticleBytes: this.options.maxArticleBytes,
        blobConcurrency: this.options.blobConcurrency,
      };
      port = config.provider === "gitee"
        ? createGiteeRepository({ ...common, apiBaseUrl: this.options.giteeApiBaseUrl })
        : createGitHubRepository({ ...common, apiBaseUrl: this.options.githubApiBaseUrl });
    }
    this.cachedJson = raw;
    this.cachedPort = port;
    return port;
  }

  async snapshot() {
    return (await this.active()).snapshot();
  }
  async status() {
    return (await this.active()).status();
  }
  async history(
    path: string,
    limit?: number,
  ): Promise<RepositoryArticleRevision[]> {
    return (await this.active()).history?.(path, limit) ?? [];
  }
  async publish(input: RepositoryPublishRequest) {
    return (await this.active()).publish(input);
  }
  async publishBatch(input: RepositoryBatchPublishRequest) {
    return (await this.active()).publishBatch(input);
  }
  async delete(input: RepositoryDeleteRequest) {
    return (await this.active()).delete(input);
  }
}
