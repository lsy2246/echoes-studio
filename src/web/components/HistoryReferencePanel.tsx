import { useEffect, useMemo, useState } from "react";
import type { ArticleRevision } from "../../shared/editor-contract";
import { diffLines } from "../lib/line-diff";
import { Icon } from "./Icons";
import { SelectMenu } from "./SelectMenu";

interface HistoryReferencePanelProps {
  articleId: string;
  currentPath: string;
  currentSource: string;
  revisions: ArticleRevision[];
  loading?: boolean;
  error?: string | null;
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
  articleId, currentPath, currentSource, revisions, loading = false, error,
}: HistoryReferencePanelProps) {
  const preferred = useMemo(
    () => revisions.find((revision) => revision.source !== currentSource || revision.path !== currentPath) ?? revisions[0] ?? null,
    [currentPath, currentSource, revisions],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => { setSelectedId(preferred?.id ?? null); }, [articleId, preferred?.id]);
  const selected = revisions.find((revision) => revision.id === selectedId) ?? preferred;
  const lines = useMemo(() => selected ? diffLines(selected.source, currentSource) : [], [currentSource, selected]);
  const additions = lines.filter((line) => line.type === "added").length;
  const removals = lines.filter((line) => line.type === "removed").length;

  return (
    <aside className="history-reference" aria-label="历史改动参考">
      <div className="history-reference__picker">
        <span className="history-reference__label">参考版本</span>
        <SelectMenu<string>
          className="history-reference__version-menu"
          label="参考版本"
          value={selected?.id ?? ""}
          options={revisions.map((revision) => ({
            value: revision.id,
            label: revisionName(revision),
            detail: revision.kind === "repository" ? "Git 提交" : "CMS 快照",
          }))}
          disabled={loading || revisions.length === 0}
          onChange={setSelectedId}
        />
        {selected ? <div className="history-reference__meta"><span title={selected.path}>{selected.path}</span><b>+{additions}</b><b>−{removals}</b></div> : null}
      </div>
      {loading ? <div className="history-reference__empty"><span className="spinner" />正在读取真实 Git 历史…</div>
        : error ? <div className="history-reference__empty is-error"><Icon name="warning" />{error}</div>
        : !selected ? <div className="history-reference__empty">还没有可以参考的历史版本。</div>
        : <div className="history-reference__diff" tabIndex={0} aria-label="历史版本与当前内容的差异">
            {selected.path !== currentPath ? <div className="history-reference__path"><del>{selected.path}</del><ins>{currentPath}</ins></div> : null}
            {lines.map((line, index) => <div key={`${index}:${line.type}`} className={`history-reference__line history-reference__line--${line.type}`}>
              <span>{line.oldNumber ?? line.newNumber ?? ""}</span><b>{line.type === "added" ? "+" : line.type === "removed" ? "−" : " "}</b><code>{line.value || " "}</code>
            </div>)}
          </div>}
    </aside>
  );
}
