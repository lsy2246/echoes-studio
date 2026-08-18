import { useEffect, useId, useRef, useState } from "react";
import type { ArticleFormat } from "../../shared/editor-contract";
import { Icon } from "./Icons";

export interface NewArticleValues {
  title: string;
  path: string;
  format: ArticleFormat;
}

interface NewArticleDialogProps {
  open: boolean;
  busy?: boolean;
  error?: string | null;
  localMode?: boolean;
  initialDirectory?: string;
  onClose: () => void;
  onCreate: (values: NewArticleValues) => void;
}

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .trim()
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

export function NewArticleDialog({
  open,
  busy = false,
  error,
  localMode = false,
  initialDirectory = "src/content",
  onClose,
  onCreate,
}: NewArticleDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const [title, setTitle] = useState("");
  const [path, setPath] = useState("");
  const [format, setFormat] = useState<ArticleFormat>("md");
  const [pathTouched, setPathTouched] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      requestAnimationFrame(() => titleRef.current?.focus());
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      setTitle("");
      setPath("");
      setFormat("md");
      setPathTouched(false);
    }
  }, [open]);

  const updateTitle = (nextTitle: string) => {
    setTitle(nextTitle);
    if (!pathTouched) {
      const slug = slugify(nextTitle) || "untitled";
      setPath(`${initialDirectory.replace(/\/$/, "")}/${slug}.${format}`);
    }
  };

  const updateFormat = (nextFormat: ArticleFormat) => {
    setFormat(nextFormat);
    setPath((current) => current.replace(/\.mdx?$/i, `.${nextFormat}`));
  };

  return (
    <dialog
      ref={dialogRef}
      className="new-article-dialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onClose={() => {
        if (open && !busy) onClose();
      }}
    >
      <form
        method="dialog"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy || !title.trim() || !path.trim()) return;
          onCreate({ title: title.trim(), path: path.trim(), format });
        }}
      >
        <header>
          <span className="dialog-icon"><Icon name="article" size={22} /></span>
          <div>
            <span className="eyebrow">New document</span>
            <h2 id={`${id}-title`}>创建一篇新文章</h2>
            <p id={`${id}-description`}>先保存到 CMS，推送时由 Studio {localMode ? "写入本地内容目录" : "检查远端后安全更新主分支"}。</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} disabled={busy} aria-label="关闭">
            <Icon name="close" />
          </button>
        </header>

        <div className="dialog-fields">
          <label className="form-field" htmlFor={`${id}-new-title`}>
            <span>文章标题</span>
            <input
              ref={titleRef}
              id={`${id}-new-title`}
              value={title}
              onChange={(event) => updateTitle(event.target.value)}
              placeholder="例如：在回声里寻找答案"
              required
              disabled={busy}
            />
          </label>

          <fieldset className="format-picker">
            <legend>文档格式</legend>
            <label className={format === "md" ? "is-selected" : ""}>
              <input
                type="radio"
                name="format"
                value="md"
                checked={format === "md"}
                onChange={() => updateFormat("md")}
                disabled={busy}
              />
              <span><strong>Markdown</strong><small>通用写作，完整预览</small></span>
              <Icon name="check" />
            </label>
            <label className={format === "mdx" ? "is-selected" : ""}>
              <input
                type="radio"
                name="format"
                value="mdx"
                checked={format === "mdx"}
                onChange={() => updateFormat("mdx")}
                disabled={busy}
              />
              <span><strong>MDX</strong><small>组件与 JSX</small></span>
              <Icon name="check" />
            </label>
          </fieldset>

          <label className="form-field" htmlFor={`${id}-new-path`}>
            <span>仓库路径</span>
            <div className="path-input">
              <Icon name="file" size={15} />
              <input
                id={`${id}-new-path`}
                value={path}
                onChange={(event) => {
                  setPathTouched(true);
                  setPath(event.target.value);
                }}
                spellCheck={false}
                required
                disabled={busy}
              />
            </div>
          </label>

          {error ? <p className="dialog-error" role="alert"><Icon name="warning" />{error}</p> : null}
        </div>

        <footer>
          <button className="button button--ghost" type="button" onClick={onClose} disabled={busy}>取消</button>
          <button className="button button--primary" type="submit" disabled={busy || !title.trim() || !path.trim()}>
            {busy ? <span className="spinner" aria-hidden="true" /> : <Icon name="plus" />}
            {busy ? "正在创建…" : "创建文章"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
