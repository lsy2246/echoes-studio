import assert from "node:assert/strict";
import { it } from "node:test";

import { diffLines, splitDiffRows } from "../../src/web/lib/line-diff";

it("shows stable Markdown additions and removals with line numbers", () => {
  const result = diffLines("# Title\nold\nend", "# Title\nnew\nmore\nend");
  assert.deepEqual(result.map(({ type, value }) => ({ type, value })), [
    { type: "equal", value: "# Title" },
    { type: "removed", value: "old" },
    { type: "added", value: "new" },
    { type: "added", value: "more" },
    { type: "equal", value: "end" },
  ]);
  assert.deepEqual(result.at(-1), {
    type: "equal", value: "end", oldNumber: 3, newNumber: 4,
  });
  const split = splitDiffRows(result);
  assert.equal(split.length, 4);
  assert.equal(split[1].left?.value, "old");
  assert.equal(split[1].right?.value, "new");
  assert.equal(split[2].left, null);
  assert.equal(split[2].right?.value, "more");
});
