export interface DiffLine {
  type: "equal" | "added" | "removed";
  value: string;
  oldNumber: number | null;
  newNumber: number | null;
}

export interface SplitDiffRow {
  left: DiffLine | null;
  right: DiffLine | null;
}

/** Pairs deletion/addition blocks so both versions remain vertically aligned. */
export function splitDiffRows(lines: DiffLine[]): SplitDiffRow[] {
  const rows: SplitDiffRow[] = [];
  let index = 0;
  while (index < lines.length) {
    if (lines[index].type === "equal") {
      rows.push({ left: lines[index], right: lines[index] });
      index += 1;
      continue;
    }
    const removed: DiffLine[] = [];
    const added: DiffLine[] = [];
    while (index < lines.length && lines[index].type !== "equal") {
      if (lines[index].type === "removed") removed.push(lines[index]);
      else added.push(lines[index]);
      index += 1;
    }
    for (let offset = 0; offset < Math.max(removed.length, added.length); offset += 1) {
      rows.push({ left: removed[offset] ?? null, right: added[offset] ?? null });
    }
  }
  return rows;
}

/** Deterministic line diff. Large documents use a bounded middle-block fallback. */
export function diffLines(before: string, after: string): DiffLine[] {
  const left = before.split("\n");
  const right = after.split("\n");
  let prefix = 0;
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < left.length - prefix && suffix < right.length - prefix &&
    left[left.length - 1 - suffix] === right[right.length - 1 - suffix]
  ) suffix += 1;

  const output: DiffLine[] = [];
  let oldNumber = 1;
  let newNumber = 1;
  const push = (type: DiffLine["type"], value: string) => {
    output.push({
      type, value,
      oldNumber: type === "added" ? null : oldNumber++,
      newNumber: type === "removed" ? null : newNumber++,
    });
  };
  for (let index = 0; index < prefix; index += 1) push("equal", left[index]);

  const a = left.slice(prefix, left.length - suffix || undefined);
  const b = right.slice(prefix, right.length - suffix || undefined);
  if (a.length * b.length <= 1_000_000) {
    const width = b.length + 1;
    const matrix = new Uint32Array((a.length + 1) * width);
    for (let row = a.length - 1; row >= 0; row -= 1) {
      for (let column = b.length - 1; column >= 0; column -= 1) {
        matrix[row * width + column] = a[row] === b[column]
          ? matrix[(row + 1) * width + column + 1] + 1
          : Math.max(matrix[(row + 1) * width + column], matrix[row * width + column + 1]);
      }
    }
    let row = 0;
    let column = 0;
    while (row < a.length || column < b.length) {
      if (row < a.length && column < b.length && a[row] === b[column]) {
        push("equal", a[row]); row += 1; column += 1;
      } else if (column < b.length && (row >= a.length || matrix[row * width + column + 1] > matrix[(row + 1) * width + column])) {
        push("added", b[column++]);
      } else {
        push("removed", a[row++]);
      }
    }
  } else {
    a.forEach((line) => push("removed", line));
    b.forEach((line) => push("added", line));
  }
  for (let index = suffix; index > 0; index -= 1) push("equal", left[left.length - index]);
  return output;
}
