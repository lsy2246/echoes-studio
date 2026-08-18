import { useEffect, useMemo, useState } from "react";
import type { ContentConflict, ContentConflictResolution } from "../../shared/editor-contract";
import { Icon } from "./Icons";

interface ConflictCenterDialogProps {
  open: boolean;
  conflicts: ContentConflict[];
  busy: boolean;
  error?: string | null;
  onClose: () => void;
  onResolve: (id: string, input: {
    resolution: ContentConflictResolution;
    mergedSource?: string;
    mergedPath?: string;
  }) => void;
}

const KIND_LABEL: Record<ContentConflict["kind"], string> = {
  edit_edit: "两端都修改了文章",
  delete_edit: "仓库已删除，CMS 仍有修改",
  path_collision: "目标路径已被占用",
};

function conflictLabel(conflict: ContentConflict): string {
  return conflict.remoteCommitSha.startsWith("cms-draft-v")
    ? "另一台设备已先保存修改"
    : KIND_LABEL[conflict.kind];
}

export function ConflictCenterDialog({
  open, conflicts, busy, error, onClose, onResolve,
}: ConflictCenterDialogProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(
    () => conflicts.find((item) => item.id === selectedId) ?? conflicts[0] ?? null,
    [conflicts, selectedId],
  );
  const [mergedSource, setMergedSource] = useState("");
  const [mergedPath, setMergedPath] = useState("");

  useEffect(() => {
    if (!selected) return;
    setSelectedId(selected.id);
    setMergedSource(selected.draftSource);
    setMergedPath(selected.draftPath);
  }, [selected?.id]);

  if (!open) return null;
  return (
    <div className="dialog-backdrop conflict-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <section className="conflict-dialog" role="dialog" aria-modal="true" aria-labelledby="conflict-title">
        <header className="conflict-dialog__header">
          <div>
            <span>Safety center</span>
            <h2 id="conflict-title">冲突中心</h2>
            <p>任何一端都不会被静默覆盖。先比较共同版本、仓库版本和 CMS 修改，再明确选择结果。</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} disabled={busy} aria-label="关闭冲突中心">
            <Icon name="close" />
          </button>
        </header>

        {conflicts.length === 0 ? (
          <div className="conflict-empty"><Icon name="check" /><strong>没有待处理冲突</strong><p>仓库与 CMS 当前可以安全同步。</p></div>
        ) : (
          <div className="conflict-layout">
            <nav className="conflict-list" aria-label="冲突文章">
              {conflicts.map((item) => (
                <button key={item.id} type="button" className={item.id === selected?.id ? "is-active" : ""} onClick={() => setSelectedId(item.id)}>
                  <Icon name="warning" size={15} />
                  <span><strong>{item.draftPath.split("/").at(-1)}</strong><small>{conflictLabel(item)}</small></span>
                </button>
              ))}
            </nav>

            {selected ? (
              <div className="conflict-workspace">
                <div className="conflict-summary">
                  <span className="document-state-badge document-state-badge--conflict">CMS·有冲突</span>
                  <strong>{conflictLabel(selected)}</strong>
                  <code>{selected.remoteCommitSha.slice(0, 8)}</code>
                </div>
                <div className="conflict-columns">
                  <label><span><strong>共同版本</strong><small>{selected.basePath ?? "新文章，没有共同版本"}</small></span><textarea readOnly value={selected.baseSource ?? ""} /></label>
                  <label><span><strong>{selected.remoteCommitSha.startsWith("cms-draft-v") ? "已保存的 CMS 版本" : "仓库最新版本"}</strong><small>{selected.remotePath ?? "仓库中已删除"}</small></span><textarea readOnly value={selected.remoteSource ?? ""} /></label>
                  <label className="is-merge"><span><strong>合并结果</strong><small>默认使用当前 CMS 内容，可直接修改</small></span><input aria-label="合并后的文章路径" value={mergedPath} onChange={(event) => setMergedPath(event.target.value)} /><textarea aria-label="合并后的文章内容" value={mergedSource} onChange={(event) => setMergedSource(event.target.value)} /></label>
                </div>
                {error ? <p className="conflict-error" role="alert">{error}</p> : null}
                <footer className="conflict-actions">
                  <button className="button button--quiet" type="button" disabled={busy} onClick={() => onResolve(selected.id, { resolution: "remote" })}>{selected.remoteCommitSha.startsWith("cms-draft-v") ? "采用已保存版本" : "采用仓库版本"}</button>
                  <button className="button button--quiet" type="button" disabled={busy} onClick={() => onResolve(selected.id, { resolution: "cms" })}>采用 CMS 并推送</button>
                  <button className="button button--primary" type="button" disabled={busy || !mergedPath.trim()} onClick={() => onResolve(selected.id, { resolution: "merged", mergedSource, mergedPath })}>{busy ? "正在安全推送…" : "合并后推送"}</button>
                </footer>
              </div>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}
