import { useEffect, useMemo, useRef, useState } from "react";
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
    action?: "save" | "publish";
  }) => void;
}

const ISSUE_LABEL: Record<ContentConflict["issues"][number], string> = {
  edit_edit: "文章内容有冲突",
  delete_edit: "仓库已删除，CMS 仍有修改",
  path_collision: "文章路径冲突",
};

const ISSUE_DESCRIPTION: Record<ContentConflict["issues"][number], string> = {
  edit_edit: "仓库版本和云端版本都产生了修改，请选择要保留的结果。",
  delete_edit: "仓库已删除文章，但 CMS 仍保留修改，请决定是否恢复。",
  path_collision: "目标路径已属于另一篇文章，请为当前文章选择新的保存位置。",
};

function isCmsDraftConflict(conflict: ContentConflict): boolean {
  return conflict.remoteCommitSha.startsWith("cms-draft-v");
}

function conflictLabel(conflict: ContentConflict): string {
  return isCmsDraftConflict(conflict)
    ? "另一台设备已先保存修改"
    : conflict.issues.map((issue) => ISSUE_LABEL[issue]).join(" · ");
}

function conflictDescription(conflict: ContentConflict): string {
  return isCmsDraftConflict(conflict)
    ? "另一台设备先保存了这篇草稿，请确认要保留的版本。"
    : conflict.issues.length > 1
      ? `检测到 ${conflict.issues.length} 个问题：路径与文章内容都发生了变化，请分别确认。`
      : ISSUE_DESCRIPTION[conflict.issues[0]];
}

function fileName(path: string): string {
  return path.split("/").at(-1) || path;
}

function splitPath(path: string): { directory: string; name: string } {
  const separator = path.lastIndexOf("/");
  return separator < 0
    ? { directory: "", name: path }
    : { directory: path.slice(0, separator), name: path.slice(separator + 1) };
}

function joinPath(directory: string, name: string): string {
  return directory ? `${directory}/${name}` : name;
}

function pathError(path: string, occupiedPath: string): string | null {
  if (!path) return "请填写文件名。";
  if (path !== path.trim()) return "路径开头或结尾不能有空格。";
  if (path.startsWith("/") || path.includes("\\")) return "请使用不以 / 开头的相对路径。";
  if (/[\u0000-\u001f\u007f]/.test(path)) return "路径包含不可用字符。";
  if (path.split("/").some((part) => !part || part === "." || part === "..")) return "目录或文件名不完整。";
  if (!/\.mdx?$/i.test(path)) return "文件名需要以 .md 或 .mdx 结尾。";
  if (path === occupiedPath) return "这个路径仍被占用，请修改目录或文件名。";
  return null;
}

function lineCount(source: string | null): number {
  if (source === null || source === "") return 0;
  return source.split("\n").length;
}

function VersionCard({
  title,
  hint,
  source,
  empty,
}: {
  title: string;
  hint: string;
  source: string | null;
  empty: string;
}) {
  return (
    <article className="conflict-version-card">
      <header>
        <span><strong>{title}</strong><small>{hint}</small></span>
        {source !== null ? <em>{lineCount(source)} 行</em> : null}
      </header>
      {source === null ? (
        <div className="conflict-version-card__empty"><Icon name="trash" size={18} /><span>{empty}</span></div>
      ) : (
        <textarea readOnly value={source} aria-label={`${title}内容，只读`} />
      )}
    </article>
  );
}

