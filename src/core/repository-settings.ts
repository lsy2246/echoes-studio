export type RepositoryProvider = "filesystem" | "github";

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
  update(input: UpdateRepositoryConnectionInput): Promise<RepositoryConnectionSettings>;
}
