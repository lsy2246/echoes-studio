import { useEffect, useMemo, useState } from "react";
import type { ArticleRevision } from "../../shared/editor-contract";
import { compactDiffLines, diffLines } from "../lib/line-diff";
import { Icon } from "./Icons";
import { SelectMenu } from "./SelectMenu";

interface HistoryReferencePanelProps {
  articleId: string;
  currentPath: string;
  currentSource: string;
  revisions: ArticleRevision[];
  published: boolean;
  loading?: boolean;
  error?: string | null;
  onOpenHistory: () => void;
}

function revisionName(revision: ArticleRevision): string {
  const time = new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(new Date(revision.createdAt));
  if (revision.kind === "repository" && revision.gitCommitSha) {
    return `${time} · ${revision.gitCommitMessage?.trim() || "仓库提交"}`;
  }
  const kind = revision.kind === "autosave" ? "自动快照"
    : revision.kind === "publish" ? "推送快照"
    : revision.kind === "move" ? "移动文章"
    : revision.kind === "restore" ? "恢复版本"
    : revision.kind === "create" ? "创建文章"
    : revision.kind === "delete" ? "删除前"
    : "接入快照";
  return `${time} · ${kind}`;
}

export function HistoryReferencePanel({
  articleId, currentPath, currentSource, revisions, published, loading = false, error, onOpenHistory,
}: HistoryReferencePanelProps) {
  const online = useMemo(
    () => revisions.find((revision) => revision.kind === "repository") ?? null,
    [revisions],
  );
  const preferred = useMemo(
    () => online ?? revisions.find((revision) => revision.source !== currentSource || revision.path !== currentPath) ?? revisions[0] ?? null,
    [currentPath, currentSource, online, revisions],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => { setSelectedId(preferred?.id ?? null); }, [articleId, preferred?.id]);
  const selected = revisions.find((revision) => revision.id === selectedId) ?? preferred;
  const lines = useMemo(() => selected ? diffLines(selected.source, currentSource) : [], [currentSource, selected]);
  const visibleLines = useMemo(() => compactDiffLines(lines), [lines]);
  const additions = lines.filter((line) => line.type === "added").length;
  const removals = lines.filter((line) => line.type === "removed").length;
  const changed = additions > 0 || removals > 0 || Boolean(selected && selected.path !== currentPath);

  return (
    <aside className="history-reference" aria-label="历史改动参考">
      <div className="history-reference__picker">
        <span className="history-reference__label">对比基准</span>
        <SelectMenu<string>
          className="history-reference__version-menu"
          label="对比基准"
          value={selected?.id ?? ""}
          options={revisions.map((revision) => ({
            value: revision.id,
            label: revision.id === online?.id ? `线上最新 · ${revisionName(revision)}` : revisionName(revision),
            detail: revision.id === online?.id ? "当前仓库版本" : revision.kind === "repository" ? "Git 提交" : "CMS 快照",
          }))}
          disabled={loading || revisions.length === 0}
          onChange={setSelectedId}
        />
        {selected ? <div className="history-reference__meta"><span title={selected.path}>{selected.path}</span><b>+{additions}</b><b>−{removals}</b></div> : null}
      </div>
      {loading ? <div className="history-reference__empty"><span className="spinner" />正在读取真实 Git 历史…</div>
        : error ? <div className="history-reference__empty is-error"><Icon name="warning" />{error}</div>
        : !selected ? <div className="history-reference__empty">{published ? "暂时无法读取线上版本，请检查仓库连接。" : "这篇文章还没有发布，暂无线上版本可比较。"}</div>
        : !changed ? <div className="history-reference__empty is-synced"><Icon name="check" />当前内容与所选版本一致，没有未推送改动。</div>
        : <div className="history-reference__diff" tabIndex={0} aria-label="历史版本与当前内容的差异">
            {selected.path !== currentPath ? <div className="history-reference__path"><del>{selected.path}</del><ins>{currentPath}</ins></div> : null}
            {visibleLines.map((line, index) => <div key={`${index}:${line.type}`} className={`history-reference__line history-reference__line--${line.omitted ? "omitted" : line.type}`}>
              <span>{line.omitted ? "" : line.oldNumber ?? line.newNumber ?? ""}</span><b>{line.omitted ? "⋯" : line.type === "added" ? "+" : line.type === "removed" ? "−" : " "}</b><code>{line.value || " "}</code>
            </div>)}
          </div>}
      <footer>
        <button className="button button--ghost" type="button" onClick={onOpenHistory} disabled={loading || revisions.length === 0}>
          <Icon name="history" size={15} />查看完整版本历史
        </button>
      </footer>
    </aside>
  );
}
