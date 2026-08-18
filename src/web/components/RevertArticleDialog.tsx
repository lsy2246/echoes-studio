import { useEffect, useId, useRef } from "react";
import type { ArticleSummary } from "../../shared/editor-contract";
import { Icon } from "./Icons";

interface RevertArticleDialogProps {
  article: ArticleSummary | null;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onConfirm: () => void;
}

export function RevertArticleDialog({
  article,
  busy = false,
  error,
  onClose,
  onConfirm,
}: RevertArticleDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const id = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (article && !dialog.open) dialog.showModal();
    else if (!article && dialog.open) dialog.close();
  }, [article]);

  const localOnly = Boolean(article && !article.publishedAt);
  const deleting = article?.syncStatus === "deleting";

  return (
    <dialog
      ref={dialogRef}
      className="delete-article-dialog revert-article-dialog"
      aria-labelledby={`${id}-title`}
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
      onClose={() => { if (article && !busy) onClose(); }}
    >
      <div className="delete-dialog__icon"><Icon name="refresh" size={21} /></div>
      <div className="delete-dialog__copy">
        <span className="eyebrow">Discard changes</span>
        <h2 id={`${id}-title`}>撤销“{article?.metadata.title || "无标题文章"}”的改动？</h2>
        <p>
          {localOnly
            ? "这篇文章从未推送，撤销后会从 CMS 中移除。"
            : deleting
              ? "将取消待删除状态，并恢复为最近一次从仓库拉取的版本。"
              : "将丢弃 CMS 中尚未推送的正文、元数据与移动操作，恢复为最近一次从仓库拉取的版本。"}
        </p>
        <code>{article?.path}</code>
        {error ? <p className="dialog-error" role="alert"><Icon name="warning" size={14} />{error}</p> : null}
      </div>
      <footer>
        <button className="button button--ghost" type="button" onClick={onClose} disabled={busy}>保留改动</button>
        <button className="button button--revert" type="button" onClick={onConfirm} disabled={busy}>
          {busy ? <span className="spinner" aria-hidden="true" /> : <Icon name="refresh" size={15} />}
          {localOnly ? "移除文章" : deleting ? "取消待删除" : "撤销改动"}
        </button>
      </footer>
    </dialog>
  );
}
