import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import type {
  ArticleMetadata,
  EditorDiagnostic,
} from "../../shared/editor-contract";
import type { ArticleHeading } from "../lib/article-outline";
import { Icon } from "./Icons";

export type ArticlePanelSection = "outline" | "settings";

interface MetadataPanelProps {
  metadata: ArticleMetadata;
  headings: ArticleHeading[];
  activeHeadingLine: number | null;
  activeSection: ArticlePanelSection;
  tagSuggestions: string[];
  diagnostics: EditorDiagnostic[];
  disabled?: boolean;
  onSectionChange: (section: ArticlePanelSection) => void;
  onHeadingSelect: (line: number) => void;
  onMetadataChange: (metadata: ArticleMetadata) => void;
  onClose: () => void;
}

function normalizeTag(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function dateTimeParts(value: string): { date: string; time: string } {
  const matched = value.match(/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/);
  if (matched) return { date: matched[1], time: matched[2] ?? "00:00" };
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString();
  return { date: local.slice(0, 10), time: local.slice(11, 16) };
}

function localIsoValue(date: string, time: string): string {
  if (!date) return "";
  const safeTime = time || "00:00";
  const local = new Date(`${date}T${safeTime}:00`);
  if (Number.isNaN(local.getTime())) return `${date}T${safeTime}:00`;
  const offsetMinutes = -local.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const hours = String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(2, "0");
  const minutes = String(Math.abs(offsetMinutes) % 60).padStart(2, "0");
  return `${date}T${safeTime}:00${sign}${hours}:${minutes}`;
}

export function MetadataPanel({
  metadata,
  headings,
  activeHeadingLine,
  activeSection,
  tagSuggestions,
  diagnostics,
  disabled = false,
  onSectionChange,
  onHeadingSelect,
  onMetadataChange,
  onClose,
}: MetadataPanelProps) {
  const id = useId();
  const [tagInput, setTagInput] = useState("");
  const [tagMenuOpen, setTagMenuOpen] = useState(false);
  const [dateMenuOpen, setDateMenuOpen] = useState(false);
  const outlineRef = useRef<HTMLElement>(null);
  const errors = diagnostics.filter((item) => item.severity === "error");
  const warnings = diagnostics.filter((item) => item.severity === "warning");

  const updateField = <Key extends keyof Pick<ArticleMetadata, "title" | "date" | "summary">>(
    key: Key,
    value: ArticleMetadata[Key],
  ) => onMetadataChange({ ...metadata, [key]: value });

  const addTag = (value = tagInput) => {
    const nextTag = normalizeTag(value);
    if (!nextTag || metadata.tags.includes(nextTag)) {
      setTagInput("");
      return;
    }
    onMetadataChange({ ...metadata, tags: [...metadata.tags, nextTag] });
    setTagInput("");
    setTagMenuOpen(false);
  };

  const availableTags = tagSuggestions.filter((tag) => {
    const needle = normalizeTag(tagInput).toLocaleLowerCase("zh-CN");
    return !metadata.tags.includes(tag) && (!needle || tag.toLocaleLowerCase("zh-CN").includes(needle));
  });
  const dateParts = dateTimeParts(metadata.date);
  const minimumHeadingLevel = headings.length
    ? Math.min(...headings.map((heading) => heading.level))
    : 1;

  useEffect(() => {
    if (activeSection !== "outline" || activeHeadingLine === null) return;
    outlineRef.current
      ?.querySelector<HTMLElement>(`[data-heading-line="${activeHeadingLine}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeHeadingLine, activeSection]);

  return (
    <aside className="metadata-panel" aria-labelledby={`${id}-title`}>
      <header className="panel-heading">
        <div>
          <span className="eyebrow">Document</span>
          <h2 id={`${id}-title`}>{activeSection === "outline" ? "文章目录" : "文章设置"}</h2>
        </div>
        <button type="button" className="icon-button metadata-close" onClick={onClose} aria-label="关闭文章设置">
          <Icon name="close" />
        </button>
      </header>

      <div className="article-panel-tabs" role="tablist" aria-label="文章辅助面板">
        <button
          type="button"
          role="tab"
          aria-selected={activeSection === "settings"}
          className={activeSection === "settings" ? "is-active" : ""}
          onClick={() => onSectionChange("settings")}
        >
          <Icon name="metadata" size={15} />设置
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeSection === "outline"}
          className={activeSection === "outline" ? "is-active" : ""}
          onClick={() => onSectionChange("outline")}
        >
          <Icon name="outline" size={15} />目录 <span>{headings.length}</span>
        </button>
      </div>

      {activeSection === "outline" ? (
        <nav ref={outlineRef} className="article-outline" aria-label="当前文章目录">
          {headings.length > 0 ? (
            <ol>
              {headings.map((heading) => (
                <li key={`${heading.line}:${heading.text}`} style={{ "--outline-depth": Math.min(heading.level - minimumHeadingLevel, 4) } as CSSProperties}>
                  <button
                    type="button"
                    className={heading.line === activeHeadingLine ? "is-active" : undefined}
                    data-heading-line={heading.line}
                    aria-current={heading.line === activeHeadingLine ? "location" : undefined}
                    onClick={() => onHeadingSelect(heading.line)}
                  >
                    <span>{heading.text}</span>
                    <small>{heading.line}</small>
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <div className="article-outline__empty">
              <Icon name="outline" size={28} />
              <strong>还没有目录</strong>
              <p>使用 <code>## 二级标题</code> 组织正文，目录会在这里实时生成。</p>
            </div>
          )}
          <footer>{headings.length > 0 ? `共 ${headings.length} 个章节 · 点击可定位到源码` : "目录不会写入文章内容"}</footer>
        </nav>
      ) : (
      <div className="metadata-scroll">
        <section className="metadata-section" aria-labelledby={`${id}-content-heading`}>
          <h3 id={`${id}-content-heading`}>Frontmatter</h3>
          <p className="metadata-section-intro">这里的每一项都直接对应文章顶部的 YAML 字段。</p>
          <label className="form-field" htmlFor={`${id}-title-input`}>
            <span>标题 <code className="frontmatter-key">title</code> <b aria-hidden="true">*</b></span>
            <input
              id={`${id}-title-input`}
              value={metadata.title}
              onChange={(event) => updateField("title", event.target.value)}
              placeholder="一篇值得记住的文章"
              disabled={disabled}
              required
              aria-invalid={!metadata.title.trim()}
            />
          </label>

          <label className="form-field" htmlFor={`${id}-summary-input`}>
            <span>摘要 <code className="frontmatter-key">summary</code> <small>可选</small></span>
            <textarea
              id={`${id}-summary-input`}
              value={metadata.summary}
              onChange={(event) => updateField("summary", event.target.value)}
              placeholder="用一两句话概括文章内容"
              rows={4}
              disabled={disabled}
              maxLength={320}
            />
            <small>{metadata.summary.length} / 320 · 留空时删除 summary 字段</small>
          </label>

          <div className="form-field" onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setTagMenuOpen(false);
          }}>
            <label htmlFor={`${id}-tag-input`}>标签 <code className="frontmatter-key">tags</code></label>
            {metadata.tags.length > 0 ? (
              <ul className="tag-list" aria-label="文章标签">
                {metadata.tags.map((tag) => (
                  <li key={tag}>
                    <span>{tag}</span>
                    <button
                      type="button"
                      onClick={() => onMetadataChange({
                        ...metadata,
                        tags: metadata.tags.filter((item) => item !== tag),
                      })}
                      disabled={disabled}
                      aria-label={`移除标签 ${tag}`}
                    >
                      <Icon name="close" size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className={`tag-input-row${tagMenuOpen ? " is-open" : ""}`}>
              <input
                id={`${id}-tag-input`}
                value={tagInput}
                onChange={(event) => {
                  setTagInput(event.target.value);
                  setTagMenuOpen(true);
                }}
                onFocus={() => setTagMenuOpen(true)}
                onClick={() => setTagMenuOpen(true)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === ",") {
                    event.preventDefault();
                    addTag();
                  }
                }}
                placeholder="选择已有标签或输入新标签"
                disabled={disabled}
                role="combobox"
                aria-expanded={tagMenuOpen}
                aria-controls={`${id}-tag-options`}
              />
              <button type="button" onClick={() => addTag()} disabled={disabled || !tagInput.trim()} aria-label="添加标签">
                <Icon name="plus" size={16} />
              </button>
              {tagMenuOpen ? (
                <div className="tag-suggestions" id={`${id}-tag-options`} role="listbox" aria-label="已有标签">
                  {availableTags.length > 0 ? availableTags.slice(0, 12).map((tag) => (
                    <button type="button" role="option" aria-selected="false" key={tag} onClick={() => addTag(tag)}>
                      <span>{tag}</span><Icon name="plus" size={13} />
                    </button>
                  )) : (
                    <small>{tagInput.trim() ? "按 Enter 创建这个标签" : "暂时没有其他标签"}</small>
                  )}
                </div>
              ) : null}
            </div>
          </div>

          <div className="form-field" onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDateMenuOpen(false);
          }}>
            <span>发布时间 <code className="frontmatter-key">date</code> <b aria-hidden="true">*</b></span>
            <div className={`date-input-row${dateMenuOpen ? " is-open" : ""}`}>
              <input
                id={`${id}-date-input`}
                type="text"
                value={metadata.date}
                onChange={(event) => updateField("date", event.target.value)}
                placeholder="2026-08-13T12:00:00Z"
                spellCheck={false}
                disabled={disabled}
                required
                aria-label="发布时间 date"
                aria-invalid={!metadata.date.trim()}
              />
              <button type="button" onClick={() => setDateMenuOpen((current) => !current)} disabled={disabled} aria-label="选择发布时间" aria-expanded={dateMenuOpen}>
                <Icon name="calendar" size={16} />
              </button>
              {dateMenuOpen ? (
                <div className="date-picker-popover" role="dialog" aria-label="选择发布日期和时间">
                  <label><span>日期</span><input type="date" value={dateParts.date} onChange={(event) => updateField("date", localIsoValue(event.target.value, dateParts.time))} /></label>
                  <label><span>时间</span><input type="time" value={dateParts.time} onChange={(event) => updateField("date", localIsoValue(dateParts.date, event.target.value))} /></label>
                  <div>
                    <button type="button" onClick={() => {
                      const now = new Date();
                      const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString();
                      updateField("date", localIsoValue(local.slice(0, 10), local.slice(11, 16)));
                    }}>设为现在</button>
                    <button type="button" className="button--quiet" onClick={() => setDateMenuOpen(false)}>完成</button>
                  </div>
                </div>
              ) : null}
            </div>
            <small>按原值写入，也可以用日历选择日期与时间</small>
          </div>
        </section>

        {errors.length > 0 || warnings.length > 0 ? (
          <section className="diagnostics" aria-labelledby={`${id}-diagnostics-heading`}>
            <h3 id={`${id}-diagnostics-heading`}>推送检查</h3>
            <ul>
              {[...errors, ...warnings].map((diagnostic, index) => (
                <li key={`${diagnostic.code}-${index}`} className={`diagnostic diagnostic--${diagnostic.severity}`}>
                  <Icon name="warning" size={16} />
                  <span>{diagnostic.message}{diagnostic.line ? <small>第 {diagnostic.line} 行</small> : null}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
      )}
    </aside>
  );
}
