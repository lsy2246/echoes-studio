import { useEffect, useId, useRef } from "react";
import type { ArticleSummary } from "../../shared/editor-contract";
import { Icon } from "./Icons";

interface DeleteArticleDialogProps {
  article: ArticleSummary | null;
  busy?: boolean;
  error?: string | null;
  localMode?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function DeleteArticleDialog({
  article,
  busy = false,
  error,
  localMode = false,
  onClose,
  onConfirm,
}: DeleteArticleDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const id = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (article && !dialog.open) dialog.showModal();
    else if (!article && dialog.open) dialog.close();
  }, [article]);

  return (
    <dialog
      ref={dialogRef}
      className="delete-article-dialog"
      aria-labelledby={`${id}-title`}
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
      onClose={() => { if (article && !busy) onClose(); }}
    >
      <div className="delete-dialog__icon"><Icon name="trash" size={21} /></div>
      <div className="delete-dialog__copy">
        <span className="eyebrow">Delete article</span>
        <h2 id={`${id}-title`}>删除“{article?.metadata.title || "无标题文章"}”？</h2>
        <p>
          {article?.publishedAt
            ? `这一步只会标记为“待删除”，不会立即删除${localMode ? "本地文件" : "仓库文件"}。之后仍需点击“推送当前”确认。`
            : "这篇文章还没有推送到仓库，将直接从 CMS 中移除。"}
        </p>
        <code>{article?.path}</code>
        {error ? <p className="dialog-error" role="alert"><Icon name="warning" size={14} />{error}</p> : null}
      </div>
      <footer>
        <button className="button button--ghost" type="button" onClick={onClose} disabled={busy}>取消</button>
        <button className="button button--danger" type="button" onClick={onConfirm} disabled={busy}>
          {busy ? <span className="spinner" aria-hidden="true" /> : <Icon name="trash" size={15} />}
          {article?.publishedAt ? "标记待删除" : "删除文章"}
        </button>
      </footer>
    </dialog>
  );
}
