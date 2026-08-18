import { badRequest } from "./errors";
import type { Frontmatter, JsonValue } from "./types";

export interface ParsedDocument {
  frontmatter: Frontmatter;
  body: string;
  hasFrontmatter: boolean;
}

function parseQuoted(value: string): string {
  if (value.startsWith('"')) {
    try {
      return JSON.parse(value) as string;
    } catch {
      throw badRequest("Invalid quoted string in frontmatter");
    }
  }
  return value.slice(1, -1).replace(/''/g, "'");
}

function splitFlowItems(source: string): string[] {
  const output: string[] = [];
  let quote = "";
  let escaped = false;
  let start = 0;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (escaped) escaped = false;
    else if (char === "\\" && quote === '"') escaped = true;
    else if ((char === '"' || char === "'") && (!quote || quote === char)) {
      quote = quote ? "" : char;
    } else if (char === "," && !quote) {
      output.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  if (quote) throw badRequest("Unclosed quote in frontmatter array");
  output.push(source.slice(start).trim());
  return output.filter(Boolean);
}

function parseScalar(raw: string): JsonValue {
  const value = raw.trim();
  if (!value) return "";
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) return parseQuoted(value);
  if (value.startsWith("[") && value.endsWith("]")) {
    return splitFlowItems(value.slice(1, -1)).map(parseScalar);
  }
  if (value === "null" || value === "~") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return Number(value);
  // Dates deliberately remain strings. This keeps JSON stable across runtimes.
  return value.replace(/\s+#.*$/, "");
}

/**
 * Parses the portable subset used by article frontmatter. Nested YAML objects,
 * aliases and executable/custom tags are rejected instead of being guessed.
 */
function parseYamlSubset(source: string): Frontmatter {
  const result: Frontmatter = {};
  const lines = source.split(/\r?\n/);
  let currentList: string | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    if (!raw.trim() || /^\s*#/.test(raw)) continue;
    const listMatch = raw.match(/^\s{2,}-\s+(.*)$/);
    if (listMatch && currentList) {
      (result[currentList] as JsonValue[]).push(parseScalar(listMatch[1]));
      continue;
    }
    if (/^\s/.test(raw)) {
      throw badRequest(`Unsupported nested frontmatter at line ${index + 1}`);
    }
    const match = raw.match(/^([A-Za-z_][\w.-]*):(?:\s*(.*))?$/);
    if (!match) throw badRequest(`Invalid frontmatter at line ${index + 1}`);
    const [, key, remainder = ""] = match;
    if (Object.hasOwn(result, key)) {
      throw badRequest(`Duplicate frontmatter key: ${key}`);
    }
    if (!remainder.trim()) {
      result[key] = [];
      currentList = key;
    } else if (/^[|>][-+]?$/.test(remainder)) {
      const chunks: string[] = [];
      while (index + 1 < lines.length && /^\s+/.test(lines[index + 1])) {
        chunks.push(lines[index + 1].replace(/^\s{2}/, ""));
        index += 1;
      }
      const folded = remainder.startsWith(">");
      const keepTrailingNewline = !remainder.endsWith("-");
      const content = folded ? chunks.join(" ") : chunks.join("\n");
      result[key] = keepTrailingNewline ? `${content}\n` : content;
      currentList = null;
    } else {
      result[key] = parseScalar(remainder);
      currentList = null;
    }
  }
  return result;
}

export function parseFrontmatter(source: string): ParsedDocument {
  const normalized = source.replace(/^\uFEFF/, "");
  const opening = normalized.match(/^---\r?\n/);
  if (!opening) {
    return { frontmatter: {}, body: source, hasFrontmatter: false };
  }
  const closingPattern = /^(?:---|\.\.\.)[\t ]*(?:\r?\n|$)/gm;
  closingPattern.lastIndex = opening[0].length;
  const closing = closingPattern.exec(normalized);
  if (!closing) throw badRequest("Unclosed frontmatter block");
  return {
    frontmatter: parseYamlSubset(
      normalized.slice(opening[0].length, closing.index).replace(/\r?\n$/, ""),
    ),
    // Slice the original normalized source so CRLF and the final newline remain exact.
    body: normalized.slice(closing.index + closing[0].length),
    hasFrontmatter: true,
  };
}

export function titleFromFrontmatter(frontmatter: Frontmatter, path: string): string {
  const title = frontmatter.title;
  if (typeof title === "string" && title.trim()) return title.trim();
  const filename = path.split("/").pop()?.replace(/\.mdx?$/i, "") ?? "Untitled";
  return filename.replace(/[-_]+/g, " ");
}