export function ConflictCenterDialog({
  open, conflicts, busy, error, onClose, onResolve,
}: ConflictCenterDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(
    () => conflicts.find((item) => item.id === selectedId) ?? conflicts[0] ?? null,
    [conflicts, selectedId],
  );
  const [mergedSource, setMergedSource] = useState("");
  const [pathDirectory, setPathDirectory] = useState("");
  const [pathName, setPathName] = useState("");
  const [sessionTotal, setSessionTotal] = useState(0);
  const [requestedAction, setRequestedAction] = useState<
    "remote" | "cms" | "merged" | null
  >(null);

  useEffect(() => {
    if (!selected) return;
    const path = splitPath(selected.draftPath);
    setSelectedId(selected.id);
    setMergedSource(selected.draftSource);
    setPathDirectory(path.directory);
    setPathName(path.name);
  }, [selected?.id]);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const frame = window.requestAnimationFrame(() => dialogRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      previouslyFocused?.focus();
    };
  }, [open]);

  useEffect(() => {
    setSessionTotal((current) => open ? Math.max(current, conflicts.length) : 0);
  }, [open, conflicts.length]);

  useEffect(() => {
    if (!busy) setRequestedAction(null);
  }, [busy]);

  const selectedIndex = selected
    ? Math.max(0, conflicts.findIndex((item) => item.id === selected.id))
    : 0;
  const mergedPath = joinPath(pathDirectory, pathName);
  const hasPathCollision = selected?.issues.includes("path_collision") ?? false;
  const occupiedPath = selected?.occupiedPath ?? selected?.draftPath ?? "";
  const mergedPathError = hasPathCollision
    ? pathError(mergedPath, occupiedPath)
    : null;
  const completedPercent = sessionTotal > 0
    ? ((sessionTotal - conflicts.length) / sessionTotal) * 100
    : 0;

  function handleDialogKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape" && !busy) {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), summary",
    ) ?? []).filter((element) => element.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable.at(-1)!;
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function keepRemote() {
    if (!selected) return;
    setRequestedAction("remote");
    onResolve(selected.id, { resolution: "remote" });
  }

  function keepCms() {
    if (!selected) return;
    setRequestedAction("cms");
    const path = selected.issues.includes("path_collision") ? mergedPath : undefined;
    onResolve(selected.id, {
      resolution: "cms",
      mergedPath: path,
      action: "save",
    });
  }

  function keepMerged() {
    if (!selected) return;
    setRequestedAction("merged");
    const path = selected.issues.includes("path_collision") ? mergedPath : undefined;
    onResolve(selected.id, {
      resolution: "merged",
      mergedSource,
      mergedPath: path,
      action: "save",
    });
  }

  if (!open) return null;
  return (
    <div className="dialog-backdrop conflict-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <section
        ref={dialogRef}
        className="conflict-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="conflict-title"
        aria-describedby="conflict-description"
        tabIndex={-1}
        onKeyDown={handleDialogKeyDown}
      >
        <header className="conflict-dialog__header">
          <div>
            <span>Content resolution</span>
            <h2 id="conflict-title">解决内容冲突</h2>
            <p id="conflict-description">逐篇比较版本并选择保留结果。操作只影响当前选中的文章。</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} disabled={busy} aria-label="关闭冲突处理">
            <Icon name="close" />
          </button>
        </header>

        {conflicts.length === 0 ? (
          <div className="conflict-empty"><Icon name="check" /><strong>所有冲突都已处理</strong><p>仓库与 CMS 当前可以安全同步。</p></div>
        ) : (
          <div className="conflict-layout">
            <nav className="conflict-list" aria-label="待处理冲突">
              <header className="conflict-list__header">
                <span>处理进度</span>
                <strong>{conflicts.length} 篇待确认</strong>
                <div aria-hidden="true"><i style={{ width: `${completedPercent}%` }} /></div>
              </header>
              <div className="conflict-list__items">
                {conflicts.map((item, index) => (
                  <button
                    key={item.id}
                    type="button"
                    className={item.id === selected?.id ? "is-active" : ""}
                    onClick={() => setSelectedId(item.id)}
                    aria-current={item.id === selected?.id ? "step" : undefined}
                  >
                    <span className="conflict-list__index">{String(index + 1).padStart(2, "0")}</span>
                    <span className="conflict-list__copy">
                      <strong>{fileName(item.draftPath)}</strong>
                      <small>{conflictLabel(item)}</small>
                    </span>
                    <Icon name="chevron" size={14} />
                  </button>
                ))}
              </div>
              <p><Icon name="check" size={14} />处理完成后会自动从列表移除</p>
            </nav>

            {selected ? (
              <div className="conflict-workspace">
                <div className="conflict-summary">
                  <div className="conflict-summary__copy">
                    <span>冲突 {selectedIndex + 1} / {conflicts.length}</span>
                    <h3>{fileName(selected.draftPath)}</h3>
                    <p>{conflictDescription(selected)}</p>
                  </div>
                  <div className="conflict-kind-list" aria-label={`检测到 ${selected.issues.length} 个问题`}>
                    {selected.issues.map((issue) => (
                      <span className="conflict-kind" key={issue}><Icon name="warning" size={14} />{ISSUE_LABEL[issue]}</span>
                    ))}
                  </div>
                </div>

                <section className="conflict-step" aria-labelledby="conflict-compare-title">
                  <header className="conflict-step__header">
                    <span>1</span>
                    <div><h4 id="conflict-compare-title">对照两个修改版本</h4><p>以下内容仅供比较，不会在这里被改动。</p></div>
                  </header>
                  <div className="conflict-compare">
                    <VersionCard
                      title={isCmsDraftConflict(selected) ? "已保存的云端版本" : "仓库版本"}
                      hint="外部变化 · 只读"
                      source={selected.remoteSource}
                      empty="仓库中已删除这篇文章"
                    />
                    <VersionCard title="云端版本" hint="CMS 中的修改 · 只读" source={selected.draftSource} empty="CMS 内容为空" />
                  </div>
                  <details className="conflict-base-version">
                    <summary><Icon name="history" size={14} /><span>查看共同版本</span><small>定位两边修改前的起点</small><Icon name="chevron" size={13} /></summary>
                    {selected.baseSource === null ? (
                      <p>这是一篇新文章，没有共同版本。</p>
                    ) : (
                      <textarea readOnly value={selected.baseSource} aria-label="共同版本内容，只读" />
                    )}
                  </details>
                </section>

                <section className="conflict-step conflict-step--result" aria-labelledby="conflict-result-title">
                  <header className="conflict-step__header">
                    <span>2</span>
                    <div><h4 id="conflict-result-title">编辑合并版本</h4><p>系统不会自动拼接内容。这里先带入云端版本，请对照两侧内容人工修改并确认。</p></div>
                    {mergedSource !== selected.draftSource ? (
                      <button type="button" className="conflict-reset" onClick={() => setMergedSource(selected.draftSource)} disabled={busy}>
                        <Icon name="refresh" size={13} />恢复云端版本
                      </button>
                    ) : null}
                  </header>

                  {hasPathCollision ? (
                    <fieldset className="conflict-path-editor">
                      <legend><Icon name="folder" size={15} />重新安排文章路径</legend>
                      <p>对照有问题的原路径，为这份内容填写新的保存位置。</p>
                      <div className="conflict-path-comparison">
                        <section className="conflict-path-version conflict-path-version--before" aria-label="调整前，路径已被占用">
                          <header><span>调整前</span><strong><Icon name="warning" size={12} />已占用</strong></header>
                          <div><code>{occupiedPath}</code></div>
                          <small>这条路径已经属于另一篇文章</small>
                        </section>

                        <span className="conflict-path-comparison__arrow" aria-hidden="true"><Icon name="chevron" size={14} /></span>

                        <section className={`conflict-path-version conflict-path-version--after ${mergedPathError ? "is-error" : "is-valid"}`} aria-label={`调整后，${mergedPathError ? "路径仍需修改" : "路径格式有效"}`}>
                          <header><span>调整后</span><strong>{mergedPathError ? "待修改" : <><Icon name="check" size={12} />格式有效</>}</strong></header>
                          <div className="conflict-path-editor__fields">
                            <label>
                              <span>目录 <small>可选</small></span>
                              <input value={pathDirectory} onChange={(event) => setPathDirectory(event.target.value)} placeholder="posts/2026" disabled={busy} />
                            </label>
                            <label>
                              <span>文件名</span>
                              <input
                                value={pathName}
                                onChange={(event) => setPathName(event.target.value)}
                                aria-invalid={Boolean(mergedPathError)}
                                aria-describedby="conflict-path-feedback"
                                placeholder="article.md"
                                disabled={busy}
                              />
                            </label>
                          </div>
                          <div id="conflict-path-feedback" className="conflict-path-feedback">
                            <code>{mergedPath || "等待填写新路径"}</code>
                            <small>{mergedPathError ?? "路径格式有效，发布时仍会检查是否被占用。"}</small>
                          </div>
                        </section>
                      </div>
                    </fieldset>
                  ) : null}

                  <label className="conflict-result-editor">
                    <span>合并版本 <small>{lineCount(mergedSource)} 行</small></span>
                    <textarea aria-label="合并版本内容" value={mergedSource} onChange={(event) => setMergedSource(event.target.value)} disabled={busy} />
                  </label>
                </section>

                {error ? <p className="conflict-error" role="alert">{error}</p> : null}
                <footer className="conflict-actions">
                  <div><strong>3&nbsp; 选择保留版本</strong><small>这里不会发布；云端或合并结果将保存为待发布</small></div>
                  <button className="button button--quiet" type="button" disabled={busy} onClick={keepRemote}>
                    {busy && requestedAction === "remote" ? "正在采用…" : "采用仓库"}
                  </button>
                  <button className="button button--quiet" type="button" disabled={busy || Boolean(mergedPathError)} onClick={keepCms}>
                    {busy && requestedAction === "cms" ? "正在采用…" : "采用云端版本"}
                  </button>
                  <button className="button button--primary" type="button" disabled={busy || Boolean(mergedPathError)} onClick={keepMerged}>
                    {busy && requestedAction === "merged" ? "正在采用…" : "采用合并版本"}
                  </button>
                </footer>
              </div>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}
