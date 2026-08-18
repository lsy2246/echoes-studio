import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from "react";
import type {
  ArticleSummary,
  CmsSyncStatus,
  RepositoryStatus,
} from "../../shared/editor-contract";
import { Icon } from "./Icons";
import {
  articleFolderPaths,
  buildArticleTree,
  type ArticleFolderNode,
} from "../lib/article-tree";

interface ArticleSidebarProps {
  articles: ArticleSummary[];
  activeId: string | null;
  activeSaveState: "clean" | "dirty" | "saving" | "saved" | "error";
  loading: boolean;
  error?: string | null;
  onSelect: (article: ArticleSummary) => void;
  onNew: () => void;
  onNewInFolder: (folderPath: string) => void;
  onMoveArticle: (article: ArticleSummary, folderPath?: string) => void;
  onRevertArticle: (article: ArticleSummary) => void;
  onDeleteArticle: (article: ArticleSummary) => void;
  onRetry: () => void;
  onClose: () => void;
  onSettings: () => void;
  onLogout: () => void;
  repositoryStatus: RepositoryStatus | null;
  repositoryLoading: boolean;
  repositoryError?: string | null;
  syncingRepository: boolean;
  pushingRepository: boolean;
  onPullRepository: () => void;
  onPushCurrent: () => void;
  onPushSelected: (articleIds: string[]) => void;
  conflictCount: number;
}

type ArticleFilter = "all" | "pending" | "conflict";

const SYNC_LABEL: Record<CmsSyncStatus, string> = {
  synced: "已同步",
  unpublished: "待推送",
  deleting: "待删除",
  syncing: "同步中",
  conflict: "有冲突",
  error: "同步失败",
};

function formatRelativeTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "刚刚";
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return formatter.format(days, "day");
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(date);
}

interface ArticleTreeListProps {
  folders: ArticleFolderNode[];
  articles: ArticleSummary[];
  depth: number;
  activeId: string | null;
  activeSaveState: ArticleSidebarProps["activeSaveState"];
  expandedFolders: Set<string>;
  forceOpen: boolean;
  onToggleFolder: (path: string) => void;
  onSelect: (article: ArticleSummary) => void;
  onArticleContext: (event: MouseEvent<HTMLElement>, article: ArticleSummary) => void;
  onFolderContext: (event: MouseEvent<HTMLElement>, folderPath: string) => void;
  onArticleDrop: (event: DragEvent<HTMLElement>, folderPath: string) => void;
  dragTarget: string | null;
  onDragTarget: (folderPath: string) => void;
  selectionMode: boolean;
  selectedIds: Set<string>;
  selectableIds: Set<string>;
  onToggleArticleSelection: (event: MouseEvent<HTMLElement>, article: ArticleSummary) => void;
  onToggleFolderSelection: (articles: ArticleSummary[]) => void;
}

function nestedFolderArticles(folder: ArticleFolderNode): ArticleSummary[] {
  return [...folder.articles, ...folder.folders.flatMap(nestedFolderArticles)];
}

