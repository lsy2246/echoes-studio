import DOMPurify from "dompurify";
import MarkdownIt from "markdown-it";
import { useMemo } from "react";
import { prepareMdxPreviewSource } from "../lib/mdx-preview";

const markdown = new MarkdownIt({
  breaks: false,
  html: true,
  linkify: true,
  typographer: false,
});

interface MdxPreviewProps {
  source: string;
}

export function MdxPreview({ source }: MdxPreviewProps) {
  const html = useMemo(() => {
    const rendered = markdown.render(prepareMdxPreviewSource(source));
    return DOMPurify.sanitize(rendered, {
      USE_PROFILES: { html: true, svg: true, svgFilters: true },
      ADD_ATTR: ["target", "rel", "class", "style"],
      FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "base"],
      FORBID_ATTR: ["srcdoc"],
    });
  }, [source]);

  return (
    <section className="mdx-preview" aria-label="MDX 安全预览">
      <article
        className="cherry-markdown mdx-preview__content"
        // HTML is sanitized immediately above; source MDX is never evaluated.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </section>
  );
}
