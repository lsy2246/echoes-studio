import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createGitHubRepository } from "../../src/runtime/github-repository";
import type { RepositoryPublishRequest } from "../../src/core/git-repository-port";
import { sha256Text } from "../../src/core/hash";

type RequestMatcher = string | RegExp | ((url: URL) => boolean);

interface MockRoute {
  method?: string;
  path: RequestMatcher;
  status?: number;
  body: unknown;
  inspect?: (request: { url: URL; init: RequestInit; headers: Headers }) => void;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createMockFetch(routes: MockRoute[]) {
  const pending = [...routes];
  const requests: Array<{ method: string; url: URL; init: RequestInit; headers: Headers }> = [];

  const fetch = (async (input: URL | RequestInfo, init: RequestInit = {}) => {
    const sourceRequest = input instanceof Request ? input : null;
    const url = new URL(
      input instanceof URL ? input.href : sourceRequest ? sourceRequest.url : String(input),
    );
    const method = (init.method ?? sourceRequest?.method ?? "GET").toUpperCase();
    const headers = new Headers(init.headers ?? sourceRequest?.headers);
    const index = pending.findIndex((route) => {
      if ((route.method ?? "GET").toUpperCase() !== method) return false;
      if (typeof route.path === "string") return `${url.pathname}${url.search}` === route.path;
      if (route.path instanceof RegExp) return route.path.test(`${url.pathname}${url.search}`);
      return route.path(url);
    });
    assert.notEqual(
      index,
      -1,
      `Unexpected GitHub request: ${method} ${url.pathname}${url.search}`,
    );
    const [route] = pending.splice(index, 1);
    requests.push({ method, url, init, headers });
    route!.inspect?.({ url, init, headers });
    return jsonResponse(route!.body, route!.status);
  }) as typeof globalThis.fetch;

  return {
    fetch,
    requests,
    assertDone() {
      assert.deepEqual(
        pending.map((route) => `${route.method ?? "GET"} ${String(route.path)}`),
        [],
        "Expected every mocked GitHub request to be consumed",
      );
    },
  };
}

function encoded(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

function publishRequest(overrides: Partial<RepositoryPublishRequest> = {}): RepositoryPublishRequest {
  return {
    publicationId: "Publication 42",
    path: "src/content/post.md",
    source: "---\ntitle: Post\n---\n\nHello\n",
    contentHash: "content-sha-256",
    mode: "pull-request",
    expectedHeadCommit: "base-head",
    ...overrides,
  };
}

describe("GitHubRepositoryPort", () => {
  it("reads the real commit history and file contents for an article", async () => {
    const first = "# First\n";
    const second = "# Second\n";
    const mock = createMockFetch([
      { path: "/repos/echoes/site", body: { default_branch: "main" } },
      {
        path: "/repos/echoes/site/commits?sha=main&path=src/content/post.md&per_page=2",
        body: [
          { sha: "a".repeat(40), commit: { author: { date: "2026-08-13T10:00:00Z" }, message: "更新文章\n\n补充正文" } },
          { sha: "b".repeat(40), commit: { author: { date: "2026-08-12T10:00:00Z" }, message: "创建文章" } },
        ],
      },
      { path: `/repos/echoes/site/contents/src/content/post.md?ref=${"a".repeat(40)}`, body: { encoding: "base64", content: encoded(first) } },
      { path: `/repos/echoes/site/contents/src/content/post.md?ref=${"b".repeat(40)}`, body: { encoding: "base64", content: encoded(second) } },
    ]);
    const repository = createGitHubRepository({ owner: "echoes", repository: "site", fetch: mock.fetch });
    const history = await repository.history!("src/content/post.md", 2);
    assert.deepEqual(history.map(({ commitSha, commitMessage, source }) => ({ commitSha, commitMessage, source })), [
      { commitSha: "a".repeat(40), commitMessage: "更新文章", source: first },
      { commitSha: "b".repeat(40), commitMessage: "创建文章", source: second },
    ]);
    mock.assertDone();
  });

  it("actively snapshots the default branch, recursive tree and Markdown blobs", async () => {
    const markdown = "---\ntitle: Alpha\n---\n\nA\n";
    const mdx = "---\ntitle: Zed\n---\n\n<Component />\n";
    const mock = createMockFetch([
      {
        path: "/repos/echoes/site",
        body: { default_branch: "main" },
      },
      {
        path: "/repos/echoes/site/git/ref/heads/main",
        body: { object: { sha: "head-1" } },
      },
      {
        path: "/repos/echoes/site/git/commits/head-1",
        body: { sha: "head-1", tree: { sha: "tree-1" } },
      },
      {
        path: "/repos/echoes/site/git/trees/tree-1",
        body: {
          truncated: false,
          tree: [{ path: "src", type: "tree", sha: "tree-src" }],
        },
      },
      {
        path: "/repos/echoes/site/git/trees/tree-src",
        body: {
          truncated: false,
          tree: [{ path: "content", type: "tree", sha: "tree-content" }],
        },
      },
      {
        path: "/repos/echoes/site/git/trees/tree-content?recursive=1",
        body: {
          truncated: false,
          tree: [
            { path: "z.mdx", type: "blob", sha: "blob-z", size: 40 },
            { path: "note.txt", type: "blob", sha: "note" },
            { path: "a.md", type: "blob", sha: "blob-a", size: 30 },
            { path: "nested", type: "tree", sha: "nested" },
          ],
        },
      },
      {
        path: "/repos/echoes/site/git/blobs/blob-a",
        body: { encoding: "base64", content: encoded(markdown), size: Buffer.byteLength(markdown) },
      },
      {
        path: "/repos/echoes/site/git/blobs/blob-z",
        body: { encoding: "base64", content: encoded(mdx), size: Buffer.byteLength(mdx) },
      },
    ]);
    const repository = createGitHubRepository({
      owner: "echoes",
      repository: "site",
      fetch: mock.fetch,
      token: async () => "read-token",
      now: () => new Date("2026-08-13T10:11:12.000Z"),
      blobConcurrency: 2,
    });

    const snapshot = await repository.snapshot();

    assert.deepEqual(snapshot, {
      repositoryId: "github:echoes/site",
      branch: "main",
      headCommit: "head-1",
      articles: [
        { path: "src/content/a.md", source: markdown, format: "md" },
        { path: "src/content/z.mdx", source: mdx, format: "mdx" },
      ],
    });
    assert.ok(mock.requests.every((request) => request.headers.get("authorization") === "Bearer read-token"));
    assert.ok(mock.requests.every((request) => request.headers.get("x-github-api-version") === "2022-11-28"));
    mock.assertDone();
  });

  it("publishes through a new branch, Contents API update and pull request", async () => {
    const input = publishRequest({ previousPath: "src/content/archive/post.md" });
    const branch = "echoes-studio/publication-42";
    const mock = createMockFetch([
      {
        path: "/repos/echoes/site/git/ref/heads/main",
        body: { object: { sha: "base-head" } },
      },
      {
        path: (url) =>
          url.pathname === "/repos/echoes/site/contents/src/content/post.md"
          && url.searchParams.get("ref") === "base-head",
        status: 404,
        body: { message: "Not Found" },
      },
      {
        path: `/repos/echoes/site/git/ref/heads/${branch}`,
        status: 404,
        body: { message: "Not Found" },
      },
      {
        method: "POST",
        path: "/repos/echoes/site/git/refs",
        body: { ref: `refs/heads/${branch}`, object: { sha: "base-head" } },
        inspect: ({ init, headers }) => {
          assert.equal(headers.get("authorization"), "Bearer write-token");
          assert.deepEqual(JSON.parse(String(init.body)), {
            ref: `refs/heads/${branch}`,
            sha: "base-head",
          });
        },
      },
      {
        path: (url) =>
          url.pathname === "/repos/echoes/site/contents/src/content/post.md"
          && url.searchParams.get("ref") === branch,
        status: 404,
        body: { message: "Not Found" },
      },
      {
        method: "PUT",
        path: "/repos/echoes/site/contents/src/content/post.md",
        body: { commit: { sha: "publication-commit" }, content: { sha: "blob-new" } },
        inspect: ({ init }) => {
          const body = JSON.parse(String(init.body));
          assert.equal(body.branch, branch);
          assert.equal(Buffer.from(body.content, "base64").toString("utf8"), input.source);
          assert.equal(body.sha, undefined);
        },
      },
      {
        path: (url) =>
          url.pathname === "/repos/echoes/site/contents/src/content/archive/post.md"
          && url.searchParams.get("ref") === branch,
        body: { sha: "old-path-blob", encoding: "base64", content: encoded(input.source) },
      },
      {
        method: "DELETE",
        path: "/repos/echoes/site/contents/src/content/archive/post.md",
        body: { commit: { sha: "move-delete-commit" } },
        inspect: ({ init }) => {
          assert.deepEqual(JSON.parse(String(init.body)), {
            message: "content: move src/content/archive/post.md via Echoes Studio",
            sha: "old-path-blob",
            branch,
          });
        },
      },
      {
        method: "POST",
        path: "/repos/echoes/site/pulls",
        body: { html_url: "https://github.com/echoes/site/pull/42" },
        inspect: ({ init }) => {
          const body = JSON.parse(String(init.body));
          assert.equal(body.head, branch);
          assert.equal(body.base, "main");
          assert.match(body.body, /Publication 42/);
          assert.match(body.body, /content-sha-256/);
        },
      },
    ]);
    const repository = createGitHubRepository({
      owner: "echoes",
      repository: "site",
      branch: "main",
      fetch: mock.fetch,
      token: async () => "write-token",
    });

    const result = await repository.publish(input);

    assert.deepEqual(result, {
      mode: "pull-request",
      status: "pending",
      commitSha: "move-delete-commit",
      pullRequestUrl: "https://github.com/echoes/site/pull/42",
      branch,
    });
    mock.assertDone();
  });

  it("publishes directly with an atomic Git ref compare-and-swap", async () => {
    const input = publishRequest({
      mode: "direct",
      source: "Updated article\n",
      commitMessage: "更新：文章发布说明",
    });
    const mock = createMockFetch([
      {
        path: "/repos/echoes/site/git/ref/heads/release",
        body: { object: { sha: "base-head" } },
      },
      {
        path: (url) =>
          url.pathname === "/repos/echoes/site/contents/src/content/post.md"
          && url.searchParams.get("ref") === "base-head",
        body: { sha: "old-blob", encoding: "base64", content: encoded("Old article\n") },
      },
      {
        method: "POST",
        path: "/repos/echoes/site/git/blobs",
        body: { sha: "new-blob" },
        inspect: ({ init }) => {
          const body = JSON.parse(String(init.body));
          assert.equal(body.encoding, "utf-8");
          assert.equal(body.content, input.source);
        },
      },
      {
        path: "/repos/echoes/site/git/commits/base-head",
        body: { sha: "base-head", tree: { sha: "base-tree" } },
      },
      {
        method: "POST",
        path: "/repos/echoes/site/git/trees",
        body: { sha: "next-tree" },
        inspect: ({ init }) => {
          assert.deepEqual(JSON.parse(String(init.body)), {
            base_tree: "base-tree",
            tree: [{ path: input.path, mode: "100644", type: "blob", sha: "new-blob" }],
          });
        },
      },
      {
        method: "POST",
        path: "/repos/echoes/site/git/commits",
        body: { sha: "direct-commit" },
        inspect: ({ init }) => {
          const body = JSON.parse(String(init.body));
          assert.equal(body.tree, "next-tree");
          assert.deepEqual(body.parents, ["base-head"]);
          assert.equal(body.message, "更新：文章发布说明");
        },
      },
      {
        method: "PATCH",
        path: "/repos/echoes/site/git/refs/heads/release",
        body: { object: { sha: "direct-commit" } },
        inspect: ({ init }) => {
          assert.deepEqual(JSON.parse(String(init.body)), { sha: "direct-commit", force: false });
        },
      },
    ]);
    const repository = createGitHubRepository({
      owner: "echoes",
      repository: "site",
      branch: "release",
      writeMode: "direct",
      fetch: mock.fetch,
      token: async () => "write-token",
    });

    const result = await repository.publish(input);

    assert.deepEqual(result, {
      mode: "direct",
      status: "published",
      commitSha: "direct-commit",
      branch: "release",
    });
    mock.assertDone();
  });

  it("publishes multiple article changes as one Git commit", async () => {
    const firstBefore = "---\ntitle: First\n---\n\nBefore\n";
    const firstAfter = "---\ntitle: First\n---\n\nAfter\n";
    const secondAfter = "---\ntitle: Second\n---\n\nNew\n";
    const mock = createMockFetch([
      { path: "/repos/echoes/site/git/ref/heads/main", body: { object: { sha: "batch-base" } } },
      {
        path: "/repos/echoes/site/contents/src/content/first.md?ref=batch-base",
        body: { sha: "first-old", encoding: "base64", content: encoded(firstBefore) },
      },
      {
        path: "/repos/echoes/site/contents/src/content/second.md?ref=batch-base",
        status: 404,
        body: { message: "Not Found" },
      },
      { method: "POST", path: "/repos/echoes/site/git/blobs", body: { sha: "first-new" } },
      { method: "POST", path: "/repos/echoes/site/git/blobs", body: { sha: "second-new" } },
      {
        path: "/repos/echoes/site/git/commits/batch-base",
        body: { sha: "batch-base", tree: { sha: "batch-tree" } },
      },
      {
        method: "POST",
        path: "/repos/echoes/site/git/trees",
        body: { sha: "batch-next-tree" },
        inspect: ({ init }) => {
          assert.deepEqual(JSON.parse(String(init.body)), {
            base_tree: "batch-tree",
            tree: [
              { path: "src/content/first.md", mode: "100644", type: "blob", sha: "first-new" },
              { path: "src/content/second.md", mode: "100644", type: "blob", sha: "second-new" },
            ],
          });
        },
      },
      {
        method: "POST",
        path: "/repos/echoes/site/git/commits",
        body: { sha: "batch-commit" },
        inspect: ({ init }) => {
          const body = JSON.parse(String(init.body));
          assert.equal(body.message, "更新内容：两篇文章");
          assert.deepEqual(body.parents, ["batch-base"]);
          assert.equal(body.tree, "batch-next-tree");
        },
      },
      {
        method: "PATCH",
        path: "/repos/echoes/site/git/refs/heads/main",
        body: { object: { sha: "batch-commit" } },
      },
    ]);
    const repository = createGitHubRepository({
      owner: "echoes", repository: "site", branch: "main",
      fetch: mock.fetch, token: async () => "write-token",
    });
    const result = await repository.publishBatch({
      batchId: "batch-1",
      mode: "direct",
      commitMessage: "更新内容：两篇文章",
      changes: [
        {
          operation: "upsert", publicationId: "publication-1",
          path: "src/content/first.md", source: firstAfter,
          contentHash: await sha256Text(firstAfter), basePath: "src/content/first.md",
          baseContentHash: await sha256Text(firstBefore),
        },
        {
          operation: "upsert", publicationId: "publication-2",
          path: "src/content/second.md", source: secondAfter,
          contentHash: await sha256Text(secondAfter), basePath: null, baseContentHash: null,
        },
      ],
    });
    assert.deepEqual(result, {
      mode: "direct", status: "published", commitSha: "batch-commit", branch: "main",
    });
    mock.assertDone();
  });

  it("rejects an unexpected repository head and paths outside the content root", async () => {
    const conflictMock = createMockFetch([
      {
        path: "/repos/echoes/site/git/ref/heads/main",
        body: { object: { sha: "newer-head" } },
      },
    ]);
    const repository = createGitHubRepository({
      owner: "echoes",
      repository: "site",
      branch: "main",
      fetch: conflictMock.fetch,
      token: async () => "write-token",
    });

    await assert.rejects(
      repository.publish(publishRequest()),
      /repository changed after the draft was created/i,
    );
    conflictMock.assertDone();

    const noFetch = (async () => {
      assert.fail("Path validation must happen before a GitHub request");
    }) as typeof globalThis.fetch;
    const pathRepository = createGitHubRepository({
      owner: "echoes",
      repository: "site",
      branch: "main",
      fetch: noFetch,
      token: async () => "write-token",
    });
    for (const path of [
      "src/content/../outside.md",
      "src/content/post.txt",
      "src/content\\post.md",
      "src/content-other/post.md",
    ]) {
      await assert.rejects(
        pathRepository.publish(publishRequest({ path, expectedHeadCommit: undefined })),
        /Markdown file inside src\/content/,
      );
    }
  });

  it("finds an existing open pull request after GitHub returns 422", async () => {
    const input = publishRequest({ publicationId: "Retry" });
    const branch = "echoes-studio/retry";
    const mock = createMockFetch([
      {
        path: "/repos/echoes/site/git/ref/heads/main",
        body: { object: { sha: "base-head" } },
      },
      {
        path: (url) =>
          url.pathname === "/repos/echoes/site/contents/src/content/post.md"
          && url.searchParams.get("ref") === "base-head",
        body: { sha: "base-blob", encoding: "base64", content: encoded("Base\n") },
      },
      {
        path: `/repos/echoes/site/git/ref/heads/${branch}`,
        body: { object: { sha: "old-branch-head" } },
      },
      {
        path: (url) =>
          url.pathname === "/repos/echoes/site/contents/src/content/post.md"
          && url.searchParams.get("ref") === branch,
        body: { sha: "old-blob", encoding: "base64", content: encoded("Old\n") },
      },
      {
        method: "PUT",
        path: "/repos/echoes/site/contents/src/content/post.md",
        body: { commit: { sha: "retry-commit" } },
      },
      {
        method: "POST",
        path: "/repos/echoes/site/pulls",
        status: 422,
        body: { message: "A pull request already exists" },
      },
      {
        path: (url) =>
          url.pathname === "/repos/echoes/site/pulls"
          && url.searchParams.get("state") === "open"
          && url.searchParams.get("head") === `echoes:${branch}`
          && url.searchParams.get("base") === "main",
        body: [{ html_url: "https://github.com/echoes/site/pull/7" }],
      },
    ]);
    const repository = createGitHubRepository({
      owner: "echoes",
      repository: "site",
      branch: "main",
      fetch: mock.fetch,
      token: async () => "write-token",
    });

    const result = await repository.publish(input);

    assert.equal(result.pullRequestUrl, "https://github.com/echoes/site/pull/7");
    assert.equal(result.commitSha, "retry-commit");
    assert.equal(result.status, "pending");
    assert.equal(
      mock.requests.filter((request) => request.method === "POST" && request.url.pathname.endsWith("/git/refs")).length,
      0,
    );
    mock.assertDone();
  });
});
