import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseFrontmatter } from "../../src/core/frontmatter";
import { sha256Text, stableHash, stableStringify } from "../../src/core/hash";
import { hashPassword, verifyPassword } from "../../src/core/password";
import { MemoryDatabase } from "../../src/database/memory";

describe("portable content primitives", () => {
  it("uses canonical object key ordering for stable hashes", async () => {
    const left = { z: [3, 2, 1], a: { beta: true, alpha: "x" } };
    const right = { a: { alpha: "x", beta: true }, z: [3, 2, 1] };
    assert.equal(stableStringify(left), stableStringify(right));
    assert.equal(await stableHash(left), await stableHash(right));
    assert.equal(
      await sha256Text("abc"),
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("uses the configured password hash cost without accepting another cost", async () => {
    const encoded = await hashPassword("correct horse battery staple", 150_000);
    assert.equal(await verifyPassword("correct horse battery staple", encoded, 150_000), true);
    assert.equal(await verifyPassword("correct horse battery staple", encoded, 100_000), false);
  });

  it("parses safe frontmatter while preserving the body byte layout", () => {
    const source = [
      "---\r\n",
      "title: 'Stable'\r\n",
      "tags:\r\n",
      "  - cms\r\n",
      "  - markdown\r\n",
      "summary: >-\r\n",
      "  one\r\n",
      "  two\r\n",
      "---\r\n",
      "Body\r\n\r\n",
    ].join("");
    const parsed = parseFrontmatter(source);
    assert.equal(parsed.hasFrontmatter, true);
    assert.equal(parsed.frontmatter.title, "Stable");
    assert.deepEqual(parsed.frontmatter.tags, ["cms", "markdown"]);
    assert.equal(parsed.frontmatter.summary, "one two");
    assert.equal(parsed.body, "Body\r\n\r\n");
  });

  it("reports a three-way conflict only when Git and the draft diverge from the base", async () => {
    const database = new MemoryDatabase();
    const base = "base";
    const draftSource = "local";
    const article = await database.createArticle({
      id: "conflict-article",
      path: "content/conflict.md",
      format: "md",
      title: "Conflict",
      frontmatter: {},
      source: base,
      contentHash: await sha256Text(base),
      gitCommitSha: "aaaaaaa",
      now: "2026-08-13T00:00:00.000Z",
    });
    await database.upsertDraft({
      articleId: article.id,
      basePath: article.path,
      expectedVersion: null,
      source: draftSource,
      contentHash: await sha256Text(draftSource),
      baseContentHash: article.contentHash,
      baseSource: article.source,
      now: "2026-08-13T00:01:00.000Z",
    });
    const remote = "remote";
    const result = await database.importBatch({
      checkpointId: "conflict-delivery",
      commitSha: "bbbbbbb",
      articles: [{
        path: article.path,
        format: "md",
        title: "Conflict",
        frontmatter: {},
        source: remote,
        contentHash: await sha256Text(remote),
      }],
      deletedPaths: [],
      now: "2026-08-13T00:02:00.000Z",
    });
    assert.equal(result.conflicts.length, 1);
    assert.equal(result.conflicts[0].articleId, article.id);
    assert.equal(result.conflicts[0].path, article.path);
    assert.equal(result.conflicts[0].reason, "draft_and_git_changed");
    const persisted = await database.getOpenContentConflictByArticle(article.id);
    assert.equal(persisted?.baseSource, base);
    assert.equal(persisted?.remoteSource, remote);
    assert.equal(persisted?.draftSource, draftSource);
  });
});
