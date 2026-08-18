const LIST_ITEM = /^(\s*)(?:[-+*]|\d+[.)])\s+/;
const FENCE_START = /^( +)(`{3,}|~{3,})(.*)$/;
const ROOT_FENCE_START = /^(`{3,}|~{3,})(.*)$/;

/**
 * Cherry treats fences indented more than three spaces as literal indented
 * code before its list parser can attach them to a nested list item. Existing
 * CommonMark documents legitimately use that indentation relative to their
 * list container. This function only creates a preview copy; the editor and
 * persisted source remain byte-for-byte unchanged.
 */
export function normalizeNestedFencesForCherry(source: string): string {
  const lines = source.split("\n");
  let changed = false;

  for (let index = 0; index < lines.length; index += 1) {
    const opening = lines[index]?.match(FENCE_START);
    if (!opening || opening[1].length <= 3) continue;

    let previous = index - 1;
    while (previous >= 0 && lines[previous]?.trim() === "") previous -= 1;
    const listItem = previous >= 0 ? lines[previous]?.match(LIST_ITEM) : null;
    if (!listItem || listItem[1].length >= opening[1].length) continue;

    const fenceCharacter = opening[2][0];
    const minimumFenceLength = opening[2].length;
    // Fences at 0–3 columns already parse correctly. For a deeper list item,
    // moving the preview copy fully left prevents Cherry's indented-code hook
    // from consuming it before the fenced-code hook runs.
    const excessIndent = opening[1].length;
    let closing = index + 1;
    for (; closing < lines.length; closing += 1) {
      const candidate = lines[closing]?.trimStart() ?? "";
      const closingFence = candidate.match(/^(`{3,}|~{3,})\s*$/);
      if (
        closingFence
        && closingFence[1][0] === fenceCharacter
        && closingFence[1].length >= minimumFenceLength
      ) break;
    }
    if (closing >= lines.length) continue;

    for (let lineIndex = index; lineIndex <= closing; lineIndex += 1) {
      const line = lines[lineIndex] ?? "";
      const removable = Math.min(excessIndent, line.match(/^ */)?.[0].length ?? 0);
      lines[lineIndex] = line.slice(removable);
    }
    changed = true;
    index = closing;
  }

  return changed ? lines.join("\n") : source;
}

/** Restores the canonical CommonMark indentation before saving or publishing. */
export function restoreNestedFencesFromCherry(source: string): string {
  const lines = source.split("\n");
  let changed = false;

  for (let index = 0; index < lines.length; index += 1) {
    const opening = lines[index]?.match(ROOT_FENCE_START);
    if (!opening) continue;

    let previous = index - 1;
    while (previous >= 0 && lines[previous]?.trim() === "") previous -= 1;
    const listItem = previous >= 0 ? lines[previous]?.match(LIST_ITEM) : null;
    if (!listItem || listItem[1].length === 0) continue;

    const fenceCharacter = opening[1][0];
    const minimumFenceLength = opening[1].length;
    let closing = index + 1;
    for (; closing < lines.length; closing += 1) {
      const closingFence = lines[closing]?.match(/^(`{3,}|~{3,})\s*$/);
      if (
        closingFence
        && closingFence[1][0] === fenceCharacter
        && closingFence[1].length >= minimumFenceLength
      ) break;
    }
    if (closing >= lines.length) continue;

    const indent = " ".repeat(listItem[0].length);
    for (let lineIndex = index; lineIndex <= closing; lineIndex += 1) {
      lines[lineIndex] = `${indent}${lines[lineIndex] ?? ""}`;
    }
    changed = true;
    index = closing;
  }

  return changed ? lines.join("\n") : source;
}
