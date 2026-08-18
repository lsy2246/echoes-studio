import type { EditorDiagnostic } from "../../shared/editor-contract";
import { parseArticleSource } from "./frontmatter";

export function validateSource(source: string): EditorDiagnostic[] {
  const parsed = parseArticleSource(source);
  const diagnostics = [...parsed.diagnostics];

  if (!parsed.metadata.title.trim()) {
    diagnostics.push({
      code: "metadata.title.required",
      message: "推送前需要填写文章标题。",
      severity: "error",
    });
  }
  if (!parsed.metadata.date.trim()) {
    diagnostics.push({
      code: "metadata.date.required",
      message: "推送前需要填写发布日期。",
      severity: "error",
    });
  }

  const portabilityPatterns: Array<[RegExp, string]> = [
    [/^:::(?:primary|info|warning|danger|success)\b/m, "信息面板"],
    [/!(?:video|audio|pdf|word)\[/, "富媒体标签"],
    [/\[\[toc\]\]/i, "Cherry 目录标记"],
  ];
  for (const [pattern, label] of portabilityPatterns) {
    if (pattern.test(source)) {
      diagnostics.push({
        code: "markdown.nonportable",
        message: `${label}属于扩展语法，请确认目标博客构建器支持。`,
        severity: "warning",
      });
    }
  }

  return diagnostics;
}
