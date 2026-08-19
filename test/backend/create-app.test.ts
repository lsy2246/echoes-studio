import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createApp } from "../../src/backend/create-app";
import type {
  GitRepositoryPort,
  RepositoryDeleteRequest,
  RepositoryDeleteResult,
  RepositoryArticleRevision,
  RepositoryBatchPublishRequest,
  RepositoryPublishRequest,
  RepositoryPublishResult,
  RepositorySnapshot,
} from "../../src/core/git-repository-port";
import { RepositoryContentConflictError } from "../../src/core/git-repository-port";
import type { UpdateRepositoryConnectionInput } from "../../src/core/repository-settings";
import { sha256Text } from "../../src/core/hash";
import { MemoryDatabase } from "../../src/database/memory";
import { FetchCmsApiClient } from "../../src/web/api-client";

const ADMIN_HEADERS = {
  authorization: "Bearer admin-secret",
  "content-type": "application/json",
};
const INTERNAL_HEADERS = {
  authorization: "Bearer scheduler-secret",
  "content-type": "application/json",
};

class FakeRepository implements GitRepositoryPort {
  snapshotValue: RepositorySnapshot = {
    repositoryId: "github:echoes/site",
    branch: "main",
    headCommit: "1111111111111111111111111111111111111111",
    articles: [],
  };
  publishResult: RepositoryPublishResult = {
    mode: "pull-request",
    status: "pending",
    branch: "echoes/publication",
    pullRequestUrl: "https://github.example/pull/1",
  };
  readonly publishCalls: RepositoryPublishRequest[] = [];
  readonly publishBatchCalls: RepositoryBatchPublishRequest[] = [];
  readonly deleteCalls: RepositoryDeleteRequest[] = [];
  historyValue: RepositoryArticleRevision[] = [];
  publishError: Error | null = null;

  async snapshot(): Promise<RepositorySnapshot> {
    return structuredClone(this.snapshotValue);
  }

  async status() {
    return {
      configured: true,
      repositoryId: this.snapshotValue.repositoryId,
      provider: "github",
      defaultBranch: this.snapshotValue.branch,
      headCommit: this.snapshotValue.headCommit,
      lastCheckedAt: "2026-08-13T00:00:00.000Z",
    };
  }

  async history(): Promise<RepositoryArticleRevision[]> {
    return structuredClone(this.historyValue);
  }

  async publish(
    input: RepositoryPublishRequest,
  ): Promise<RepositoryPublishResult> {
    this.publishCalls.push(structuredClone(input));
    if (this.publishError) throw this.publishError;
    return structuredClone({ ...this.publishResult, mode: input.mode });
  }

  async publishBatch(
    input: RepositoryBatchPublishRequest,
  ): Promise<RepositoryPublishResult> {
    this.publishBatchCalls.push(structuredClone(input));
    if (this.publishError) throw this.publishError;
    return structuredClone({ ...this.publishResult, mode: input.mode });
  }

  async delete(
    input: RepositoryDeleteRequest,
  ): Promise<RepositoryDeleteResult> {
    this.deleteCalls.push(structuredClone(input));
    this.snapshotValue.articles = this.snapshotValue.articles.filter(
      (article) => article.path !== input.path,
    );
    return {
      status: "deleted",
      commitSha: this.snapshotValue.headCommit,
      branch: this.snapshotValue.branch,
    };
  }
}

async function payload(response: Response): Promise<any> {
  return response.json();
}

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`https://studio.example${path}`, init);
}

function appOptions(
  database = new MemoryDatabase(),
  repository = new FakeRepository(),
) {
  let sequence = 0;
  return {
    database,
    repository,
    adminToken: "admin-secret",
    sessionSecret: "test-session-secret-with-at-least-32-characters",
    internalToken: "scheduler-secret",
    id: () => `id-${++sequence}`,
    now: () => new Date("2026-08-13T12:00:00.000Z"),
  };
}

