import { useEffect, useRef } from "react";
import type { PendingCommit } from "../../shared/editor-contract";
import { Icon } from "./Icons";

interface PendingCommitsDrawerProps {
  open: boolean;
  commits: PendingCommit[];
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onUndoLatest: (id: string) => void;
  onPush: () => void;
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function PendingCommitsDrawer({
  open,
  commits,
  busy,
  error,
  onClose,
  onUndoLatest,
  onPush,
}: PendingCommitsDrawerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const latest = commits.at(-1);
  const articleCount = new Set(
    commits.flatMap((commit) => commit.changes.map((change) => change.articleId)),
  ).size;

  return (
    <dialog
      ref={dialogRef}
      className="pending-commits-drawer"
      aria-labelledby="pending-commits-title"
      onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
      onClose={() => { if (open && !busy) onClose(); }}
    >
      <header>
        <div>
          <span className="eyebrow">Pending push</span>
          <h2 id="pending-commits-title">待推送队列</h2>
          <p>{commits.length} 个提交，涉及 {articleCount} 篇文章</p>
        </div>
        <button className="icon-button" type="button" onClick={onClose} disabled={busy} aria-label="关闭待推送队列">
          <Icon name="close" />
        </button>
      </header>

      <div className="pending-commits-list">
        {commits.length === 0 ? (
          <div className="pending-commits-empty">
            <Icon name="check" size={24} />
            <strong>队列是空的</strong>
            <span>提交文章后会出现在这里。</span>
          </div>
        ) : commits.map((commit, index) => (
          <article className="pending-commit-row" key={commit.id}>
            <div className="pending-commit-row__rail"><i /><span /></div>
            <div className="pending-commit-row__body">
              <header>
                <strong>{commit.message}</strong>
                <time dateTime={commit.createdAt}>{formatTime(commit.createdAt)}</time>
              </header>
              <ul>
                {commit.changes.map((change) => (
                  <li key={`${commit.id}:${change.articleId}`}>
                    <Icon name={change.operation === "delete" ? "trash" : "file"} size={13} />
                    <span>{change.articleTitle}</span>
                    <small>{change.operation === "delete" ? "删除" : "更新"}</small>
                  </li>
                ))}
              </ul>
              {commit.id === latest?.id ? (
                <button className="pending-commit-undo" type="button" disabled={busy} onClick={() => onUndoLatest(commit.id)}>
                  <Icon name="refresh" size={14} />撤销这次提交
                </button>
              ) : <small className="pending-commit-order">提交 {index + 1}</small>}
            </div>
          </article>
        ))}
      </div>

      <footer>
        <span>推送时合并为 1 个远端 commit，预计触发 1 次构建</span>
        <button className="button button--primary" type="button" disabled={busy || commits.length === 0} onClick={onPush}>
          <Icon name="publish" />推送 {commits.length} 个提交
        </button>
      </footer>
      {error ? <p className="dialog-error" role="alert">{error}</p> : null}
    </dialog>
  );
}