function ArticleTreeList({
  folders,
  articles,
  depth,
  activeId,
  activeSaveState,
  expandedFolders,
  forceOpen,
  onToggleFolder,
  onSelect,
  onArticleContext,
  onFolderContext,
  onArticleDrop,
  dragTarget,
  onDragTarget,
  selectionMode,
  selectedIds,
  selectableIds,
  onToggleArticleSelection,
  onToggleFolderSelection,
}: ArticleTreeListProps) {
  return (
    <ul className="article-tree__list">
      {folders.map((folder) => {
        const isOpen = forceOpen || expandedFolders.has(folder.path);
        const folderArticles = nestedFolderArticles(folder).filter((article) => selectableIds.has(article.id));
        const folderSelected = folderArticles.length > 0 && folderArticles.every((article) => selectedIds.has(article.id));
        const folderPartiallySelected = !folderSelected && folderArticles.some((article) => selectedIds.has(article.id));
        return (
          <li className="article-tree__folder" key={folder.path}>
            <button
              type="button"
              style={{ paddingInlineStart: `${8 + depth * 14}px` }}
              onClick={() => selectionMode && folderArticles.length > 0
                ? onToggleFolderSelection(folderArticles)
                : onToggleFolder(folder.path)}
              onContextMenu={(event) => onFolderContext(event, folder.path)}
              onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }}
              onDragEnter={() => onDragTarget(folder.path)}
              onDrop={(event) => onArticleDrop(event, folder.path)}
              className={`folder-row${dragTarget === folder.path ? " is-drop-target" : ""}`}
              aria-expanded={isOpen}
              aria-pressed={selectionMode ? folderSelected : undefined}
              title={folder.path}
            >
              <span className={`folder-row__chevron${isOpen ? " is-open" : ""}`}>
                <Icon name="chevron" size={13} />
              </span>
              {selectionMode ? (
                <span className={`article-select-box${folderSelected ? " is-selected" : ""}${folderPartiallySelected ? " is-partial" : ""}`} aria-hidden="true">
                  {folderSelected ? <Icon name="check" size={12} /> : folderPartiallySelected ? "−" : null}
                </span>
              ) : null}
              <Icon name="folder" size={15} />
              <span>{folder.name}</span>
              <small>{folder.articleCount}</small>
            </button>
            {isOpen ? (
              <ArticleTreeList
                folders={folder.folders}
                articles={folder.articles}
                depth={depth + 1}
                activeId={activeId}
                activeSaveState={activeSaveState}
                expandedFolders={expandedFolders}
                forceOpen={forceOpen}
                onToggleFolder={onToggleFolder}
                onSelect={onSelect}
                onArticleContext={onArticleContext}
                onFolderContext={onFolderContext}
                onArticleDrop={onArticleDrop}
                dragTarget={dragTarget}
                onDragTarget={onDragTarget}
                selectionMode={selectionMode}
                selectedIds={selectedIds}
                selectableIds={selectableIds}
                onToggleArticleSelection={onToggleArticleSelection}
                onToggleFolderSelection={onToggleFolderSelection}
              />
            ) : null}
          </li>
        );
      })}
      {articles.map((article) => (
        <li className="article-tree__article" key={article.id}>
          <button
            type="button"
            data-article-id={article.id}
            className={`${activeId === article.id ? "article-row is-active" : "article-row"}${selectedIds.has(article.id) ? " is-selected" : ""}${selectionMode && !selectableIds.has(article.id) ? " is-selection-disabled" : ""}`}
            style={{ paddingInlineStart: `${10 + depth * 14}px` }}
            onClick={(event) => selectionMode ? onToggleArticleSelection(event, article) : onSelect(article)}
            onContextMenu={(event) => onArticleContext(event, article)}
            draggable={!selectionMode}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("application/x-echoes-article", article.id);
              event.dataTransfer.setData("text/plain", article.path);
            }}
            aria-current={activeId === article.id ? "page" : undefined}
            aria-pressed={selectionMode ? selectedIds.has(article.id) : undefined}
            disabled={selectionMode && !selectableIds.has(article.id)}
            title={article.path}
          >
            {selectionMode ? (
              <span className={`article-select-box${selectedIds.has(article.id) ? " is-selected" : ""}`} aria-hidden="true">
                {selectedIds.has(article.id) ? <Icon name="check" size={12} /> : null}
              </span>
            ) : <span
              className={`status-dot status-dot--${
                activeId === article.id && activeSaveState === "dirty"
                  ? "unsaved"
                  : activeId === article.id && activeSaveState === "error"
                    ? "error"
                    : article.syncStatus
              }`}
              aria-hidden="true"
            />}
            <span className="article-row__content">
              <strong>{article.metadata.title || "无标题文章"}</strong>
              <span className="article-row__meta">
                <span className={`article-state article-state--${article.syncStatus}`}>
                  CMS·{
                    activeId === article.id && activeSaveState === "dirty" ? "未保存"
                      : activeId === article.id && activeSaveState === "saving" ? "保存中"
                      : activeId === article.id && activeSaveState === "error" ? "保存失败"
                      : SYNC_LABEL[article.syncStatus]
                  }
                </span>
                <time dateTime={article.updatedAt}>{formatRelativeTime(article.updatedAt)}</time>
              </span>
            </span>
            <span className="article-format">{article.format.toUpperCase()}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function ArticleSidebar({
  articles,
  activeId,
  activeSaveState,
  loading,
  error,
  onSelect,
  onNew,
  onNewInFolder,
  onMoveArticle,
  onRevertArticle,
  onDeleteArticle,
  onRetry,
  onClose,
  onSettings,
  onLogout,
  repositoryStatus,
  repositoryLoading,
  repositoryError,
  syncingRepository,
  pushingRepository,
  onPullRepository,
  onPushCurrent,
  onPushSelected,
  conflictCount,
}: ArticleSidebarProps) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ArticleFilter>("all");
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set());
  const [dragTarget, setDragTarget] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const lastSelectedIdRef = useRef<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    article?: ArticleSummary;
    folderPath: string;
  } | null>(null);
  const articleListRef = useRef<HTMLElement>(null);

  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("zh-CN");
    return articles.filter((article) => {
      const isLocallyChanged = article.syncStatus !== "synced"
        || (
          article.id === activeId
          && ["dirty", "saving", "error"].includes(activeSaveState)
        );
      const statusMatches = filter === "all"
        || (filter === "pending" ? isLocallyChanged
          : article.syncStatus === "conflict");
      const haystack = [
        article.metadata.title,
        article.path,
        article.metadata.summary,
        ...article.metadata.tags,
      ]
        .join(" ")
        .toLocaleLowerCase("zh-CN");
      return statusMatches && (!needle || haystack.includes(needle));
    });
  }, [activeId, activeSaveState, articles, filter, search]);

  const contentRoot = repositoryStatus?.contentRoot || "src/content";
  const articleTree = useMemo(
    () => buildArticleTree(filtered, contentRoot),
    [contentRoot, filtered],
  );

  useEffect(() => {
    const activeArticle = articles.find((article) => article.id === activeId);
    if (!activeArticle) return;
    const ancestorPaths = articleFolderPaths(activeArticle.path, contentRoot);
    setExpandedFolders((current) => {
      if (ancestorPaths.every((path) => current.has(path))) return current;
      return new Set([...current, ...ancestorPaths]);
    });
  }, [activeId, articles, contentRoot]);

  useEffect(() => {
    if (!activeId) return;
    const frame = requestAnimationFrame(() => {
      articleListRef.current
        ?.querySelector<HTMLElement>(`[data-article-id="${CSS.escape(activeId)}"]`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
    return () => cancelAnimationFrame(frame);
  }, [activeId, expandedFolders, filter, search]);

  const locateActiveArticle = () => {
    const activeArticle = articles.find((article) => article.id === activeId);
    if (!activeArticle) return;
    setSearch("");
    setFilter("all");
    const ancestorPaths = articleFolderPaths(activeArticle.path, contentRoot);
    setExpandedFolders((current) => new Set([...current, ...ancestorPaths]));
  };

  const toggleFolder = (path: string) => {
    setExpandedFolders((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
    };
  }, [contextMenu]);

  const openFolderMenu = (event: MouseEvent<HTMLElement>, folderPath: string) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ x: Math.min(event.clientX, window.innerWidth - 190), y: Math.min(event.clientY, window.innerHeight - 170), folderPath });
  };

  const openArticleMenu = (event: MouseEvent<HTMLElement>, article: ArticleSummary) => {
    event.preventDefault();
    event.stopPropagation();
    const folderPath = article.path.slice(0, article.path.lastIndexOf("/"));
    setContextMenu({ x: Math.min(event.clientX, window.innerWidth - 190), y: Math.min(event.clientY, window.innerHeight - 190), article, folderPath });
  };

  const dropArticle = (event: DragEvent<HTMLElement>, folderPath: string) => {
    event.preventDefault();
    const articleId = event.dataTransfer.getData("application/x-echoes-article");
    const article = articles.find((item) => item.id === articleId);
    setDragTarget(null);
    if (article) onMoveArticle(article, folderPath);
  };

  const pendingCount = articles.filter((article) =>
    article.syncStatus !== "synced"
    || (
      article.id === activeId
      && ["dirty", "saving", "error"].includes(activeSaveState)
    )
  ).length;
  const selectableArticles = articles.filter((article) =>
    article.syncStatus !== "conflict"
    && article.syncStatus !== "syncing"
    && (
      ["unpublished", "deleting", "error"].includes(article.syncStatus)
      || (
        article.id === activeId
        && ["dirty", "saving", "error"].includes(activeSaveState)
      )
    )
  );
  const selectableIds = new Set(selectableArticles.map((article) => article.id));

  useEffect(() => {
    setSelectedIds((current) => {
      const next = new Set([...current].filter((articleId) => selectableIds.has(articleId)));
      return next.size === current.size ? current : next;
    });
    if (selectableArticles.length === 0) setSelectionMode(false);
  }, [articles, activeId, activeSaveState]);

  const toggleArticleSelection = (event: MouseEvent<HTMLElement>, article: ArticleSummary) => {
    if (!selectableIds.has(article.id)) return;
    setSelectedIds((current) => {
      const next = new Set(current);
      if (event.shiftKey && lastSelectedIdRef.current) {
        const start = selectableArticles.findIndex((item) => item.id === lastSelectedIdRef.current);
        const end = selectableArticles.findIndex((item) => item.id === article.id);
        if (start >= 0 && end >= 0) {
          for (const item of selectableArticles.slice(Math.min(start, end), Math.max(start, end) + 1)) next.add(item.id);
        }
      } else if (next.has(article.id)) next.delete(article.id);
      else next.add(article.id);
      return next;
    });
    lastSelectedIdRef.current = article.id;
  };

  const toggleFolderSelection = (folderArticles: ArticleSummary[]) => {
    const ids = folderArticles.map((article) => article.id).filter((articleId) => selectableIds.has(articleId));
    setSelectedIds((current) => {
      const next = new Set(current);
      const allSelected = ids.length > 0 && ids.every((articleId) => next.has(articleId));
      for (const articleId of ids) allSelected ? next.delete(articleId) : next.add(articleId);
      return next;
    });
  };

  const enterSelectionMode = () => {
    setFilter("pending");
    setSelectionMode(true);
    setSelectedIds(new Set());
  };

  const leaveSelectionMode = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
    lastSelectedIdRef.current = null;
  };

  return (
    <aside className="article-sidebar" aria-label="文章导航">
      <div className="sidebar-brand">
        <div className="brand-mark" aria-hidden="true">E</div>
        <div className="brand-copy">
          <strong>Echoes Studio</strong>
          <span>Content workspace</span>
        </div>
        <button className="icon-button sidebar-settings" type="button" onClick={onSettings} aria-label="打开系统设置" title="系统设置">
          <Icon name="settings" />
        </button>
        <button className="icon-button sidebar-logout" type="button" onClick={onLogout} aria-label="退出登录" title="退出登录">
          <Icon name="logout" />
        </button>
        <button className="icon-button sidebar-close" type="button" onClick={onClose} aria-label="关闭文章列表">
          <Icon name="close" />
        </button>
      </div>

      <div className="sidebar-actions">
        <button className="new-article-button" type="button" onClick={onNew}>
          <Icon name="plus" />
          新建文章
          <kbd>N</kbd>
        </button>
        <label className="article-search">
          <span className="sr-only">搜索文章</span>
          <Icon name="search" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索标题、路径或标签"
          />
          {search ? (
            <button type="button" onClick={() => setSearch("")} aria-label="清除搜索">
              <Icon name="close" size={14} />
            </button>
          ) : null}
        </label>
      </div>

      <div className="article-filters" role="group" aria-label="筛选文章状态">
        {([
          ["all", "全部", articles.length],
          ["pending", "待同步", pendingCount],
          ["conflict", "冲突", conflictCount],
        ] as const).map(([value, label, count]) => (
          <button
            key={value}
            type="button"
            className={`${filter === value ? "is-active" : ""}${value === "pending" && count > 0 ? " has-pending" : ""}`}
            onClick={() => setFilter(value)}
            aria-pressed={filter === value}
          >
            {label}<span>{count}</span>
          </button>
        ))}
        <button
          className="article-locate-button"
          type="button"
          disabled={!activeId}
          onClick={locateActiveArticle}
          title="展开目录并滚动到当前文章"
        >
          <Icon name="article" size={13} />定位当前
        </button>
        {selectableArticles.length > 0 ? (
          <button
            className={`article-batch-mode-button${selectionMode ? " is-active" : ""}`}
            type="button"
            onClick={selectionMode ? leaveSelectionMode : enterSelectionMode}
            aria-pressed={selectionMode}
          >
            {selectionMode ? "取消选择" : "批量选择"}
          </button>
        ) : null}
      </div>

      <nav
        ref={articleListRef}
        className="article-list"
        aria-label="文章列表"
        onContextMenu={(event) => {
          if (event.target === event.currentTarget) openFolderMenu(event, contentRoot);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragTarget(null);
        }}
      >
        {selectionMode ? (
          <div className="batch-selection-bar" role="toolbar" aria-label="批量选择文章">
            <strong>已选 {selectedIds.size} 篇</strong>
            <button type="button" onClick={() => setSelectedIds(new Set(selectableArticles.map((article) => article.id)))}>全选待同步</button>
            {selectedIds.size > 0 ? <button type="button" onClick={() => setSelectedIds(new Set())}>清空</button> : null}
          </div>
        ) : null}
        {loading ? (
          <div className="sidebar-skeleton" aria-label="正在加载文章" aria-live="polite">
            {[0, 1, 2, 3, 4].map((item) => <span key={item} />)}
          </div>
        ) : error ? (
          <div className="sidebar-message" role="alert">
            <Icon name="warning" />
            <strong>文章加载失败</strong>
            <p>{error}</p>
            <button type="button" onClick={onRetry}><Icon name="refresh" />重试</button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="sidebar-message">
            <Icon name="file" />
            <strong>{articles.length === 0 ? "还没有文章" : "没有匹配结果"}</strong>
            <p>{articles.length === 0 ? "创建第一篇 Markdown 文章。" : "试试其他关键词或筛选条件。"}</p>
          </div>
        ) : (
          <div className="article-tree">
            <div
              className={`article-tree__root${dragTarget === contentRoot ? " is-drop-target" : ""}${selectionMode ? " is-selectable" : ""}`}
              title={contentRoot}
              onContextMenu={(event) => openFolderMenu(event, contentRoot)}
              onClick={() => { if (selectionMode) toggleFolderSelection(selectableArticles); }}
              onDragOver={(event) => { event.preventDefault(); setDragTarget(contentRoot); }}
              onDrop={(event) => dropArticle(event, contentRoot)}
            >
              {selectionMode ? (
                <span className={`article-select-box${selectedIds.size > 0 && selectedIds.size === selectableArticles.length ? " is-selected" : ""}${selectedIds.size > 0 && selectedIds.size < selectableArticles.length ? " is-partial" : ""}`} aria-hidden="true">
                  {selectedIds.size > 0 && selectedIds.size === selectableArticles.length ? <Icon name="check" size={12} /> : selectedIds.size > 0 ? "−" : null}
                </span>
              ) : null}
              <Icon name="folder" size={15} />
              <span>{contentRoot}</span>
              <small>{articleTree.articleCount}</small>
            </div>
            <ArticleTreeList
              folders={articleTree.folders}
              articles={articleTree.articles}
              depth={0}
              activeId={activeId}
              activeSaveState={activeSaveState}
              expandedFolders={expandedFolders}
              forceOpen={Boolean(search.trim())}
              onToggleFolder={toggleFolder}
              onSelect={onSelect}
              onArticleContext={openArticleMenu}
              onFolderContext={(event, folderPath) => openFolderMenu(event, `${contentRoot}/${folderPath}`)}
              onArticleDrop={(event, folderPath) => dropArticle(event, `${contentRoot}/${folderPath}`)}
              dragTarget={dragTarget}
              onDragTarget={setDragTarget}
              selectionMode={selectionMode}
              selectedIds={selectedIds}
              selectableIds={selectableIds}
              onToggleArticleSelection={toggleArticleSelection}
              onToggleFolderSelection={toggleFolderSelection}
            />
          </div>
        )}
      </nav>

      <section className="repository-card" aria-label="内容仓库同步">
        {repositoryError ? <p className="repository-error" role="alert">{repositoryError}</p> : null}

        <div className="repository-sync-actions" aria-label="仓库手动同步">
          <button
            className="repository-sync-button"
            type="button"
            onClick={onPullRepository}
            disabled={syncingRepository || pushingRepository || repositoryLoading || !repositoryStatus?.configured}
          >
            {syncingRepository ? <span className="spinner" aria-hidden="true" /> : <Icon name="refresh" size={14} />}
            {syncingRepository ? "拉取中…" : "拉取仓库"}
          </button>
          <button
            className="repository-sync-button repository-sync-button--push"
            type="button"
            onClick={onPushCurrent}
            disabled={selectionMode || syncingRepository || pushingRepository || repositoryLoading || !repositoryStatus?.configured || !activeId || !selectableIds.has(activeId)}
          >
            {pushingRepository ? <span className="spinner" aria-hidden="true" /> : <Icon name="publish" size={14} />}
            {pushingRepository ? "推送中…" : "推送当前"}
          </button>
          {selectionMode ? (
            <button
              className="repository-sync-button repository-sync-button--batch"
              type="button"
              onClick={() => {
                const ids = [...selectedIds];
                if (ids.length === 0) return;
                onPushSelected(ids);
              }}
              disabled={syncingRepository || pushingRepository || repositoryLoading || !repositoryStatus?.configured || selectedIds.size === 0}
            >
              <Icon name="publish" size={14} />推送所选<strong>{selectedIds.size}</strong>
            </button>
          ) : selectableArticles.length > 1 ? (
            <button
              className="repository-sync-button repository-sync-button--batch"
              type="button"
              onClick={enterSelectionMode}
              disabled={syncingRepository || pushingRepository || repositoryLoading || !repositoryStatus?.configured}
            >
              批量推送<strong>{selectableArticles.length}</strong>
            </button>
          ) : null}
        </div>
      </section>
      {contextMenu ? (
        <div
          className="article-context-menu"
          role="menu"
          aria-label={contextMenu.article ? `${contextMenu.article.metadata.title} 操作` : `${contextMenu.folderPath} 操作`}
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <header><Icon name={contextMenu.article ? "file" : "folder"} size={14} /><span>{contextMenu.article?.metadata.title ?? contextMenu.folderPath.split("/").at(-1)}</span></header>
          <button type="button" role="menuitem" onClick={() => { onNewInFolder(contextMenu.folderPath); setContextMenu(null); }}><Icon name="plus" size={15} />在此新建文章</button>
          {contextMenu.article ? (
            <>
              <button type="button" role="menuitem" onClick={() => { onMoveArticle(contextMenu.article!); setContextMenu(null); }}><Icon name="move" size={15} />移动文章…</button>
              {["unpublished", "deleting", "error"].includes(contextMenu.article.syncStatus) ? (
                <button
                  type="button"
                  role="menuitem"
                  disabled={contextMenu.article.id === activeId && (activeSaveState === "dirty" || activeSaveState === "saving")}
                  title={contextMenu.article.id === activeId && (activeSaveState === "dirty" || activeSaveState === "saving") ? "请等待当前编辑自动保存后再撤销" : undefined}
                  onClick={() => { onRevertArticle(contextMenu.article!); setContextMenu(null); }}
                ><Icon name="refresh" size={15} />撤销改动…</button>
              ) : null}
              <span className="context-menu-separator" />
              <button className="is-danger" type="button" role="menuitem" disabled={contextMenu.article.syncStatus === "deleting"} onClick={() => { onDeleteArticle(contextMenu.article!); setContextMenu(null); }}><Icon name="trash" size={15} />{contextMenu.article.syncStatus === "deleting" ? "已标记待删除" : "删除文章…"}</button>
            </>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}
