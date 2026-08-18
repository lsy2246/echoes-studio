import assert from "node:assert/strict";
import test from "node:test";
import { prepareMdxPreviewSource } from "../../src/web/lib/mdx-preview";

test("MDX preview removes frontmatter and top-level ESM without touching HTML", () => {
  const source = [
    "---",
    "title: Demo",
    "---",
    "import './demo.css'",
    "import {",
    "  Component,",
    "} from './component'",
    "",
    "# Demo",
    "",
    "<details><summary>More</summary><p>HTML</p></details>",
  ].join("\n");

  assert.equal(
    prepareMdxPreviewSource(source),
    "# Demo\n\n<details><summary>More</summary><p>HTML</p></details>",
  );
});

test("MDX preview keeps import-like text inside fenced code", () => {
  const source = "```ts\nimport value from './module'\n```";
  assert.equal(prepareMdxPreviewSource(source), source);
});
