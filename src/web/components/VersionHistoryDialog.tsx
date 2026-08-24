import { useEffect, useMemo, useState } from "react";
import type { ArticleDocument, ArticleRevision } from "../../shared/editor-contract";
import { compactDiffLines, diffLines, splitDiffRows } from "../lib/line-diff";
import { Icon } from "./Icons";
import { SelectMenu } from "./SelectMenu";

interface VersionHistoryDialogProps {
  open: boolean;
  article: ArticleDocument | null;
  revisions: ArticleRevision[];
  loading?: boolean;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onRestore: (revision: ArticleRevision) => void;
}

const LABELS: Record<ArticleRevision["kind"], { title: string; detail: string }> = {
  repository: { title: "仓库版本", detail: "从内容仓库拉取" },
  autosave: { title: "自动快照", detail: "CMS 写作记录" },
  move: { title: "移动文章", detail: "文章路径发生变化" },
  publish: { title: "推送快照", detail: "推送仓库前保存" },
  restore: { title: "恢复版本", detail: "由历史版本生成待推送内容" },
  delete: { title: "删除前快照", detail: "标记待删除前保存" },
  create: { title: "创建文章", detail: "文章的第一个版本" },
};

function revisionLabel(revision: ArticleRevision): { title: string; detail: string } {
  if (revision.id.startsWith("baseline:")) {
    return { title: "接入时快照", detail: "接入 CMS 时保存的当前内容" };
  }
  if (revision.kind === "repository" && revision.gitCommitSha) {
    return {
      title: revision.gitCommitMessage?.trim() || "Git 提交",
      detail: `Git 提交 · ${revision.gitCommitSha.slice(0, 8)}`,
    };
  }
  return LABELS[revision.kind];
}

function dateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).format(date);
}

