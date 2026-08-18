import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createGiteeRepository } from "../../src/runtime/gitee-repository";
import { sha256Text } from "../../src/core/hash";

interface Route {
  method?: string;
  path: string | RegExp;
  status?: number;
  body: unknown;
  inspect?: (init: RequestInit, headers: Headers) => void;
}

function mockFetch(routes: Route[]) {
  const pending = [...routes];
  const fetch = (async (input: URL | RequestInfo, init: RequestInit = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = (init.method ?? "GET").toUpperCase();
    const requestPath = `${url.pathname.replace(/^\/api\/v5/, "")}${url.search}`;
    const index = pending.findIndex((route) =>
      (route.method ?? "GET").toUpperCase() === method &&
      (typeof route.path === "string"
        ? requestPath === route.path
        : route.path.test(requestPath)),
    );
    assert.notEqual(index, -1, `Unexpected Gitee request: ${method} ${url.pathname}${url.search}`);
    const [route] = pending.splice(index, 1);
    const headers = new Headers(init.headers);
    route!.inspect?.(init, headers);
    return new Response(JSON.stringify(route!.body), {
      status: route!.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof globalThis.fetch;
  return {
    fetch,
    done: () => assert.deepEqual(pending.map((route) => `${route.method ?? "GET"} ${route.path}`), []),
  };
}

function encoded(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

describe("GiteeRepositoryPort", () => {
  it("detects the default branch and snapshots Markdown articles", async () => {
    const source = "---\ntitle: Gitee\n---\n\nHello\n";
    const mock = mockFetch([
      { path: "/repos/echoes/site", body: { default_branch: "master" } },
      { path: "/repos/echoes/site/branches/master", body: { commit: { sha: "head-1" } } },
      {
        path: "/repos/echoes/site/git/trees/head-1?recursive=1",
        body: { tree: [
          { path: "src/content/post.md", type: "blob", sha: "blob-1", size: 32 },
          { path: "README.md", type: "blob", sha: "readme" },
        ] },
      },
      {
        path: "/repos/echoes/site/git/blobs/blob-1",
        body: { content: encoded(source), encoding: "base64", size: 32 },
        inspect: (_init, headers) => assert.equal(headers.get("authorization"), "Bearer gitee-token"),
      },
    ]);
    const repository = createGiteeRepository({
      owner: "echoes",
      repository: "site",
      token: async () => "gitee-token",
      fetch: mock.fetch,
    });
    assert.deepEqual(await repository.snapshot(), {
      repositoryId: "gitee:echoes/site",
      branch: "master",
      headCommit: "head-1",
      articles: [{ path: "src/content/post.md", source, format: "md" }],
    });
    mock.done();
  });

  it("publishes multiple articles through one Gitee commit", async () => {
    const first = "# First\n";
    const second = "# Second\n";
    const mock = mockFetch([
      { path: "/repos/echoes/site/branches/master", body: { commit: { sha: "base-head" } } },
      { path: "/repos/echoes/site/contents/src/content/first.md?ref=base-head", status: 404, body: { message: "Not Found" } },
      { path: "/repos/echoes/site/contents/src/content/second.md?ref=base-head", status: 404, body: { message: "Not Found" } },
      { path: "/repos/echoes/site/branches/master", body: { commit: { sha: "base-head" } } },
      { path: "/repos/echoes/site/contents/src/content/first.md?ref=base-head", status: 404, body: { message: "Not Found" } },
      { path: "/repos/echoes/site/contents/src/content/second.md?ref=base-head", status: 404, body: { message: "Not Found" } },
      {
        method: "POST",
        path: "/repos/echoes/site/commits",
        body: { sha: "batch-commit" },
        inspect: (init, headers) => {
          assert.equal(headers.get("authorization"), "Bearer gitee-token");
          assert.deepEqual(JSON.parse(String(init.body)), {
            branch: "master",
            commit_message: "更新两篇文章",
            actions: [
              { action: "create", file_path: "src/content/first.md", content: first },
              { action: "create", file_path: "src/content/second.md", content: second },
            ],
          });
        },
      },
    ]);
    const repository = createGiteeRepository({
      owner: "echoes", repository: "site", branch: "master",
      token: async () => "gitee-token", fetch: mock.fetch,
    });
    const result = await repository.publishBatch({
      batchId: "batch-1",
      mode: "direct",
      commitMessage: "更新两篇文章",
      changes: [
        {
          operation: "upsert", publicationId: "first", path: "src/content/first.md",
          source: first, contentHash: await sha256Text(first), basePath: null, baseContentHash: null,
        },
        {
          operation: "upsert", publicationId: "second", path: "src/content/second.md",
          source: second, contentHash: await sha256Text(second), basePath: null, baseContentHash: null,
        },
      ],
    });
    assert.deepEqual(result, {
      mode: "direct", status: "published", commitSha: "batch-commit", branch: "master",
    });
    mock.done();
  });
});
