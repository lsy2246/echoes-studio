const FRONTMATTER_BOUNDARY = /^---\s*$/;
const ESM_STATEMENT = /^(?:import|export)\b/;
const FENCE = /^\s*(```+|~~~+)/;

function stripFrontmatter(source: string): string {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  if (!FRONTMATTER_BOUNDARY.test(lines[0] ?? "")) return lines.join("\n");

  const closingBoundary = lines.findIndex(
    (line, index) => index > 0 && FRONTMATTER_BOUNDARY.test(line),
  );
  return closingBoundary === -1 ? lines.join("\n") : lines.slice(closingBoundary + 1).join("\n");
}

function bracketBalance(value: string): number {
  let balance = 0;
  let quote: "'" | '"' | "`" | null = null;
  let escaped = false;

  for (const character of value) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      continue;
    }
    if (character === "{" || character === "(" || character === "[") balance += 1;
    if (character === "}" || character === ")" || character === "]") balance -= 1;
  }

  return balance;
}

/**
 * Produces a render-only MDX source. The stored document is never changed.
 * ESM declarations are build instructions, so showing them as article copy is
 * misleading; they are removed before the safe Markdown/HTML renderer runs.
 */
export function prepareMdxPreviewSource(source: string): string {
  const lines = stripFrontmatter(source).split("\n");
  const rendered: string[] = [];
  let fenceMarker: string | null = null;
  let skippingEsm = false;
  let esmBalance = 0;

  for (const line of lines) {
    const fence = line.match(FENCE)?.[1] ?? null;
    if (fence && !skippingEsm) {
      if (!fenceMarker) fenceMarker = fence;
      else if (fence[0] === fenceMarker[0] && fence.length >= fenceMarker.length) fenceMarker = null;
      rendered.push(line);
      continue;
    }

    if (!fenceMarker && !skippingEsm && ESM_STATEMENT.test(line.trimStart())) {
      skippingEsm = true;
      esmBalance = bracketBalance(line);
      if (esmBalance <= 0) skippingEsm = false;
      continue;
    }

    if (skippingEsm) {
      esmBalance += bracketBalance(line);
      if (esmBalance <= 0) skippingEsm = false;
      continue;
    }

    rendered.push(line);
  }

  return rendered.join("\n").replace(/^\s+/, "");
}
