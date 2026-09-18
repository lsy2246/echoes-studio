import assert from "node:assert/strict";
import test from "node:test";
import type { ArticleSummary } from "../../src/shared/editor-contract";
import {
  articleFolderPaths,
  buildArticleTree,
  relativeArticlePath,
} from "../../src/web/lib/article-tree";
import {
  findFencedCodeBlocks,
  findFencedCodeContentRanges,
  normalizeNestedFencesForCherry,
  restoreNestedFencesFromCherry,
} from "../../src/web/lib/markdown-preview";
import {
  createArticleSource,
  parseArticleSource,
  writeMetadataToSource,
} from "../../src/web/lib/frontmatter";
import { formatMarkdown } from "../../src/web/lib/format-markdown";
import {
  activeArticleHeadingLine,
  extractArticleHeadings,
} from "../../src/web/lib/article-outline";
import {
  findMermaidNodeLabelTarget,
  findMermaidSubgraphLabelTarget,
  nextMermaidScale,
} from "../../src/web/editor/mermaid-preview";
import {
  buildPreviewSearchRegex,
  matchesPreviewSearch,
} from "../../src/web/editor/preview-search";

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

test("fenced code ranges include the contents of indented list code blocks", () => {
  const source = [
    "- shell",
    "",
    "  ```shell",
    "  echo first",
    "  echo second",
    "  ```",
    "",
    "```text",
    "plain",
    "```",
  ].join("\n");

  assert.deepEqual(
    findFencedCodeContentRanges(source).map(({ from, to }) => source.slice(from, to)),
    ["  echo first\n  echo second", "plain"],
  );
  assert.deepEqual(findFencedCodeBlocks(source).map(({ language }) => language), ["shell", "text"]);
});

test("Mermaid node labels can span source lines", () => {
  const source = [
    "flowchart TD",
    "  A[服务 A SDK]",
    "  B[服务 B SDK<br/>",
    "    TraceID=trace-001<br/>",
    "    SpanID=b-001<br/>",
    "    ParentSpanID=a-001]",
    "  A --> B",
  ].join("\n");

  const target = findMermaidNodeLabelTarget(source, "B");
  assert.ok(target);
  assert.equal(
    target.value,
    "服务 B SDK\nTraceID=trace-001\nSpanID=b-001\nParentSpanID=a-001",
  );
  const replacement = target.replace(target.value.replace(/\r?\n/g, "<br/>"));
  const updated = `${source.slice(0, target.from)}${replacement}${source.slice(target.to)}`;
  assert.match(
    updated,
    /B\["服务 B SDK<br\/>TraceID=trace-001<br\/>SpanID=b-001<br\/>ParentSpanID=a-001"\]/,
  );

  const quotedSource = 'flowchart TD\n  API["Kubernetes API Server"]';
  const quotedTarget = findMermaidNodeLabelTarget(quotedSource, "API");
  assert.ok(quotedTarget);
  const quotedUpdated = `${quotedSource.slice(0, quotedTarget.from)}${quotedTarget.replace("K8S API")}${quotedSource.slice(quotedTarget.to)}`;
  assert.match(quotedUpdated, /API\["K8S API"\]/);
});

test("Mermaid subgraph titles expose their visible names", () => {
  const source = [
    "flowchart TD",
    '  subgraph K8S["Kubernetes 集群"]',
    '    API["Kubernetes API Server"]',
    "  end",
  ].join("\n");

  const target = findMermaidSubgraphLabelTarget(source, "K8S", 20);
  assert.ok(target);
  assert.equal(target.value, "Kubernetes 集群");
  const replacement = target.replace("生产集群");
  const from = target.from - 20;
  const to = target.to - 20;
  const updated = `${source.slice(0, from)}${replacement}${source.slice(to)}`;
  assert.match(updated, /subgraph K8S\["生产集群"\]/);
});

test("Mermaid zoom supports small diagrams without moving the pan layer", () => {
  assert.equal(nextMermaidScale(0.5, "out"), 0.4167);
  assert.equal(nextMermaidScale(0.01, "out"), 0.01);
  assert.equal(nextMermaidScale(0.004, "out", 0.002), 0.0033);
  assert.equal(nextMermaidScale(7, "in"), 8);
});

test("preview search mirrors Cherry search options", () => {
  const insensitive = buildPreviewSearchRegex("K8S", false, false, false);
  assert.ok(insensitive);
  assert.deepEqual("k8s K8S".match(insensitive), ["k8s", "K8S"]);

  const literal = buildPreviewSearchRegex("a+b", true, false, false);
  assert.ok(literal);
  assert.deepEqual("a+b A+B".match(literal), ["a+b"]);

  const regex = buildPreviewSearchRegex("K(?:8S|ubernetes)", false, false, true);
  assert.ok(regex);
  assert.deepEqual("K8S kubernetes".match(regex), ["K8S", "kubernetes"]);
  assert.equal(matchesPreviewSearch("Nginx Ingress Controller", regex), false);
  assert.equal(matchesPreviewSearch("Kubernetes 集群", regex), true);
  assert.equal(buildPreviewSearchRegex("[", false, false, true), null);
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

test("article outline follows Markdown headings but ignores frontmatter and code fences", () => {
  const source = [
    "---",
    'title: "# Not a heading"',
    "---",
    "",
    "# Overview",
    "## [Setup](#setup)",
    "```md",
    "### Hidden example",
    "```",
    "### **Usage** `notes`",
  ].join("\n");
  assert.deepEqual(extractArticleHeadings(source), [
    { level: 1, line: 5, text: "Overview" },
    { level: 2, line: 6, text: "Setup" },
    { level: 3, line: 10, text: "Usage notes" },
  ]);
});

test("article outline selects the heading that owns the active source line", () => {
  const headings = [
    { level: 1, line: 5, text: "Overview" },
    { level: 2, line: 12, text: "Setup" },
    { level: 2, line: 28, text: "Usage" },
  ];
  assert.equal(activeArticleHeadingLine(headings, 1), 5);
  assert.equal(activeArticleHeadingLine(headings, 12), 12);
  assert.equal(activeArticleHeadingLine(headings, 27), 12);
  assert.equal(activeArticleHeadingLine(headings, 99), 28);
  assert.equal(activeArticleHeadingLine([], 1), null);
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
