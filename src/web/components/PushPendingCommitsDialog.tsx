import { useEffect, useRef } from "react";
import type { PendingCommit } from "../../shared/editor-contract";
import { Icon } from "./Icons";

interface PushPendingCommitsDialogProps {
  open: boolean;
  commits: PendingCommit[];
  branch: string;
  headCommit: string | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function PushPendingCommitsDialog({ open, commits, branch, headCommit, busy, onClose, onConfirm }: PushPendingCommitsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const articleCount = new Set(commits.flatMap((commit) => commit.changes.map((change) => change.articleId))).size;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={dialogRef} className="new-article-dialog push-pending-dialog" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }} onClose={() => { if (open && !busy) onClose(); }}>
      <form method="dialog" onSubmit={(event) => { event.preventDefault(); if (!busy) onConfirm(); }}>
        <header>
          <span className="dialog-icon"><Icon name="publish" size={22} /></span>
          <div>
            <span className="eyebrow">Push confirmation</span>
            <h2>确认推送到 {branch || "默认分支"}</h2>
            <p>这是唯一会更新远端仓库的操作。</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} disabled={busy} aria-label="关闭"><Icon name="close" /></button>
        </header>
        <div className="dialog-fields push-summary">
          <dl>
            <div><dt>本地提交</dt><dd>{commits.length} 个</dd></div>
            <div><dt>涉及文章</dt><dd>{articleCount} 篇</dd></div>
            <div><dt>远端基线</dt><dd><code>{headCommit?.slice(0, 8) || "未知"}</code></dd></div>
            <div><dt>构建触发</dt><dd>预计 1 次</dd></div>
          </dl>
          <p className="push-summary__note"><Icon name="warning" size={15} />队列将合并为一个远端 Git commit。推送成功后不能在 CMS 中直接撤销。</p>
        </div>
        <footer>
          <button className="button button--ghost" type="button" onClick={onClose} disabled={busy}>返回</button>
          <button className="button button--primary" type="submit" disabled={busy || commits.length === 0}>
            {busy ? <span className="spinner" /> : <Icon name="publish" />}{busy ? "正在推送…" : "确认推送"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
