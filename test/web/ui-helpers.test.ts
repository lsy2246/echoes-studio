import assert from "node:assert/strict";
import test from "node:test";
import type { ArticleSummary } from "../../src/shared/editor-contract";
import {
  articleFolderPaths,
  buildArticleTree,
  relativeArticlePath,
} from "../../src/web/lib/article-tree";
import {
  normalizeNestedFencesForCherry,
  restoreNestedFencesFromCherry,
} from "../../src/web/lib/markdown-preview";
import {
  createArticleSource,
  parseArticleSource,
  writeMetadataToSource,
} from "../../src/web/lib/frontmatter";
import { formatMarkdown } from "../../src/web/lib/format-markdown";

function article(id: string, path: string, title = id): ArticleSummary {
  return {
    id,
    path,
    format: path.endsWith(".mdx") ? "mdx" : "md",
    syncStatus: "synced",
    metadata: { title, date: "2026-08-13", tags: [], summary: "" },
    updatedAt: "2026-08-13T00:00:00.000Z",
    version: 1,
  };
}

test("article tree preserves repository directory hierarchy", () => {
  const tree = buildArticleTree([
    article("root", "src/content/readme.md"),
    article("server", "src/content/server/linux/backup.md"),
    article("dev", "src/content/dev/editor.mdx"),
  ], "src/content");

  assert.equal(tree.articleCount, 3);
  assert.deepEqual(tree.folders.map((folder) => folder.name), ["dev", "server"]);
  assert.equal(tree.folders[1]?.folders[0]?.name, "linux");
  assert.equal(tree.folders[1]?.folders[0]?.articles[0]?.id, "server");
  assert.equal(relativeArticlePath("src/content/dev/editor.mdx", "src/content"), "dev/editor.mdx");
  assert.deepEqual(articleFolderPaths("src/content/server/linux/backup.md", "src/content"), [
    "server",
    "server/linux",
  ]);
});

test("Cherry preview normalizes nested list fences without changing source", () => {
  const source = [
    "4. 安装 Python 库",
    "",
    "   1. 安装 bypy：",
    "",
    "      ```bash",
    "      pip install bypy",
    "      ```",
    "",
    "```text",
    "unchanged",
    "```",
  ].join("\n");

  const preview = normalizeNestedFencesForCherry(source);
  assert.match(preview, /^```bash\npip install bypy\n```/m);
  assert.match(preview, /```text\nunchanged\n```$/);
  assert.match(source, /      ```bash/);
  assert.equal(preview.split("\n").length, source.split("\n").length);
  assert.equal(restoreNestedFencesFromCherry(preview), source);
});

test("preview compatibility leaves ordinary indented code untouched", () => {
  const source = "Paragraph\n\n    ```text\n    literal fence\n    ```";
  assert.equal(normalizeNestedFencesForCherry(source), source);
});

test("frontmatter controls preserve unknown fields and remove the retired draft flag", () => {
  const source = [
    "---",
    'title: "Exact metadata"',
    "date: 2025-03-09T01:07:23Z",
    "tags: []",
    "custom: keep-me",
    "draft: true",
    "---",
    "",
    "Body",
    "",
  ].join("\n");
  const parsed = parseArticleSource(source).metadata;
  const updated = writeMetadataToSource(source, parsed).source;
  assert.match(updated, /date: 2025-03-09T01:07:23Z/);
  assert.match(updated, /custom: keep-me/);
  assert.doesNotMatch(updated, /^draft:/m);
  assert.doesNotMatch(updated, /^summary:/m);
});

test("new CMS articles omit the retired draft flag and an empty summary", () => {
  const source = createArticleSource({
    title: "New article",
    date: "2026-08-13T12:00:00Z",
    tags: [],
    summary: "",
  });
  assert.doesNotMatch(source, /^draft:/m);
  assert.doesNotMatch(source, /^summary:/m);
});

test("Prettier formats Markdown tables, lists and fenced code through its syntax tree", async () => {
  const source = [
    "---",
    'title:   "Keep YAML spacing"',
    'tags: ["a","b"]',
    "---",
    "",
    "# Title",
    "",
    "-   first",
    "- second",
    ">quote",
    "",
    "``` bash",
    "# not a heading   ",
    "-not a list",
    "```",
    "",
    "|a|b|",
    "|-|-|",
    "|1|2|",
  ].join("\n");

  assert.equal(await formatMarkdown(source, "md"), [
    "---",
    'title:   "Keep YAML spacing"',
    'tags: ["a","b"]',
    "---",
    "",
    "# Title",
    "",
    "- first",
    "- second",
    "",
    "> quote",
    "",
    "```bash",
    "# not a heading",
    "-not a list",
    "```",
    "",
    "| a   | b   |",
    "| --- | --- |",
    "| 1   | 2   |",
    "",
  ].join("\n"));
});

test("Prettier formats embedded MDX expressions", async () => {
  const source = 'import Card from "./Card"\n\n# Title\n\n<Card config={ {enabled:true,count:2} } />';
  assert.equal(await formatMarkdown(source, "mdx"), [
    'import Card from "./Card";',
    "",
    "# Title",
    "",
    "<Card config={{ enabled: true, count: 2 }} />",
    "",
  ].join("\n"));
});
