import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { after, before, describe, it } from "node:test";

import { createLocalFilesystemRepository } from "../../src/runtime/local-filesystem-repository";
import { sha256Text } from "../../src/core/hash";

describe("LocalFilesystemRepository", () => {
  let root = "";

  before(async () => {
    root = await mkdtemp(resolve(tmpdir(), "echoes-studio-local-"));
    await mkdir(resolve(root, "src/content/nested"), { recursive: true });
    await writeFile(resolve(root, "src/content/alpha.md"), "---\ntitle: Alpha\n---\n\nBefore\n");
    await writeFile(resolve(root, "src/content/nested/component.mdx"), "---\ntitle: MDX\n---\n\n<X />\n");
    await writeFile(resolve(root, "src/content/ignored.txt"), "ignored");
  });

  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("snapshots Markdown files and safely writes a publication", async () => {
    const repository = await createLocalFilesystemRepository({ rootPath: root });
    const before = await repository.snapshot();
    assert.equal(before.articles.length, 2);
    assert.deepEqual(before.articles.map((article) => article.path), [
      "src/content/alpha.md",
      "src/content/nested/component.mdx",
    ]);
    assert.match(before.headCommit, /^[0-9a-f]{64}$/);
    const status = await repository.status();
    assert.equal(status.provider, "filesystem");
    assert.equal(status.contentRoot, "src/content");

    const source = "---\ntitle: Alpha\n---\n\nAfter\n";
    const result = await repository.publish({
      publicationId: "local-1",
      path: "src/content/alpha.md",
      source,
      contentHash: "unused-by-filesystem-adapter",
      mode: "pull-request",
      expectedHeadCommit: before.headCommit,
    });
    assert.equal(result.status, "published");
    assert.equal(result.mode, "pull-request");
    assert.equal(result.branch, "local");
    assert.equal(await readFile(resolve(root, "src/content/alpha.md"), "utf8"), source);
    assert.notEqual(result.commitSha, before.headCommit);
  });

  it("rejects stale snapshots and paths outside the configured content root", async () => {
    const repository = await createLocalFilesystemRepository({ rootPath: root });
    await assert.rejects(repository.publish({
      publicationId: "local-2",
      path: "src/content/new.md",
      source: "new",
      contentHash: "unused",
      mode: "direct",
      expectedHeadCommit: "0".repeat(64),
    }), /changed/);
    await assert.rejects(repository.publish({
      publicationId: "local-3",
      path: "outside.md",
      source: "unsafe",
      contentHash: "unused",
      mode: "direct",
    }), /inside src\/content/);
  });

  it("moves a publication by writing the target and removing the baseline path", async () => {
    const repository = await createLocalFilesystemRepository({ rootPath: root });
    const before = await repository.snapshot();
    const source = "---\ntitle: Moved\n---\n\nMoved content\n";
    await repository.publish({
      publicationId: "local-move",
      previousPath: "src/content/alpha.md",
      path: "src/content/guides/alpha.md",
      source,
      contentHash: "unused",
      mode: "direct",
      expectedHeadCommit: before.headCommit,
    });
    assert.equal(await readFile(resolve(root, "src/content/guides/alpha.md"), "utf8"), source);
    await assert.rejects(access(resolve(root, "src/content/alpha.md")));
  });

  it("allows unrelated repository changes but rejects a second edit to the same article", async () => {
    const repository = await createLocalFilesystemRepository({ rootPath: root });
    const before = await repository.snapshot();
    const alpha = before.articles.find((article) => article.path === "src/content/nested/component.mdx")!;
    await writeFile(resolve(root, "src/content/unrelated.md"), "---\ntitle: Other\n---\n\nChanged elsewhere\n");
    const cmsSource = "---\ntitle: MDX\n---\n\n<Safe />\n";
    await repository.publish({
      publicationId: "unrelated-safe", path: alpha.path, source: cmsSource,
      contentHash: await sha256Text(cmsSource), mode: "direct",
      basePath: alpha.path, baseContentHash: await sha256Text(alpha.source),
      expectedHeadCommit: before.headCommit,
    });
    assert.equal(await readFile(resolve(root, alpha.path), "utf8"), cmsSource);

    const next = await repository.snapshot();
    const baseline = next.articles.find((article) => article.path === alpha.path)!;
    await writeFile(resolve(root, alpha.path), "---\ntitle: MDX\n---\n\n<ComputerA />\n");
    await assert.rejects(repository.publish({
      publicationId: "same-article-conflict", path: alpha.path,
      source: "---\ntitle: MDX\n---\n\n<ComputerB />\n",
      contentHash: "draft", mode: "direct", basePath: alpha.path,
      baseContentHash: await sha256Text(baseline.source), expectedHeadCommit: next.headCommit,
    }), /both changed|diverged|Repository content changed/i);
  });

  it("writes multiple selected articles through one batch operation", async () => {
    const repository = await createLocalFilesystemRepository({ rootPath: root });
    const before = await repository.snapshot();
    const firstSource = "---\ntitle: Batch first\n---\n\nFirst\n";
    const secondSource = "---\ntitle: Batch second\n---\n\nSecond\n";
    const result = await repository.publishBatch({
      batchId: "local-batch",
      mode: "direct",
      commitMessage: "本地批量写入",
      changes: [
        {
          operation: "upsert", publicationId: "local-batch-1",
          path: "src/content/batch/first.md", source: firstSource,
          contentHash: await sha256Text(firstSource), basePath: null, baseContentHash: null,
        },
        {
          operation: "upsert", publicationId: "local-batch-2",
          path: "src/content/batch/second.md", source: secondSource,
          contentHash: await sha256Text(secondSource), basePath: null, baseContentHash: null,
        },
      ],
    });
    assert.equal(await readFile(resolve(root, "src/content/batch/first.md"), "utf8"), firstSource);
    assert.equal(await readFile(resolve(root, "src/content/batch/second.md"), "utf8"), secondSource);
    assert.notEqual(result.commitSha, before.headCommit);
  });
});
