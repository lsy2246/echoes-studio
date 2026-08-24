import DOMPurify from "dompurify";
import MarkdownIt from "markdown-it";
import { useEffect, useMemo, useRef } from "react";
import { prepareMdxPreviewSource } from "../lib/mdx-preview";
import { extractArticleHeadings } from "../lib/article-outline";

const markdown = new MarkdownIt({
  breaks: false,
  html: true,
  linkify: true,
  typographer: false,
});

interface MdxPreviewProps {
  source: string;
  onActiveLineChange?: (line: number) => void;
}

export function MdxPreview({ source, onActiveLineChange }: MdxPreviewProps) {
  const previewRef = useRef<HTMLElement>(null);
  const html = useMemo(() => {
    const rendered = markdown.render(prepareMdxPreviewSource(source));
    return DOMPurify.sanitize(rendered, {
      USE_PROFILES: { html: true, svg: true, svgFilters: true },
      ADD_ATTR: ["target", "rel", "class", "style"],
      FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "base"],
      FORBID_ATTR: ["srcdoc"],
    });
  }, [source]);

  useEffect(() => {
    const preview = previewRef.current;
    if (!preview || !onActiveLineChange) return;
    const sourceHeadings = extractArticleHeadings(source);
    let animationFrame = 0;
    const updateActiveHeading = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        const renderedHeadings = Array.from(
          preview.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6"),
        );
        if (renderedHeadings.length === 0 || sourceHeadings.length === 0) return;
        if (
          preview.scrollTop > 0 &&
          preview.scrollTop + preview.clientHeight >= preview.scrollHeight - 2
        ) {
          onActiveLineChange(sourceHeadings[sourceHeadings.length - 1].line);
          return;
        }
        const top = preview.getBoundingClientRect().top + 24;
        let activeIndex = 0;
        renderedHeadings.forEach((heading, index) => {
          if (heading.getBoundingClientRect().top <= top) activeIndex = index;
        });
        onActiveLineChange(
          sourceHeadings[Math.min(activeIndex, sourceHeadings.length - 1)].line,
        );
      });
    };
    preview.addEventListener("scroll", updateActiveHeading, { passive: true });
    updateActiveHeading();
    return () => {
      cancelAnimationFrame(animationFrame);
      preview.removeEventListener("scroll", updateActiveHeading);
    };
  }, [onActiveLineChange, source]);

  return (
    <section ref={previewRef} className="mdx-preview" aria-label="MDX 安全预览">
      <article
        className="cherry-markdown mdx-preview__content"
        // HTML is sanitized immediately above; source MDX is never evaluated.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </section>
  );
}
