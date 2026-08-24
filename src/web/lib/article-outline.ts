export interface ArticleHeading {
  level: number;
  line: number;
  text: string;
}

/** Returns the heading that owns the current source line. */
export function activeArticleHeadingLine(
  headings: ArticleHeading[],
  currentLine: number,
): number | null {
  if (headings.length === 0) return null;
  let activeLine = headings[0].line;
  for (const heading of headings) {
    if (heading.line > currentLine) break;
    activeLine = heading.line;
  }
  return activeLine;
}

function cleanHeadingText(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/[`*_~]/g, "")
    .replace(/\\([#`*_{}\[\]()])/g, "$1")
    .trim();
}

/** Extracts ATX Markdown headings while ignoring frontmatter and fenced code. */
export function extractArticleHeadings(source: string): ArticleHeading[] {
  const lines = source.split("\n");
  const headings: ArticleHeading[] = [];
  let frontmatter = lines[0]?.trim() === "---";
  let fence: { marker: "`" | "~"; length: number } | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (frontmatter) {
      if (index > 0 && /^(---|\.\.\.)\s*$/.test(line)) frontmatter = false;
      continue;
    }

    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0] as "`" | "~";
      if (!fence) fence = { marker, length: fenceMatch[1].length };
      else if (fence.marker === marker && fenceMatch[1].length >= fence.length) fence = null;
      continue;
    }
    if (fence) continue;

    const match = line.match(/^ {0,3}(#{1,6})[\t ]+(.+?)[\t ]*#*[\t ]*$/);
    if (!match) continue;
    const text = cleanHeadingText(match[2]);
    if (text) headings.push({ level: match[1].length, line: index + 1, text });
  }
  return headings;
}
