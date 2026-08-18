import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "./Icons";

interface PublishArticleDialogProps {
  open: boolean;
  busy: boolean;
  articleTitles: string[];
  defaultMessage: string;
  branch: string;
  onClose: () => void;
  onConfirm: (commitMessage: string) => void;
}

export function PublishArticleDialog({
  open,
  busy,
  articleTitles,
  defaultMessage,
  branch,
  onClose,
  onConfirm,
}: PublishArticleDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  const [message, setMessage] = useState(defaultMessage);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setMessage(defaultMessage);
      dialog.showModal();
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [defaultMessage, open]);

  const normalized = message.trim();
  const invalid = normalized.length === 0 || normalized.length > 200;

  return (
    <dialog
      ref={dialogRef}
      className="new-article-dialog publish-article-dialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
      onClose={() => { if (open && !busy) onClose(); }}
    >
      <form
        method="dialog"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && !invalid) onConfirm(normalized);
        }}
      >
        <header>
          <span className="dialog-icon"><Icon name="publish" size={22} /></span>
          <div>
            <span className="eyebrow">Commit &amp; push</span>
            <h2 id={`${id}-title`}>{articleTitles.length > 1 ? `推送所选 ${articleTitles.length} 篇文章` : "推送当前文章"}</h2>
            <p id={`${id}-description`}>提交说明会显示在 Git 历史中，随后安全推送到 {branch || "目标分支"}。</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} disabled={busy} aria-label="关闭">
            <Icon name="close" />
          </button>
        </header>

        <div className="dialog-fields">
          <div className="publish-target-card">
            <span>{articleTitles.length > 1 ? "本次将合并为一个 commit" : "本次文章"}</span>
            <strong>{articleTitles.length > 1 ? `${articleTitles.length} 篇待同步文章` : articleTitles[0]}</strong>
            {articleTitles.length > 1 ? (
              <small className="publish-target-card__articles" title={articleTitles.join("、")}>
                {articleTitles.slice(0, 3).join("、")}{articleTitles.length > 3 ? ` 等 ${articleTitles.length} 篇` : ""}
              </small>
            ) : null}
            <code>{branch || "默认分支"}</code>
          </div>
          <label className="form-field" htmlFor={`${id}-commit-message`}>
            <span>提交说明</span>
            <textarea
              ref={inputRef}
              id={`${id}-commit-message`}
              value={message}
              maxLength={200}
              rows={3}
              disabled={busy}
              onChange={(event) => setMessage(event.target.value)}
              aria-invalid={invalid}
              placeholder="例如：更新文章的部署步骤"
            />
            <small>{message.length} / 200</small>
          </label>
          <p className={`dialog-hint${invalid ? "" : " dialog-hint--ready"}`} role="status">
            <Icon name={invalid ? "warning" : "check"} />
            {normalized ? "将使用这条说明创建 Git commit" : "请输入提交说明"}
          </p>
        </div>

        <footer>
          <button className="button button--ghost" type="button" onClick={onClose} disabled={busy}>取消</button>
          <button className="button button--primary" type="submit" disabled={busy || invalid}>
            {busy ? <span className="spinner" aria-hidden="true" /> : <Icon name="publish" />}
            {busy ? "正在推送…" : "提交并推送"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
