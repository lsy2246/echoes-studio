export type RepositoryProvider = "filesystem" | "github" | "gitee";

export interface RepositoryConnectionTestResult {
  ok: true;
  provider: RepositoryProvider;
  branch: string;
  headCommit: string;
  checkedAt: string;
  message: string;
}

export interface RepositoryConnectionSettings {
  provider: RepositoryProvider;
  owner: string;
  repository: string;
  branch: string;
  contentRoot: string;
  filesystemPath: string;
  tokenConfigured: boolean;
  updatedAt: string | null;
}

export interface UpdateRepositoryConnectionInput {
  provider: RepositoryProvider;
  owner?: string;
  repository?: string;
  branch?: string;
  contentRoot: string;
  filesystemPath?: string;
  token?: string;
  clearToken?: boolean;
}

export interface RepositorySettingsService {
  get(): Promise<RepositoryConnectionSettings>;
  test(input: UpdateRepositoryConnectionInput): Promise<RepositoryConnectionTestResult>;
  update(input: UpdateRepositoryConnectionInput): Promise<RepositoryConnectionSettings>;
}
