import { parseDocument } from "yaml";
import type {
  ArticleMetadata,
  EditorDiagnostic,
} from "../../shared/editor-contract";

interface FrontmatterParts {
  hasFrontmatter: boolean;
  raw: string;
  body: string;
  newline: "\n" | "\r\n";
  bom: string;
}

export interface ParsedArticleSource {
  metadata: ArticleMetadata;
  diagnostics: EditorDiagnostic[];
  hasFrontmatter: boolean;
}

const EMPTY_METADATA: ArticleMetadata = {
  title: "",
  date: "",
  tags: [],
  summary: "",
};

function splitFrontmatter(source: string): FrontmatterParts {
  const bom = source.startsWith("\uFEFF") ? "\uFEFF" : "";
  const text = bom ? source.slice(1) : source;
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);

  if (lines[0]?.trim() !== "---") {
    return { hasFrontmatter: false, raw: "", body: text, newline, bom };
  }

  const closingIndex = lines.findIndex(
    (line, index) => index > 0 && (line.trim() === "---" || line.trim() === "..."),
  );
  if (closingIndex < 0) {
    return { hasFrontmatter: false, raw: "", body: text, newline, bom };
  }

  return {
    hasFrontmatter: true,
    raw: lines.slice(1, closingIndex).join(newline),
    body: lines.slice(closingIndex + 1).join(newline),
    newline,
    bom,
  };
}

function coerceMetadata(value: unknown, fallback?: Partial<ArticleMetadata>): ArticleMetadata {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const rawTags = record.tags ?? fallback?.tags ?? [];
  const tags = Array.isArray(rawTags)
    ? rawTags.map(String).filter(Boolean)
    : typeof rawTags === "string"
      ? rawTags.split(",").map((tag) => tag.trim()).filter(Boolean)
      : [];

  const metadata: ArticleMetadata = {
    ...EMPTY_METADATA,
    ...fallback,
    ...record,
    title: String(record.title ?? fallback?.title ?? ""),
    date: String(record.date ?? fallback?.date ?? ""),
    tags,
    summary: String(record.summary ?? fallback?.summary ?? ""),
  };
  delete metadata.draft;
  return metadata;
}

export function parseArticleSource(
  source: string,
  fallback?: Partial<ArticleMetadata>,
): ParsedArticleSource {
  const parts = splitFrontmatter(source);
  if (!parts.hasFrontmatter) {
    return {
      metadata: coerceMetadata({}, fallback),
      hasFrontmatter: false,
      diagnostics: [
        {
          code: "frontmatter.missing",
          message: "文章没有 YAML Frontmatter；保存元数据时会自动创建。",
          severity: "info",
          line: 1,
        },
      ],
    };
  }

  const document = parseDocument(parts.raw, { uniqueKeys: true });
  const diagnostics: EditorDiagnostic[] = document.errors.map((error) => ({
    code: "frontmatter.invalid",
    message: "Frontmatter 的 YAML 格式不正确，请检查缩进、引号或重复字段。",
    severity: "error",
    line: error.linePos?.[0]?.line,
  }));

  let parsed: unknown = {};
  if (diagnostics.length === 0) {
    try {
      parsed = document.toJS();
    } catch (error) {
      diagnostics.push({
        code: "frontmatter.invalid",
        message: "无法解析 Frontmatter，请检查 YAML 格式。",
        severity: "error",
      });
    }
  }

  return {
    metadata: coerceMetadata(parsed, fallback),
    diagnostics,
    hasFrontmatter: true,
  };
}

/**
 * Updates only the known CMS fields through YAML's document model. Unknown
 * fields, order and comments are retained. The function is called only after a
 * metadata edit, so merely opening and saving an article remains byte-identical.
 */
export function writeMetadataToSource(
  source: string,
  metadata: ArticleMetadata,
): { source: string; diagnostics: EditorDiagnostic[] } {
  const parts = splitFrontmatter(source);
  const document = parseDocument(parts.hasFrontmatter ? parts.raw : "", {
    uniqueKeys: true,
  });

  if (document.errors.length > 0) {
    return {
      source,
      diagnostics: document.errors.map((error) => ({
        code: "frontmatter.invalid",
        message: "无法更新元数据：Frontmatter 的 YAML 格式不正确。",
        severity: "error",
        line: error.linePos?.[0]?.line,
      })),
    };
  }

  document.set("title", metadata.title);
  document.set("date", metadata.date);
  document.set("tags", metadata.tags);
  if (metadata.summary.trim()) document.set("summary", metadata.summary);
  else document.delete("summary");
  // `draft` used to be a New Echoes publishing flag. It is deliberately
  // removed now that repository presence is the only online publication state.
  document.delete("draft");

  const raw = document.toString({ lineWidth: 0 }).trimEnd().replace(/\n/g, parts.newline);
  const body = parts.body.length > 0 ? `${parts.newline}${parts.body}` : parts.newline;

  return {
    source: `${parts.bom}---${parts.newline}${raw}${parts.newline}---${body}`,
    diagnostics: [],
  };
}

export function createArticleSource(metadata: ArticleMetadata): string {
  const document = parseDocument("");
  document.set("title", metadata.title);
  document.set("date", metadata.date);
  document.set("tags", metadata.tags);
  if (metadata.summary.trim()) document.set("summary", metadata.summary);
  return `---\n${document.toString({ lineWidth: 0 }).trimEnd()}\n---\n\n# ${metadata.title}\n\n`;
}