export function VersionHistoryDialog({
  open, article, revisions, loading = false, busy = false, error, onClose, onRestore,
}: VersionHistoryDialogProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [compareTargetId, setCompareTargetId] = useState("current");
  const [diffView, setDiffView] = useState<"split" | "unified">("split");
  const online = revisions.find((revision) => revision.kind === "repository") ?? null;
  useEffect(() => {
    if (open && revisions.length && !revisions.some((revision) => revision.id === selectedId)) {
      setSelectedId(revisions.find((revision) => revision.kind === "repository")?.id ?? revisions[0].id);
      setCompareTargetId("current");
    }
  }, [open, revisions, selectedId]);
  useEffect(() => {
    if (selectedId === compareTargetId) setCompareTargetId("current");
  }, [compareTargetId, selectedId]);
  const selected = revisions.find((revision) => revision.id === selectedId) ?? revisions[0] ?? null;
  const compareRevision = revisions.find((revision) => revision.id === compareTargetId) ?? null;
  const compareSource = compareRevision?.source ?? article?.source ?? "";
  const comparePath = compareRevision?.path ?? article?.path ?? "";
  const lines = useMemo(
    () => selected ? diffLines(selected.source, compareSource) : [],
    [selected, compareSource],
  );
  const visibleLines = useMemo(() => compactDiffLines(lines), [lines]);
  const additions = lines.filter((line) => line.type === "added").length;
  const removals = lines.filter((line) => line.type === "removed").length;
  const splitRows = useMemo(() => splitDiffRows(visibleLines), [visibleLines]);
  const hasChanges = additions > 0 || removals > 0 || Boolean(selected && selected.path !== comparePath);
  const sameAsCurrent = Boolean(
    selected && article && selected.contentHash === article.baseGitHash && selected.path === article.path && article.syncStatus === "synced",
  ) || Boolean(selected && article && selected.source === article.source && selected.path === article.path);

  if (!open) return null;
  return (
    <div className="dialog-backdrop history-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <section className="history-dialog" role="dialog" aria-modal="true" aria-labelledby="history-title">
        <header className="history-dialog__header">
          <div><span className="eyebrow">Version history</span><h2 id="history-title">版本历史</h2><p>{article?.metadata.title}</p></div>
          <button className="icon-button" type="button" onClick={onClose} disabled={busy} aria-label="关闭版本历史"><Icon name="close" /></button>
        </header>
        <div className="history-layout">
          <aside className="history-timeline" aria-label="版本时间线">
            <div className="history-current"><i /><span><strong>当前 CMS 内容</strong><small>{article?.syncStatus === "synced" ? "已与仓库同步" : "包含尚未推送的改动"}</small></span></div>
            {loading ? <div className="history-loading"><span className="spinner" />正在读取版本…</div> : revisions.map((revision) => (
              <button key={revision.id} type="button" className={revision.id === selected?.id ? "is-active" : ""} onClick={() => setSelectedId(revision.id)}>
                <i /><span><strong>{revision.id === online?.id ? "线上最新" : revisionLabel(revision).title}</strong><small>{dateTime(revision.createdAt)}</small><em>{revisionLabel(revision).detail}</em></span>
              </button>
            ))}
            {!loading && revisions.length === 0 ? <p className="history-empty">还没有历史快照。继续编辑或拉取仓库后会自动记录。</p> : null}
          </aside>
          <main className="history-diff">
            {selected ? <>
              <div className="history-diff__summary">
                <div><strong>{revisionLabel(selected).title}</strong><span>{selected.gitCommitSha ? `${selected.gitCommitSha.slice(0, 10)} · ` : ""}{selected.path}</span></div>
                <div className="history-diff__tools">
                  <SelectMenu<string>
                    className="history-compare-menu"
                    label="比较对象"
                    value={compareTargetId}
                    options={[
                      { value: "current", label: "当前 CMS 内容", detail: article?.syncStatus === "synced" ? "已同步" : "含未推送改动" },
                      ...revisions.filter((revision) => revision.id !== selected.id).map((revision) => ({
                        value: revision.id,
                        label: revision.id === online?.id ? "线上最新" : revisionLabel(revision).title,
                        detail: `${dateTime(revision.createdAt)} · ${revision.gitCommitSha?.slice(0, 8) ?? "CMS"}`,
                      })),
                    ]}
                    onChange={setCompareTargetId}
                  />
                  <div className="diff-stats"><b>+{additions}</b><b>−{removals}</b></div>
                  <div className="diff-view-switcher" role="group" aria-label="差异视图">
                    <button type="button" className={diffView === "split" ? "is-active" : ""} aria-pressed={diffView === "split"} onClick={() => setDiffView("split")}><span className="split-icon" />分屏</button>
                    <button type="button" className={diffView === "unified" ? "is-active" : ""} aria-pressed={diffView === "unified"} onClick={() => setDiffView("unified")}><Icon name="article" size={13} />合并</button>
                  </div>
                </div>
              </div>
              {selected.path !== comparePath ? <div className="path-diff"><span>路径</span><del>{selected.path}</del><ins>{comparePath}</ins></div> : null}
              {!hasChanges ? <div className="history-diff__unchanged"><Icon name="check" /><strong>两个版本内容一致</strong><span>没有可显示的 Markdown 或路径差异。</span></div> : diffView === "split" ? (
                <div className="diff-split" role="region" aria-label="Markdown 分屏差异" tabIndex={0}>
                  <div className="diff-split__head"><span>所选版本</span><span>{compareRevision ? revisionLabel(compareRevision).title : "当前 CMS"}</span></div>
                  <div className="diff-split__body">
                    {splitRows.map((row, index) => <div className="diff-split__row" key={index}>
                      <div className={`diff-side diff-side--${row.left?.omitted ? "omitted" : row.left?.type ?? "empty"}`}><span>{row.left?.omitted ? "" : row.left?.oldNumber ?? ""}</span><b>{row.left?.omitted ? "⋯" : row.left?.type === "removed" ? "−" : " "}</b><code>{row.left?.value || " "}</code></div>
                      <div className={`diff-side diff-side--${row.right?.omitted ? "omitted" : row.right?.type ?? "empty"}`}><span>{row.right?.omitted ? "" : row.right?.newNumber ?? ""}</span><b>{row.right?.omitted ? "⋯" : row.right?.type === "added" ? "+" : " "}</b><code>{row.right?.value || " "}</code></div>
                    </div>)}
                  </div>
                </div>
              ) : (
                <div className="diff-code" role="region" aria-label="Markdown 合并差异" tabIndex={0}>
                  {visibleLines.map((line, index) => <div key={`${index}:${line.type}`} className={`diff-line diff-line--${line.omitted ? "omitted" : line.type}`}>
                    <span>{line.omitted ? "" : line.oldNumber ?? ""}</span><span>{line.omitted ? "" : line.newNumber ?? ""}</span><b>{line.omitted ? "⋯" : line.type === "added" ? "+" : line.type === "removed" ? "−" : " "}</b><code>{line.value || " "}</code>
                  </div>)}
                </div>
              )}
            </> : <div className="history-empty history-empty--main">选择一个版本即可查看它与当前内容的差异。</div>}
          </main>
        </div>
        <footer className="history-dialog__footer">
          <span>{error ? <b role="alert">{error}</b> : "恢复后会生成待推送的 CMS 内容，不会立即写入仓库。"}</span>
          <div><button className="button button--ghost" type="button" onClick={onClose} disabled={busy}>关闭</button><button className="button button--primary" type="button" disabled={!selected || sameAsCurrent || busy} onClick={() => selected && onRestore(selected)}>{busy ? <span className="spinner" /> : <Icon name="history" size={15} />}{busy ? "正在恢复…" : sameAsCurrent ? "已是当前版本" : "恢复此版本"}</button></div>
        </footer>
      </section>
    </div>
  );
}