describe("createApp repository orchestration", () => {
  it("initializes a new installation without preconfigured application secrets", async () => {
    const database = new MemoryDatabase();
    const repositoryInputs: UpdateRepositoryConnectionInput[] = [];
    const app = createApp({
      ...appOptions(database),
      adminToken: undefined,
      sessionSecret: undefined,
      internalToken: undefined,
      repositorySettings: {
        async get() {
          return {
            provider: "github" as const,
            owner: "",
            repository: "",
            branch: "",
            contentRoot: "src/content",
            filesystemPath: "",
            tokenConfigured: false,
            updatedAt: null,
          };
        },
        async update(input) {
          repositoryInputs.push(input);
          return {
            provider: input.provider,
            owner: input.owner ?? "",
            repository: input.repository ?? "",
            branch: input.branch ?? "main",
            contentRoot: input.contentRoot,
            filesystemPath: input.filesystemPath ?? "",
            tokenConfigured: Boolean(input.token),
            updatedAt: "2026-08-13T12:00:00.000Z",
          };
        },
        async test(input) {
          return {
            ok: true,
            provider: input.provider,
            branch: input.branch || "main",
            headCommit: "a".repeat(40),
            checkedAt: "2026-08-13T12:00:00.000Z",
            message: "连接成功",
          };
        },
      },
    });

    const status = await app(request("/api/setup/status"));
    assert.equal(status.status, 200);
    assert.equal((await payload(status)).data.required, true);

    const connectionTest = await app(
      request("/api/setup/repository/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: "gitee",
          repositoryUrl: "https://gitee.com/echoes/site.git",
          repositoryToken: "gitee_token_test",
          contentRoot: "src/content",
        }),
      }),
    );
    assert.equal(connectionTest.status, 200);
    assert.equal((await payload(connectionTest)).data.provider, "gitee");
    assert.equal(repositoryInputs.length, 0);

    const initialized = await app(
      request("/api/setup/initialize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          password: "a-new-secure-password",
          repositoryProvider: "gitee",
          repositoryUrl: "https://gitee.com/echoes/site.git",
          repositoryToken: "gitee_token_test",
          contentRoot: "src/content",
        }),
      }),
    );
    assert.equal(initialized.status, 201);
    const repositoryInput = repositoryInputs[0];
    assert.ok(repositoryInput);
    assert.deepEqual(
      {
        provider: repositoryInput.provider,
        owner: repositoryInput.owner,
        repository: repositoryInput.repository,
        branch: repositoryInput.branch,
        contentRoot: repositoryInput.contentRoot,
        token: repositoryInput.token,
      },
      {
        provider: "gitee",
        owner: "echoes",
        repository: "site",
        branch: "",
        contentRoot: "src/content",
        token: "gitee_token_test",
      },
    );
    const settings = await database.getSystemSettings();
    assert.ok(settings.passwordHash);
    assert.match(settings.passwordHash ?? "", /^pbkdf2-sha256\$100000\$/);
    assert.equal(settings.passwordHashIterations, 100_000);
    assert.match(settings.installationSecret ?? "", /^[A-Za-z0-9_-]{40,}$/);
    assert.match(settings.internalToken ?? "", /^[A-Za-z0-9_-]{40,}$/);

    const cookie = (initialized.headers.get("set-cookie") ?? "").split(
      ";",
      1,
    )[0];
    assert.equal(
      (await app(request("/api/repository/status", { headers: { cookie } })))
        .status,
      200,
    );
    assert.equal(
      (await payload(await app(request("/api/setup/status")))).data.required,
      false,
    );
    assert.equal(
      (
        await app(
          request("/api/setup/initialize", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ password: "another-password" }),
          }),
        )
      ).status,
      409,
    );
  });

  it("requires scoped authentication and exposes health/status", async () => {
    const repository = new FakeRepository();
    const app = createApp(appOptions(new MemoryDatabase(), repository));

    const health = await app(request("/api/health"));
    assert.equal(health.status, 200);
    assert.equal((await payload(health)).data.adapter, "memory");

    const denied = await app(request("/api/repository/status"));
    assert.equal(denied.status, 401);
    assert.equal(
      (await payload(denied)).error.message,
      "登录凭证无效或已过期，请重新登录。",
    );
    const status = await app(
      request("/api/repository/status", { headers: ADMIN_HEADERS }),
    );
    assert.equal(status.status, 200);
    assert.equal(
      (await payload(status)).data.repositoryId,
      "github:echoes/site",
    );
  });

  it("exchanges the password for an HttpOnly session and clears it on logout", async () => {
    const app = createApp(appOptions());
    const denied = await app(
      request("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: "wrong" }),
      }),
    );
    assert.equal(denied.status, 401);

    const login = await app(
      request("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: "admin-secret" }),
      }),
    );
    assert.equal(login.status, 200);
    const setCookie = login.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /^echoes_session=[^.]+\.[^.]+\.[^;]+;/);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);
    assert.match(setCookie, /Secure/);

    const cookie = setCookie.split(";", 1)[0];
    const authorized = await app(
      request("/api/repository/status", { headers: { cookie } }),
    );
    assert.equal(authorized.status, 200);

    const tampered = await app(
      request("/api/repository/status", {
        headers: { cookie: `${cookie.slice(0, -1)}x` },
      }),
    );
    assert.equal(tampered.status, 401);

    const logout = await app(
      request("/api/auth/logout", { method: "POST", headers: { cookie } }),
    );
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get("set-cookie") ?? "", /Max-Age=0/);
  });

  it("changes the persisted password and revokes older browser sessions", async () => {
    const database = new MemoryDatabase();
    const app = createApp(appOptions(database));
    const login = await app(
      request("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: "admin-secret" }),
      }),
    );
    const oldCookie = (login.headers.get("set-cookie") ?? "").split(";", 1)[0];
    const before = await app(
      request("/api/settings/password", { headers: ADMIN_HEADERS }),
    );
    assert.equal((await payload(before)).data.iterations, 100_000);
    const changed = await app(
      request("/api/settings/password", {
        method: "POST",
        headers: { ...ADMIN_HEADERS, cookie: oldCookie },
        body: JSON.stringify({
          currentPassword: "admin-secret",
          newPassword: "new-password-123",
          iterations: 150_000,
        }),
      }),
    );
    assert.equal(changed.status, 200);
    assert.equal((await database.getSystemSettings()).passwordHashIterations, 150_000);
    assert.match(
      (await database.getSystemSettings()).passwordHash ?? "",
      /^pbkdf2-sha256\$150000\$/,
    );
    assert.equal(
      (
        await app(
          request("/api/repository/status", { headers: { cookie: oldCookie } }),
        )
      ).status,
      401,
    );
    assert.equal(
      (
        await app(
          request("/api/auth/login", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ password: "admin-secret" }),
          }),
        )
      ).status,
      401,
    );
    assert.equal(
      (
        await app(
          request("/api/auth/login", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ password: "new-password-123" }),
          }),
        )
      ).status,
      200,
    );
  });

  it("actively pulls a snapshot, computes deletions and deduplicates the head", async () => {
    const database = new MemoryDatabase();
    const repository = new FakeRepository();
    const source = "---\ntitle: Pulled\n---\n\nFrom Git\n";
    repository.snapshotValue.articles = [{ path: "content/pulled.md", source }];
    const app = createApp(appOptions(database, repository));

    const first = await app(
      request("/api/repository/sync", {
        method: "POST",
        headers: ADMIN_HEADERS,
      }),
    );
    assert.equal(first.status, 200);
    const firstData = (await payload(first)).data;
    assert.equal(firstData.imported, 1);
    assert.equal(firstData.duplicate, false);
    assert.equal(
      (await database.getArticleByPath("content/pulled.md"))?.source,
      source,
    );

    const duplicate = await app(
      request("/api/internal/reconcile", {
        method: "POST",
        headers: INTERNAL_HEADERS,
      }),
    );
    assert.equal(duplicate.status, 200);
    assert.equal((await payload(duplicate)).data.duplicate, true);

    repository.snapshotValue = {
      ...repository.snapshotValue,
      headCommit: "2222222222222222222222222222222222222222",
      articles: [],
    };
    const removed = await app(
      request("/api/internal/reconcile", {
        method: "POST",
        headers: INTERNAL_HEADERS,
      }),
    );
    assert.equal((await payload(removed)).data.deleted, 1);
    assert.equal(await database.getArticleByPath("content/pulled.md"), null);
  });

  it("persists automation intervals and skips scheduled pulls until due", async () => {
    const database = new MemoryDatabase();
    const app = createApp(appOptions(database));
    const updated = await app(
      request("/api/settings/automation", {
        method: "PATCH",
        headers: ADMIN_HEADERS,
        body: JSON.stringify({ autoSaveSeconds: 5, autoSyncMinutes: 30 }),
      }),
    );
    assert.equal(updated.status, 200);
    assert.deepEqual((await payload(updated)).data, {
      autoSaveSeconds: 5,
      autoSyncMinutes: 30,
      lastAutoSyncAt: null,
      updatedAt: "2026-08-13T12:00:00.000Z",
    });

    const first = await app(
      request("/api/internal/reconcile?scheduled=true", {
        method: "POST",
        headers: INTERNAL_HEADERS,
      }),
    );
    assert.equal(first.status, 200);
    assert.equal(
      (await database.getAutomationSettings()).lastAutoSyncAt,
      "2026-08-13T12:00:00.000Z",
    );

    const skipped = await app(
      request("/api/internal/reconcile?scheduled=true", {
        method: "POST",
        headers: INTERNAL_HEADERS,
      }),
    );
    assert.deepEqual((await payload(skipped)).data, {
      skipped: true,
      reason: "not_due",
      nextSyncAt: "2026-08-13T12:30:00.000Z",
    });
  });

  it("loads provider-native Git commits instead of repeating the latest snapshot", async () => {
    const database = new MemoryDatabase();
    const repository = new FakeRepository();
    const latest = "---\ntitle: History\n---\n\nLatest\n";
    const older = "---\ntitle: History\n---\n\nOlder\n";
    repository.snapshotValue.articles = [
      { path: "content/history.md", source: latest },
    ];
    repository.historyValue = [
      {
        path: "content/history.md",
        source: latest,
        commitSha: "a".repeat(40),
        commitMessage: "更新历史文章",
        committedAt: "2026-08-12T10:00:00.000Z",
      },
      {
        path: "content/old/history.md",
        source: older,
        commitSha: "b".repeat(40),
        commitMessage: "创建历史文章",
        committedAt: "2026-08-11T10:00:00.000Z",
      },
    ];
    const app = createApp(appOptions(database, repository));
    await app(
      request("/api/repository/sync", {
        method: "POST",
        headers: ADMIN_HEADERS,
      }),
    );
    const article = (await database.getArticleByPath("content/history.md"))!;
    const response = await app(
      request(`/api/articles/${article.id}/revisions`, {
        headers: ADMIN_HEADERS,
      }),
    );
    assert.equal(response.status, 200);
    const revisions = (await payload(response)).data;
    assert.deepEqual(
      revisions.map((revision: any) => revision.gitCommitSha),
      ["a".repeat(40), "b".repeat(40)],
    );
    assert.deepEqual(
      revisions.map((revision: any) => revision.gitCommitMessage),
      ["更新历史文章", "创建历史文章"],
    );
    assert.equal(revisions[1].path, "content/old/history.md");
  });

  it("publishes a PR and reconciles it only after a matching active pull", async () => {
    const database = new MemoryDatabase();
    const repository = new FakeRepository();
    const original = "---\ntitle: Git article\n---\n\nBefore\n";
    repository.snapshotValue.articles = [
      { path: "content/git.md", source: original },
    ];
    const app = createApp(appOptions(database, repository));
    await app(
      request("/api/repository/sync", {
        method: "POST",
        headers: ADMIN_HEADERS,
      }),
    );
    const article = (await database.getArticleByPath("content/git.md"))!;

    const edited = "---\ntitle: Git article\n---\n\nAfter merge\n";
    const saved = await payload(
      await app(
        request(`/api/articles/${article.id}/draft`, {
          method: "PUT",
          headers: ADMIN_HEADERS,
          body: JSON.stringify({
            source: edited,
            path: "content/moved/git.md",
            version: 0,
          }),
        }),
      ),
    );
    const publishedResponse = await app(
      request(`/api/articles/${article.id}/publish`, {
        method: "POST",
        headers: ADMIN_HEADERS,
        body: JSON.stringify({
          version: saved.article.version,
          mode: "pull-request",
        }),
      }),
    );
    assert.equal(publishedResponse.status, 202);
    const published = await payload(publishedResponse);
    assert.equal(published.pullRequestUrl, "https://github.example/pull/1");
    assert.equal(repository.publishCalls.length, 1);
    assert.equal(repository.publishCalls[0].source, edited);
    assert.equal(repository.publishCalls[0].path, "content/moved/git.md");
    assert.equal(repository.publishCalls[0].previousPath, "content/git.md");
    assert.equal(
      repository.publishCalls[0].expectedHeadCommit,
      repository.snapshotValue.headCommit,
    );
    assert.equal(
      (await database.getPublication(published.publicationId))?.status,
      "dispatched",
    );

    repository.snapshotValue = {
      ...repository.snapshotValue,
      headCommit: "3333333333333333333333333333333333333333",
      articles: [{ path: "content/moved/git.md", source: edited }],
    };
    await app(
      request("/api/repository/sync", {
        method: "POST",
        headers: ADMIN_HEADERS,
      }),
    );
    const reconciled = await database.getPublication(published.publicationId);
    assert.equal(reconciled?.status, "published");
    assert.equal(reconciled?.commitSha, repository.snapshotValue.headCommit);
    assert.equal(await database.getDraft(article.id), null);
  });

  it("removes a redundant draft after content returns to the Git baseline", async () => {
    const database = new MemoryDatabase();
    const repository = new FakeRepository();
    const original = "---\ntitle: Converged\n---\n\nOriginal\n";
    repository.snapshotValue.articles = [
      { path: "content/converged.md", source: original },
    ];
    const app = createApp(appOptions(database, repository));
    const client = new FetchCmsApiClient({
      baseUrl: "https://studio.example/api",
      token: "admin-secret",
      fetch: ((input: URL | RequestInfo, init?: RequestInit) =>
        app(new Request(input, init))) as typeof globalThis.fetch,
    });

    await client.syncRepository();
    const article = (await client.listArticles())[0]!;
    const edited = await client.saveDraft({
      id: article.id,
      path: article.path,
      source: original.replace("Original", "Edited"),
      version: article.version,
    });
    assert.equal(edited.article.syncStatus, "unpublished");

    const converged = await client.saveDraft({
      id: article.id,
      path: article.path,
      source: original,
      version: edited.article.version,
    });
    assert.equal(converged.article.syncStatus, "synced");
    assert.equal(converged.article.version, 0);
    assert.equal(await database.getDraft(article.id), null);
  });

  it("discards pending CMS changes back to Git and removes local-only drafts", async () => {
    const database = new MemoryDatabase();
    const repository = new FakeRepository();
    const original = "---\ntitle: Revert me\n---\n\nRepository version\n";
    repository.snapshotValue.articles = [
      { path: "content/original.md", source: original },
    ];
    const app = createApp(appOptions(database, repository));
    const client = new FetchCmsApiClient({
      baseUrl: "https://studio.example/api",
      token: "admin-secret",
      fetch: ((input: URL | RequestInfo, init?: RequestInit) =>
        app(new Request(input, init))) as typeof globalThis.fetch,
    });

    await client.syncRepository();
    const imported = (await client.listArticles())[0]!;
    const changed = await client.saveDraft({
      id: imported.id,
      path: "content/moved/revert-me.md",
      source: original.replace("Repository version", "CMS version"),
      version: imported.version,
    });
    const restored = await client.discardDraft(
      changed.article.id,
      changed.article.version,
    );
    assert.equal(restored?.path, "content/original.md");
    assert.equal(restored?.source, original);
    assert.equal(restored?.syncStatus, "synced");
    assert.equal(await database.getDraft(imported.id), null);

    const local = await client.createArticle({
      path: "content/local-only.md",
      format: "md",
      source: "---\ntitle: Local only\n---\n\nDraft\n",
    });
    assert.equal(await client.discardDraft(local.id, local.version), null);
    assert.equal(await database.getArticle(local.id), null);
  });

  it("completes a direct publish synchronously", async () => {
    const database = new MemoryDatabase();
    const repository = new FakeRepository();
    repository.publishResult = {
      mode: "direct",
      status: "published",
      commitSha: "4444444444444444444444444444444444444444",
      branch: "main",
    };
    const app = createApp(appOptions(database, repository));
    const source = "---\ntitle: Direct\n---\n\nPublish me\n";
    const created = await payload(
      await app(
        request("/api/articles", {
          method: "POST",
          headers: ADMIN_HEADERS,
          body: JSON.stringify({ path: "content/direct.md", source }),
        }),
      ),
    );
    const response = await app(
      request(`/api/articles/${created.id}/publish`, {
        method: "POST",
        headers: ADMIN_HEADERS,
        body: JSON.stringify({
          version: created.version,
          mode: "direct",
          commitMessage: "发布：Direct",
        }),
      }),
    );
    assert.equal(response.status, 200);
    const result = await payload(response);
    assert.equal(
      (await database.getPublication(result.publicationId))?.status,
      "published",
    );
    assert.equal(await database.getDraft(created.id), null);
    assert.equal(
      (await database.getArticle(created.id))?.gitCommitSha,
      repository.publishResult.commitSha,
    );
    assert.equal(repository.publishCalls[0]?.commitMessage, "发布：Direct");
  });

  it("publishes multiple selected drafts through one atomic repository batch", async () => {
    const database = new MemoryDatabase();
    const repository = new FakeRepository();
    repository.publishResult = {
      mode: "direct",
      status: "published",
      commitSha: "5".repeat(40),
      branch: "main",
    };
    const app = createApp(appOptions(database, repository));
    const client = new FetchCmsApiClient({
      baseUrl: "https://studio.example/api",
      token: "admin-secret",
      fetch: ((input: URL | RequestInfo, init?: RequestInit) =>
        app(new Request(input, init))) as typeof globalThis.fetch,
    });
    const first = await client.createArticle({
      path: "content/first.md",
      format: "md",
      source: "---\ntitle: First\n---\n\nOne\n",
    });
    const second = await client.createArticle({
      path: "content/second.md",
      format: "md",
      source: "---\ntitle: Second\n---\n\nTwo\n",
    });

    const result = await client.publishArticles({
      items: [
        { id: first.id, version: first.version },
        { id: second.id, version: second.version },
      ],
      mode: "direct",
      commitMessage: "更新内容：两篇文章",
    });

    assert.equal(repository.publishCalls.length, 0);
    assert.equal(repository.publishBatchCalls.length, 1);
    assert.equal(repository.publishBatchCalls[0]?.changes.length, 2);
    assert.equal(
      repository.publishBatchCalls[0]?.commitMessage,
      "更新内容：两篇文章",
    );
    assert.equal(result.articles.length, 2);
    assert.ok(
      result.articles.every((article) => article?.syncStatus === "synced"),
    );
    assert.deepEqual(
      result.articles.map((article) => article?.metadata.title),
      ["First", "Second"],
    );
    assert.equal(
      (await database.getArticle(first.id))?.gitCommitSha,
      "5".repeat(40),
    );
    assert.equal(
      (await database.getArticle(second.id))?.gitCommitSha,
      "5".repeat(40),
    );
    assert.equal(await database.getDraft(first.id), null);
    assert.equal(await database.getDraft(second.id), null);
  });

  it("marks a published article for deletion and only deletes on a separate publish", async () => {
    const database = new MemoryDatabase();
    const repository = new FakeRepository();
    const source = "---\ntitle: Remove me\n---\n\nPublished\n";
    repository.snapshotValue.articles = [
      { path: "content/remove-me.md", source },
    ];
    const app = createApp(appOptions(database, repository));

    await app(
      request("/api/repository/sync", {
        method: "POST",
        headers: ADMIN_HEADERS,
      }),
    );
    const article = await database.getArticleByPath("content/remove-me.md");
    assert.ok(article);

    const markedResponse = await app(
      request(`/api/articles/${article.id}`, {
        method: "DELETE",
        headers: ADMIN_HEADERS,
        body: JSON.stringify({ expectedVersion: 0 }),
      }),
    );
    assert.equal(markedResponse.status, 200);
    assert.equal((await payload(markedResponse)).data.syncStatus, "deleting");
    assert.equal(repository.deleteCalls.length, 0);
    assert.ok(await database.getArticle(article.id));

    const publishedResponse = await app(
      request(`/api/articles/${article.id}/publish`, {
        method: "POST",
        headers: ADMIN_HEADERS,
        body: JSON.stringify({ expectedVersion: 1, mode: "direct" }),
      }),
    );
    assert.equal(publishedResponse.status, 200);
    assert.equal((await payload(publishedResponse)).article, null);
    assert.equal(repository.deleteCalls.length, 1);
    assert.equal(await database.getArticle(article.id), null);
  });

  it("persists publish-time conflicts, blocks retries and resolves them explicitly", async () => {
    const database = new MemoryDatabase();
    const repository = new FakeRepository();
    const base = "---\ntitle: Multi-device\n---\n\nBase\n";
    repository.snapshotValue.articles = [
      { path: "content/multi.md", source: base },
    ];
    const app = createApp(appOptions(database, repository));
    await app(
      request("/api/repository/sync", {
        method: "POST",
        headers: ADMIN_HEADERS,
      }),
    );
    const article = (await database.getArticleByPath("content/multi.md"))!;
    const cms = "---\ntitle: Multi-device\n---\n\nCMS\n";
    const saved = await payload(
      await app(
        request(`/api/articles/${article.id}/draft`, {
          method: "PUT",
          headers: ADMIN_HEADERS,
          body: JSON.stringify({ source: cms, version: 0 }),
        }),
      ),
    );
    const remote = "---\ntitle: Multi-device\n---\n\nRemote\n";
    repository.publishError = new RepositoryContentConflictError({
      kind: "edit_edit",
      remotePath: article.path,
      remoteSource: remote,
      remoteContentHash: await sha256Text(remote),
      remoteCommitSha: "2222222222222222222222222222222222222222",
    });
    const rejected = await app(
      request(`/api/articles/${article.id}/publish`, {
        method: "POST",
        headers: ADMIN_HEADERS,
        body: JSON.stringify({
          version: saved.article.version,
          mode: "direct",
        }),
      }),
    );
    assert.equal(rejected.status, 409);
    const conflicts = (
      await payload(
        await app(request("/api/conflicts", { headers: ADMIN_HEADERS })),
      )
    ).data;
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].baseSource, base);
    assert.equal(conflicts[0].remoteSource, remote);
    assert.equal(conflicts[0].draftSource, cms);

    repository.publishError = null;
    repository.publishResult = {
      mode: "direct",
      status: "published",
      commitSha: "3333333333333333333333333333333333333333",
      branch: "main",
    };
    const resolved = await app(
      request(`/api/conflicts/${conflicts[0].id}/resolve`, {
        method: "POST",
        headers: ADMIN_HEADERS,
        body: JSON.stringify({ resolution: "cms" }),
      }),
    );
    assert.equal(resolved.status, 200);
    assert.equal((await payload(resolved)).data.source, cms);
    assert.equal((await database.listContentConflicts()).length, 0);
  });

  it("keeps both edits when two devices save the same CMS draft version", async () => {
    const database = new MemoryDatabase();
    const repository = new FakeRepository();
    const base = "---\ntitle: Two devices\n---\n\nBase\n";
    repository.snapshotValue.articles = [
      { path: "content/devices.md", source: base },
    ];
    const app = createApp(appOptions(database, repository));
    await app(
      request("/api/repository/sync", {
        method: "POST",
        headers: ADMIN_HEADERS,
      }),
    );
    const article = (await database.getArticleByPath("content/devices.md"))!;
    const computerA = `${base}\nComputer A`;
    const computerB = `${base}\nComputer B`;
    await app(
      request(`/api/articles/${article.id}/draft`, {
        method: "PUT",
        headers: ADMIN_HEADERS,
        body: JSON.stringify({ source: computerA, version: 0 }),
      }),
    );
    const stale = await app(
      request(`/api/articles/${article.id}/draft`, {
        method: "PUT",
        headers: ADMIN_HEADERS,
        body: JSON.stringify({ source: computerB, version: 0 }),
      }),
    );
    assert.equal(stale.status, 409);
    const savedConflict = await database.getOpenContentConflictByArticle(
      article.id,
    );
    assert.equal(savedConflict?.remoteSource, computerA);
    assert.equal(savedConflict?.draftSource, computerB);
    assert.equal(savedConflict?.remoteCommitSha, "cms-draft-v1");
  });

  it("removes the old push/import/callback protocol and rejects invalid snapshots", async () => {
    const repository = new FakeRepository();
    const app = createApp(appOptions(new MemoryDatabase(), repository));
    for (const path of [
      "/api/internal/content/import",
      "/api/internal/publications/old/export",
      "/api/internal/publications/old/complete",
    ]) {
      const response = await app(
        request(path, {
          method: path.endsWith("export") ? "GET" : "POST",
          headers: ADMIN_HEADERS,
        }),
      );
      assert.equal(response.status, 404);
    }

    repository.snapshotValue.articles = [
      {
        path: "../unsafe.md",
        source: "unsafe",
      },
    ];
    const invalid = await app(
      request("/api/repository/sync", {
        method: "POST",
        headers: ADMIN_HEADERS,
      }),
    );
    assert.equal(invalid.status, 400);

    repository.snapshotValue.articles = [
      {
        path: "content/hash.md",
        source: "hello",
        contentHash: await sha256Text("different"),
      },
    ];
    const invalidHash = await app(
      request("/api/repository/sync", {
        method: "POST",
        headers: ADMIN_HEADERS,
      }),
    );
    assert.equal(invalidHash.status, 502);
  });

  it("continues to match the web CmsApiClient contract", async () => {
    const app = createApp(appOptions());
    const client = new FetchCmsApiClient({
      baseUrl: "https://studio.example/api",
      token: "admin-secret",
      fetch: ((input: URL | RequestInfo, init?: RequestInit) =>
        app(new Request(input, init))) as typeof globalThis.fetch,
    });
    const source = "---\ntitle: From web\ntags: [ui]\n---\n\nHello\n";
    const created = await client.createArticle({
      path: "content/from-web.md",
      format: "md",
      source,
    });
    assert.equal(created.metadata.title, "From web");
    assert.equal(created.syncStatus, "unpublished");
    assert.equal((await client.listArticles()).length, 1);
    assert.equal((await client.getArticle(created.id)).source, source);

    const editedSource =
      "---\ntitle: From web\ntags: [ui]\n---\n\nHello again\n";
    const saved = await client.saveDraft({
      id: created.id,
      path: created.path,
      source: editedSource,
      version: created.version,
    });
    assert.equal(saved.article.syncStatus, "unpublished");
    assert.equal((await client.listArticles()).length, 1);
    const revisions = await client.listArticleRevisions(created.id);
    assert.deepEqual(
      revisions.map((revision) => revision.kind),
      ["autosave", "create"],
    );
    const restored = await client.restoreArticleRevision(
      created.id,
      revisions.find((revision) => revision.kind === "create")!.id,
      saved.article.version,
    );
    assert.equal(restored.source, source);
    assert.equal(restored.syncStatus, "unpublished");
  });

  it("tests a Gitee connection without overwriting saved settings", async () => {
    const database = new MemoryDatabase();
    const tested: UpdateRepositoryConnectionInput[] = [];
    let updateCalls = 0;
    const app = createApp({
      ...appOptions(database),
      repositorySettings: {
        async get() {
          return {
            provider: "github", owner: "echoes", repository: "site", branch: "main",
            contentRoot: "src/content", filesystemPath: "", tokenConfigured: true, updatedAt: null,
          };
        },
        async update(input) {
          updateCalls += 1;
          return {
            provider: input.provider, owner: input.owner ?? "", repository: input.repository ?? "",
            branch: input.branch ?? "master", contentRoot: input.contentRoot,
            filesystemPath: input.filesystemPath ?? "", tokenConfigured: Boolean(input.token), updatedAt: null,
          };
        },
        async test(input) {
          tested.push(input);
          return {
            ok: true, provider: input.provider, branch: "master", headCommit: "b".repeat(40),
            checkedAt: "2026-08-13T12:00:00.000Z", message: "连接成功，已读取 master 分支",
          };
        },
      },
    });
    const response = await app(request("/api/settings/repository/test", {
      method: "POST",
      headers: ADMIN_HEADERS,
      body: JSON.stringify({
        provider: "gitee", owner: "echoes", repository: "site", branch: "",
        contentRoot: "src/content", token: "gitee-token",
      }),
    }));
    assert.equal(response.status, 200);
    assert.equal((await payload(response)).data.provider, "gitee");
    assert.equal(tested[0]?.token, "gitee-token");
    assert.equal(updateCalls, 0);
  });
});
