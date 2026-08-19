import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ArticleDocument,
  ArticleMetadata,
  ArticleRevision,
  ArticleSummary,
  AutomationSettings,
  CmsApiClient,
  ContentConflict,
  ContentConflictResolution,
  EditorDiagnostic,
  EditorView,
  MarkdownEditorDriver,
  RepositoryConnectionTestResult,
  RepositoryStatus,
} from "../shared/editor-contract";
import { CmsApiError, FetchCmsApiClient } from "./api-client";
import { ArticleSidebar } from "./components/ArticleSidebar";
import { ConflictCenterDialog } from "./components/ConflictCenterDialog";
import { DeleteArticleDialog } from "./components/DeleteArticleDialog";
import { HistoryReferencePanel } from "./components/HistoryReferencePanel";
import { Icon } from "./components/Icons";
import { LoginScreen } from "./components/LoginScreen";
import { MetadataPanel } from "./components/MetadataPanel";
import { MdxPreview } from "./components/MdxPreview";
import { MoveArticleDialog } from "./components/MoveArticleDialog";
import { PublishArticleDialog } from "./components/PublishArticleDialog";
import { RevertArticleDialog } from "./components/RevertArticleDialog";
import { SetupScreen, type SetupValues } from "./components/SetupScreen";
import { SystemSettingsDialog } from "./components/SystemSettingsDialog";
import { VersionHistoryDialog } from "./components/VersionHistoryDialog";
import {
  NewArticleDialog,
  type NewArticleValues,
} from "./components/NewArticleDialog";
import { CherryEditor } from "./editor/CherryEditor";
import {
  createArticleSource,
  parseArticleSource,
  writeMetadataToSource,
} from "./lib/frontmatter";
import { validateSource } from "./lib/mdx";

const ALLOW_UNAUTHENTICATED =
  import.meta.env.VITE_CMS_ALLOW_UNAUTHENTICATED === "true";
const DEFAULT_AUTOMATION_SETTINGS: AutomationSettings = {
  autoSaveSeconds: 1,
  autoSyncMinutes: 15,
  lastAutoSyncAt: null,
  updatedAt: new Date(0).toISOString(),
};

type SaveState = "clean" | "dirty" | "saving" | "saved" | "error";
type MobilePane = "write" | "preview";

interface CmsAppProps {
  apiClient?: CmsApiClient;
}

function isUnauthorized(error: unknown): boolean {
  return error instanceof CmsApiError && error.status === 401;
}

async function authRequest(
  path: "/api/auth/login" | "/api/auth/logout",
  password?: string,
): Promise<void> {
  const response = await fetch(path, {
    method: "POST",
    headers:
      password === undefined
        ? undefined
        : { "content-type": "application/json" },
    body: password === undefined ? undefined : JSON.stringify({ password }),
  });
  if (response.ok) return;
  let message = "登录服务暂时不可用，请稍后重试。";
  try {
    const payload = (await response.json()) as { error?: { message?: string } };
    if (payload.error?.message) message = payload.error.message;
  } catch {
    // Keep the stable localized fallback for malformed upstream responses.
  }
  throw new CmsApiError(message, response.status);
}

async function setupStatusRequest(): Promise<{
  required: boolean;
  database: string;
}> {
  const response = await fetch("/api/setup/status", {
    headers: { accept: "application/json" },
  });
  if (response.ok) {
    const payload = (await response.json()) as {
      data: { required: boolean; database: string };
    };
    return payload.data;
  }
  throw new CmsApiError(
    "无法读取初始化状态，请检查数据库连接。",
    response.status,
  );
}

async function initializeRequest(values: SetupValues): Promise<void> {
  const response = await fetch("/api/setup/initialize", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(values),
  });
  if (response.ok) return;
  let message = "初始化失败，请检查仓库地址、Token 和数据库连接。";
  try {
    const payload = (await response.json()) as { error?: { message?: string } };
    if (payload.error?.message) message = payload.error.message;
  } catch {
    // Keep the localized fallback for non-JSON platform errors.
  }
  throw new CmsApiError(message, response.status);
}

async function testSetupRepositoryRequest(input: {
  provider: "github" | "gitee";
  repositoryUrl: string;
  repositoryToken: string;
  branch: string;
  contentRoot: string;
}): Promise<RepositoryConnectionTestResult> {
  const response = await fetch("/api/setup/repository/test", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (response.ok) {
    const payload = (await response.json()) as {
      data: RepositoryConnectionTestResult;
    };
    return payload.data;
  }
  let message = "连接失败，请检查仓库地址、Token 和权限。";
  try {
    const payload = (await response.json()) as { error?: { message?: string } };
    if (payload.error?.message) message = payload.error.message;
  } catch {
    // Keep the localized fallback for non-JSON platform errors.
  }
  throw new CmsApiError(message, response.status);
}

function errorMessage(error: unknown): string {
  if (error instanceof CmsApiError) return error.message;
  if (error instanceof Error && /[\u3400-\u9fff]/u.test(error.message))
    return error.message;
  return "操作失败，请稍后重试；如果问题持续，请查看本地服务日志。";
}

function today(): string {
  const date = new Date();
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function updateArticleSummary(
  articles: ArticleSummary[],
  document: ArticleDocument,
): ArticleSummary[] {
  const summary: ArticleSummary = document;
  const exists = articles.some((article) => article.id === document.id);
  return exists
    ? articles.map((article) =>
        article.id === document.id ? summary : article,
      )
    : [summary, ...articles];
}

function formatRepositoryCheckTime(value: string | null | undefined): string {
  if (!value) return "尚未同步";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚同步";
  const elapsedSeconds = Math.round((date.getTime() - Date.now()) / 1000);
  const relative = new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" });
  if (Math.abs(elapsedSeconds) < 60)
    return relative.format(elapsedSeconds, "second");
  const minutes = Math.round(elapsedSeconds / 60);
  if (Math.abs(minutes) < 60) return relative.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relative.format(hours, "hour");
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function CmsApp({ apiClient }: CmsAppProps) {
  const [authenticated, setAuthenticated] = useState(
    Boolean(apiClient || ALLOW_UNAUTHENTICATED),
  );
  const [authChecking, setAuthChecking] = useState(
    !apiClient && !ALLOW_UNAUTHENTICATED,
  );
  const [setupRequired, setSetupRequired] = useState(false);
  const [setupDatabase, setSetupDatabase] = useState<string>();
  const [authError, setAuthError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [articles, setArticles] = useState<ArticleSummary[]>([]);
  const [activeArticle, setActiveArticle] = useState<ArticleDocument | null>(
    null,
  );
  const [source, setSource] = useState("");
  const [path, setPath] = useState("");
  const [metadata, setMetadata] = useState<ArticleMetadata>({
    title: "",
    date: today(),
    tags: [],
    summary: "",
  });
  const [diagnostics, setDiagnostics] = useState<EditorDiagnostic[]>([]);
  const [loadingArticles, setLoadingArticles] = useState(false);
  const [loadingArticle, setLoadingArticle] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("clean");
  const [publishing, setPublishing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeUrl, setNoticeUrl] = useState<string | null>(null);
  const [repositoryStatus, setRepositoryStatus] =
    useState<RepositoryStatus | null>(null);
  const [repositoryLoading, setRepositoryLoading] = useState(false);
  const [repositoryError, setRepositoryError] = useState<string | null>(null);
  const [syncingRepository, setSyncingRepository] = useState(false);
  const [automationSettings, setAutomationSettings] = useState(
    DEFAULT_AUTOMATION_SETTINGS,
  );
  const [automationSaving, setAutomationSaving] = useState(false);
  const [conflicts, setConflicts] = useState<ContentConflict[]>([]);
  const [conflictCenterOpen, setConflictCenterOpen] = useState(false);
  const [conflictBusy, setConflictBusy] = useState(false);
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [metadataOpen, setMetadataOpen] = useState(false);
  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const [newArticleDirectory, setNewArticleDirectory] = useState("src/content");
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const [publishTargetIds, setPublishTargetIds] = useState<string[]>([]);
  const [deleteCandidate, setDeleteCandidate] = useState<ArticleSummary | null>(
    null,
  );
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [revertCandidate, setRevertCandidate] = useState<ArticleSummary | null>(
    null,
  );
  const [revertBusy, setRevertBusy] = useState(false);
  const [revertError, setRevertError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyReferenceOpen, setHistoryReferenceOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [revisions, setRevisions] = useState<ArticleRevision[]>([]);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [view, setView] = useState<EditorView>("edit&preview");
  const [mobilePane, setMobilePane] = useState<MobilePane>("write");
  const [isMobile, setIsMobile] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 799px)").matches,
  );
  const editorRef = useRef<MarkdownEditorDriver | null>(null);
  const sourceRef = useRef(source);
  const pathRef = useRef(path);
  const activeIdRef = useRef<string | null>(null);
  const activeArticleRef = useRef<ArticleDocument | null>(null);
  const saveInFlightRef = useRef<Promise<boolean> | null>(null);
  const flushDraftRef = useRef<() => Promise<boolean>>(async () => true);
  const changeRevisionRef = useRef(0);
  const lastSavedRevisionRef = useRef(0);

  sourceRef.current = source;
  pathRef.current = path;

  const client = useMemo<CmsApiClient>(() => {
    if (apiClient) return apiClient;
    return new FetchCmsApiClient();
  }, [apiClient]);

  const localRepository = repositoryStatus?.provider === "filesystem";
  const effectiveView: EditorView = historyReferenceOpen
    ? "editOnly"
    : isMobile
      ? mobilePane === "preview"
        ? "previewOnly"
        : "editOnly"
      : view;

  const handleUnauthorized = useCallback(
    (message: string | null = "登录状态无效，请重新登录。") => {
      if (apiClient || ALLOW_UNAUTHENTICATED) return false;
      setAuthenticated(false);
      setAuthError(message);
      setArticles([]);
      setActiveArticle(null);
      setRepositoryStatus(null);
      activeArticleRef.current = null;
      return true;
    },
    [apiClient],
  );

  const loadArticle = useCallback(
    async (article: ArticleSummary) => {
      if (article.id === activeIdRef.current && activeArticle) {
        setSidebarOpen(false);
        return;
      }
      if (saveState === "dirty" || saveState === "saving") {
        const saved = await flushDraftRef.current();
        if (!saved) {
          setWorkspaceError("自动保存失败，已留在当前文章以避免丢失修改。");
          return;
        }
      }
      setLoadingArticle(true);
      setWorkspaceError(null);
      try {
        const document = await client.getArticle(article.id);
        activeIdRef.current = document.id;
        activeArticleRef.current = document;
        setActiveArticle(document);
        setSource(document.source);
        setPath(document.path);
        const parsed = parseArticleSource(document.source, document.metadata);
        setMetadata(parsed.metadata);
        setDiagnostics(validateSource(document.source));
        setSaveState("clean");
        changeRevisionRef.current = 0;
        lastSavedRevisionRef.current = 0;
        setView("edit&preview");
        setMobilePane("write");
        setHistoryReferenceOpen(false);
        setSidebarOpen(false);
      } catch (error) {
        if (!isUnauthorized(error) || !handleUnauthorized()) {
          setWorkspaceError(errorMessage(error));
        }
      } finally {
        setLoadingArticle(false);
      }
    },
    [activeArticle, client, handleUnauthorized, saveState],
  );

  const loadArticles = useCallback(
    async (selectFirst = true): Promise<boolean> => {
      setLoadingArticles(true);
      setListError(null);
      try {
        const items = await client.listArticles();
        setArticles(items);
        if (selectFirst && !activeIdRef.current && items[0]) {
          const first = await client.getArticle(items[0].id);
          activeIdRef.current = first.id;
          activeArticleRef.current = first;
          setActiveArticle(first);
          setSource(first.source);
          setPath(first.path);
          const parsed = parseArticleSource(first.source, first.metadata);
          setMetadata(parsed.metadata);
          setDiagnostics(validateSource(first.source));
          setView("edit&preview");
          changeRevisionRef.current = 0;
          lastSavedRevisionRef.current = 0;
        }
        return true;
      } catch (error) {
        if (
          isUnauthorized(error) &&
          handleUnauthorized("密码错误，请重新输入。")
        ) {
          return false;
        }
        setListError(errorMessage(error));
        return false;
      } finally {
        setLoadingArticles(false);
      }
    },
    [client, handleUnauthorized],
  );

  const loadRepositoryStatus = useCallback(async (): Promise<boolean> => {
    setRepositoryLoading(true);
    setRepositoryError(null);
    try {
      const status = await client.getRepositoryStatus();
      setRepositoryStatus(status);
      return true;
    } catch (error) {
      if (
        isUnauthorized(error) &&
        handleUnauthorized("密码错误，请重新输入。")
      ) {
        return false;
      }
      setRepositoryError(errorMessage(error));
      return false;
    } finally {
      setRepositoryLoading(false);
    }
  }, [client, handleUnauthorized]);

  const loadAutomationSettings = useCallback(async (): Promise<boolean> => {
    if (!client.getAutomationSettings) return true;
    try {
      setAutomationSettings(await client.getAutomationSettings());
      return true;
    } catch (error) {
      if (!isUnauthorized(error) || !handleUnauthorized()) {
        setRepositoryError(`自动化设置读取失败：${errorMessage(error)}`);
      }
      return false;
    }
  }, [client, handleUnauthorized]);

  const loadConflicts = useCallback(async (): Promise<boolean> => {
    try {
      setConflicts(await client.listConflicts());
      return true;
    } catch (error) {
      if (!isUnauthorized(error) || !handleUnauthorized()) {
        setConflictError(errorMessage(error));
      }
      return false;
    }
  }, [client, handleUnauthorized]);

  useEffect(() => {
    if (apiClient || ALLOW_UNAUTHENTICATED) {
      setAuthChecking(false);
      return;
    }
    let cancelled = false;
    void setupStatusRequest()
      .then(async (setup) => {
        if (cancelled) return;
        setSetupDatabase(setup.database);
        setSetupRequired(setup.required);
        if (setup.required) return;
        try {
          await client.getRepositoryStatus();
          if (!cancelled) setAuthenticated(true);
        } catch (error) {
          if (!cancelled && !isUnauthorized(error))
            setAuthError(errorMessage(error));
        }
      })
      .catch((error) => {
        if (!cancelled) setAuthError(errorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setAuthChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient, client]);

  useEffect(() => {
    if (authenticated)
      void Promise.all([
        loadArticles(),
        loadRepositoryStatus(),
        loadAutomationSettings(),
        loadConflicts(),
      ]);
  }, [
    authenticated,
    loadArticles,
    loadAutomationSettings,
    loadConflicts,
    loadRepositoryStatus,
  ]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 799px)");
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => {
      setNotice(null);
      setNoticeUrl(null);
    }, 6000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (saveState !== "dirty" && saveState !== "saving") return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [saveState]);

  const applySource = useCallback(
    (nextSource: string) => {
      changeRevisionRef.current += 1;
      setSource(nextSource);
      const parsed = parseArticleSource(nextSource, metadata);
      setMetadata(parsed.metadata);
      setDiagnostics(validateSource(nextSource));
      const saved = activeArticleRef.current;
      setSaveState(
        saved && nextSource === saved.source && pathRef.current === saved.path
          ? "clean"
          : "dirty",
      );
      setWorkspaceError(null);
    },
    [metadata],
  );

  const updateMetadata = useCallback(
    (nextMetadata: ArticleMetadata) => {
      const result = writeMetadataToSource(
        editorRef.current?.getSource() ?? source,
        nextMetadata,
      );
      if (result.diagnostics.some((item) => item.severity === "error")) {
        setDiagnostics(result.diagnostics);
        setWorkspaceError(
          "Frontmatter 有语法错误，请先在源码中修复后再编辑元数据。",
        );
        return;
      }
      changeRevisionRef.current += 1;
      setMetadata(nextMetadata);
      setSource(result.source);
      editorRef.current?.setSource(result.source, true);
      setDiagnostics(validateSource(result.source));
      const saved = activeArticleRef.current;
      setSaveState(
        saved &&
          result.source === saved.source &&
          pathRef.current === saved.path
          ? "clean"
          : "dirty",
      );
    },
    [source],
  );

  const saveDraft = useCallback(async (): Promise<boolean> => {
    const article = activeArticleRef.current ?? activeArticle;
    if (!article) return false;
    if (saveInFlightRef.current) return saveInFlightRef.current;
    const currentSource = editorRef.current?.getSource() ?? sourceRef.current;
    const currentPath = pathRef.current;
    const savedRevision = changeRevisionRef.current;
    const currentDiagnostics = validateSource(currentSource);
    setDiagnostics(currentDiagnostics);
    setSaveState("saving");
    setWorkspaceError(null);

    const promise = client
      .saveDraft({
        id: article.id,
        path: currentPath,
        source: currentSource,
        version: article.version,
      })
      .then((result) => {
        setActiveArticle(result.article);
        activeArticleRef.current = result.article;
        activeIdRef.current = result.article.id;
        setArticles((items) => updateArticleSummary(items, result.article));
        lastSavedRevisionRef.current = savedRevision;
        if (savedRevision === changeRevisionRef.current) {
          sourceRef.current = result.article.source;
          pathRef.current = result.article.path;
          setSource(result.article.source);
          setPath(result.article.path);
          setMetadata(
            parseArticleSource(result.article.source, result.article.metadata)
              .metadata,
          );
          setSaveState("saved");
        } else {
          setSaveState("dirty");
        }
        return true;
      })
      .catch(async (error: unknown) => {
        if (!isUnauthorized(error) || !handleUnauthorized()) {
          setSaveState("error");
          setWorkspaceError(errorMessage(error));
          if (error instanceof CmsApiError && error.status === 409) {
            setActiveArticle((current) =>
              current ? { ...current, syncStatus: "conflict" } : current,
            );
            await Promise.all([loadConflicts(), loadArticles(false)]);
            setConflictCenterOpen(true);
          }
        }
        return false;
      })
      .finally(() => {
        saveInFlightRef.current = null;
      });
    saveInFlightRef.current = promise;
    return promise;
  }, [activeArticle, client, handleUnauthorized, loadArticles, loadConflicts]);

  const flushDraft = useCallback(async (): Promise<boolean> => {
    for (;;) {
      const targetRevision = changeRevisionRef.current;
      const saved = await saveDraft();
      if (!saved) return false;
      if (
        lastSavedRevisionRef.current === targetRevision &&
        changeRevisionRef.current === targetRevision
      )
        return true;
    }
  }, [saveDraft]);
  flushDraftRef.current = flushDraft;

  useEffect(() => {
    if (!authenticated || !activeArticle || saveState !== "dirty") return;
    const timeout = window.setTimeout(() => {
      void saveDraft();
    }, automationSettings.autoSaveSeconds * 1000);
    return () => window.clearTimeout(timeout);
  }, [
    activeArticle,
    authenticated,
    automationSettings.autoSaveSeconds,
    saveDraft,
    saveState,
    source,
    path,
  ]);

  const publish = useCallback(
    async (commitMessage?: string) => {
      if (!activeArticle || publishing) return;
      const currentDiagnostics =
        editorRef.current?.validate() ?? validateSource(source);
      setDiagnostics(currentDiagnostics);
      if (currentDiagnostics.some((item) => item.severity === "error")) {
        setMetadataOpen(true);
        setWorkspaceError("推送前检查未通过，请先修复文章设置中的错误。");
        return;
      }
      setPublishing(true);
      setWorkspaceError(null);
      const saved =
        saveState === "dirty" || saveState === "saving"
          ? await flushDraft()
          : true;
      if (!saved) {
        setPublishing(false);
        return;
      }
      const article = activeArticleRef.current;
      if (!article) {
        setPublishing(false);
        return;
      }
      try {
        const result = await client.publishArticle({
          id: article.id,
          version: article.version,
          mode: "direct",
          commitMessage,
        });
        if (!result.article) {
          activeIdRef.current = null;
          activeArticleRef.current = null;
          setActiveArticle(null);
          setArticles((items) =>
            items.filter((item) => item.id !== article.id),
          );
          setNotice(
            result.branch === "local"
              ? "文章已从本地内容目录删除。"
              : "文章已从仓库主分支删除。",
          );
          setNoticeUrl(null);
          setSaveState("clean");
          return;
        }
        const publishedArticle = result.article;
        setActiveArticle(publishedArticle);
        activeArticleRef.current = publishedArticle;
        setArticles((items) => updateArticleSummary(items, publishedArticle));
        setNotice(
          result.branch === "local"
            ? "文章已写入本地内容目录。"
            : "文章已安全推送到主分支。",
        );
        setNoticeUrl(result.pullRequestUrl ?? null);
        setSaveState("clean");
      } catch (error) {
        if (!isUnauthorized(error) || !handleUnauthorized()) {
          setWorkspaceError(errorMessage(error));
          if (error instanceof CmsApiError && error.status === 409) {
            await Promise.all([loadConflicts(), loadArticles(false)]);
            setConflictCenterOpen(true);
          }
        }
      } finally {
        setPublishing(false);
      }
    },
    [
      activeArticle,
      client,
      flushDraft,
      handleUnauthorized,
      loadArticles,
      loadConflicts,
      publishing,
      saveState,
      source,
    ],
  );

  const publishMany = useCallback(
    async (articleIds: string[], commitMessage?: string) => {
      if (publishing || articleIds.length === 0) return;
      const uniqueIds = [...new Set(articleIds)];
      if (activeIdRef.current && uniqueIds.includes(activeIdRef.current)) {
        const currentDiagnostics =
          editorRef.current?.validate() ?? validateSource(sourceRef.current);
        setDiagnostics(currentDiagnostics);
        if (currentDiagnostics.some((item) => item.severity === "error")) {
          setMetadataOpen(true);
          setWorkspaceError("推送前检查未通过，请先修复当前文章设置中的错误。");
          return;
        }
      }
      setPublishing(true);
      setWorkspaceError(null);
      try {
        if (
          activeIdRef.current &&
          uniqueIds.includes(activeIdRef.current) &&
          (saveState === "dirty" || saveState === "saving") &&
          !(await flushDraft())
        )
          return;
        const latest = await client.listArticles();
        const selected = latest.filter(
          (article) =>
            uniqueIds.includes(article.id) &&
            ["unpublished", "deleting", "error"].includes(article.syncStatus),
        );
        if (selected.length === 0) {
          setNotice("所选文章已经没有待同步改动。");
          return;
        }
        const result = await client.publishArticles({
          items: selected.map((article) => ({
            id: article.id,
            version: article.version,
          })),
          mode: "direct",
          commitMessage,
        });
        const returnedById = new Map(
          result.articles
            .filter((article): article is ArticleDocument => Boolean(article))
            .map((article) => [article.id, article]),
        );
        const removedIds = new Set(
          selected
            .map((article) => article.id)
            .filter((articleId) => !returnedById.has(articleId)),
        );
        setArticles((items) =>
          items
            .filter((article) => !removedIds.has(article.id))
            .map((article) => returnedById.get(article.id) ?? article),
        );
        const currentId = activeIdRef.current;
        if (currentId && uniqueIds.includes(currentId)) {
          const current = returnedById.get(currentId);
          if (!current) {
            activeIdRef.current = null;
            activeArticleRef.current = null;
            setActiveArticle(null);
            setSource("");
            setPath("");
          } else {
            activeArticleRef.current = current;
            setActiveArticle(current);
            setSource(current.source);
            setPath(current.path);
            setMetadata(
              parseArticleSource(current.source, current.metadata).metadata,
            );
            setSaveState("clean");
          }
        }
        setNotice(
          localRepository
            ? `已将 ${selected.length} 篇文章写入本地内容目录。`
            : `已将 ${selected.length} 篇文章合并为一个 commit 并推送。`,
        );
        setNoticeUrl(null);
        await Promise.all([loadRepositoryStatus(), loadConflicts()]);
      } catch (error) {
        if (!isUnauthorized(error) || !handleUnauthorized()) {
          setWorkspaceError(errorMessage(error));
          if (error instanceof CmsApiError && error.status === 409) {
            await Promise.all([loadConflicts(), loadArticles(false)]);
            setConflictCenterOpen(true);
          }
        }
      } finally {
        setPublishing(false);
      }
    },
    [
      client,
      flushDraft,
      handleUnauthorized,
      loadArticles,
      loadConflicts,
      loadRepositoryStatus,
      localRepository,
      publishing,
      saveState,
    ],
  );

  const syncRepository = useCallback(async () => {
    if (syncingRepository) return;
    if (saveState === "dirty" || saveState === "saving") {
      const saved = await flushDraft();
      if (!saved) return;
    }
    setSyncingRepository(true);
    setRepositoryError(null);
    setWorkspaceError(null);
    try {
      const result = await client.syncRepository();
      if (result.headCommit) {
        setRepositoryStatus((current) =>
          current
            ? {
                ...current,
                headCommit: result.headCommit,
                checkedAt: new Date().toISOString(),
              }
            : current,
        );
      }
      await Promise.all([
        loadArticles(false),
        loadRepositoryStatus(),
        loadAutomationSettings(),
        loadConflicts(),
      ]);
      const activeId = activeIdRef.current;
      if (activeId) {
        try {
          const refreshed = await client.getArticle(activeId);
          activeArticleRef.current = refreshed;
          setActiveArticle(refreshed);
          setArticles((items) => updateArticleSummary(items, refreshed));
          setSource(refreshed.source);
          setPath(refreshed.path);
          setMetadata(
            parseArticleSource(refreshed.source, refreshed.metadata).metadata,
          );
          setDiagnostics(validateSource(refreshed.source));
          setSaveState("clean");
          changeRevisionRef.current = 0;
          lastSavedRevisionRef.current = 0;
        } catch {
          // The synchronized commit may have removed the selected article.
        }
      }
      const summary = `导入 ${result.imported} 篇，删除 ${result.deleted} 篇`;
      setNotice(
        result.conflicts.length > 0
          ? `同步完成：${summary}，发现 ${result.conflicts.length} 个冲突。`
          : `同步完成：${summary}，没有冲突。`,
      );
      setNoticeUrl(null);
    } catch (error) {
      if (!isUnauthorized(error) || !handleUnauthorized()) {
        setRepositoryError(errorMessage(error));
        setWorkspaceError(`仓库同步失败：${errorMessage(error)}`);
      }
    } finally {
      setSyncingRepository(false);
    }
  }, [
    client,
    handleUnauthorized,
    loadArticles,
    loadAutomationSettings,
    loadConflicts,
    loadRepositoryStatus,
    flushDraft,
    saveState,
    syncingRepository,
  ]);

  const updateAutomation = useCallback(
    async (
      next: Pick<AutomationSettings, "autoSaveSeconds" | "autoSyncMinutes">,
    ) => {
      const previous = automationSettings;
      setAutomationSettings((current) => ({ ...current, ...next }));
      if (!client.updateAutomationSettings) return;
      setAutomationSaving(true);
      setRepositoryError(null);
      try {
        setAutomationSettings(await client.updateAutomationSettings(next));
        setNotice("自动保存与仓库拉取周期已更新。");
        setNoticeUrl(null);
      } catch (error) {
        setAutomationSettings(previous);
        if (!isUnauthorized(error) || !handleUnauthorized()) {
          setRepositoryError(`自动化设置保存失败：${errorMessage(error)}`);
        }
      } finally {
        setAutomationSaving(false);
      }
    },
    [automationSettings, client, handleUnauthorized],
  );

  const loadRepositorySettings = useCallback(async () => {
    if (!client.getRepositorySettings)
      throw new Error("当前后端不支持仓库连接设置。");
    return client.getRepositorySettings();
  }, [client]);

  const saveRepositorySettings = useCallback(
    async (
      input: Parameters<
        NonNullable<CmsApiClient["updateRepositorySettings"]>
      >[0],
    ) => {
      if (!client.updateRepositorySettings)
        throw new Error("当前后端不支持仓库连接设置。");
      const saved = await client.updateRepositorySettings(input);
      await loadRepositoryStatus();
      return saved;
    },
    [client, loadRepositoryStatus],
  );

  const testRepositorySettings = useCallback(
    async (
      input: Parameters<
        NonNullable<CmsApiClient["testRepositorySettings"]>
      >[0],
    ) => {
      if (!client.testRepositorySettings)
        throw new Error("当前后端不支持仓库连接检测。");
      return client.testRepositorySettings(input);
    },
    [client],
  );

  const loadPasswordSettings = useCallback(async () => {
    if (!client.getPasswordSettings)
      throw new Error("当前后端不支持安全设置。");
    return client.getPasswordSettings();
  }, [client]);

  const savePasswordSettings = useCallback(
    async (
      input: Parameters<
        NonNullable<CmsApiClient["updatePasswordSettings"]>
      >[0],
    ) => {
      if (!client.updatePasswordSettings)
        throw new Error("当前后端不支持安全设置。");
      return client.updatePasswordSettings(input);
    },
    [client],
  );

  const resolveConflict = useCallback(
    async (
      conflictId: string,
      input: {
        resolution: ContentConflictResolution;
        mergedSource?: string;
        mergedPath?: string;
      },
    ) => {
      setConflictBusy(true);
      setConflictError(null);
      try {
        const resolved = await client.resolveConflict(conflictId, input);
        await Promise.all([
          loadConflicts(),
          loadArticles(false),
          loadRepositoryStatus(),
        ]);
        if (resolved) {
          setArticles((items) => updateArticleSummary(items, resolved));
          if (activeIdRef.current === resolved.id) {
            activeArticleRef.current = resolved;
            setActiveArticle(resolved);
            setSource(resolved.source);
            setPath(resolved.path);
            setMetadata(
              parseArticleSource(resolved.source, resolved.metadata).metadata,
            );
            setSaveState("clean");
          }
        } else if (
          activeIdRef.current ===
          conflicts.find((item) => item.id === conflictId)?.articleId
        ) {
          activeIdRef.current = null;
          activeArticleRef.current = null;
          setActiveArticle(null);
        }
        setNotice(
          input.resolution === "remote"
            ? "已采用仓库版本。"
            : "冲突结果已安全推送到主分支。",
        );
        if (conflicts.length <= 1) setConflictCenterOpen(false);
      } catch (error) {
        if (!isUnauthorized(error) || !handleUnauthorized()) {
          setConflictError(errorMessage(error));
          await loadConflicts();
        }
      } finally {
        setConflictBusy(false);
      }
    },
    [
      client,
      conflicts,
      handleUnauthorized,
      loadArticles,
      loadConflicts,
      loadRepositoryStatus,
    ],
  );

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      const command = event.metaKey || event.ctrlKey;
      if (command && event.key.toLocaleLowerCase() === "s") {
        event.preventDefault();
        if (authenticated && activeArticle) void saveDraft();
      }
      if (!command && !event.altKey && event.key.toLocaleLowerCase() === "n") {
        const target = event.target as HTMLElement | null;
        if (target?.matches("input, textarea, [contenteditable='true']"))
          return;
        event.preventDefault();
        setNewArticleDirectory(repositoryStatus?.contentRoot || "src/content");
        setNewDialogOpen(true);
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [activeArticle, authenticated, repositoryStatus?.contentRoot, saveDraft]);

  const createArticle = async (values: NewArticleValues) => {
    setCreateBusy(true);
    setCreateError(null);
    const initialMetadata: ArticleMetadata = {
      title: values.title,
      date: today(),
      tags: [],
      summary: "",
    };
    try {
      const document = await client.createArticle({
        path: values.path,
        format: values.format,
        source: createArticleSource(initialMetadata),
      });
      setArticles((items) => updateArticleSummary(items, document));
      activeIdRef.current = document.id;
      activeArticleRef.current = document;
      setActiveArticle(document);
      setSource(document.source);
      setPath(document.path);
      setMetadata(
        parseArticleSource(document.source, document.metadata).metadata,
      );
      setDiagnostics(validateSource(document.source));
      setSaveState("clean");
      changeRevisionRef.current = 0;
      lastSavedRevisionRef.current = 0;
      setView("edit&preview");
      setNewDialogOpen(false);
      setSidebarOpen(false);
      requestAnimationFrame(() => editorRef.current?.focus());
    } catch (error) {
      if (!isUnauthorized(error) || !handleUnauthorized()) {
        setCreateError(errorMessage(error));
      }
    } finally {
      setCreateBusy(false);
    }
  };

  const moveArticleToFolder = useCallback(
    async (article: ArticleSummary, folderPath?: string) => {
      if (!folderPath) {
        await loadArticle(article);
        if (activeIdRef.current === article.id) setMoveDialogOpen(true);
        return;
      }
      const filename = article.path.split("/").at(-1);
      if (!filename) return;
      const nextPath = `${folderPath.replace(/\/$/, "")}/${filename}`;
      if (nextPath === article.path) {
        setNotice("文章已经在这个目录中。");
        return;
      }
      setWorkspaceError(null);
      try {
        if (
          article.id === activeIdRef.current &&
          (saveState === "dirty" || saveState === "saving")
        ) {
          if (!(await flushDraft())) return;
        }
        const document = await client.getArticle(article.id);
        const result = await client.saveDraft({
          id: document.id,
          path: nextPath,
          source: document.source,
          version: document.version,
        });
        setArticles((items) => updateArticleSummary(items, result.article));
        if (activeIdRef.current === article.id) {
          activeArticleRef.current = result.article;
          setActiveArticle(result.article);
          pathRef.current = result.article.path;
          setPath(result.article.path);
          setSaveState("clean");
        }
        setNotice(`已移动到 ${folderPath}，等待推送当前文章。`);
        setNoticeUrl(null);
      } catch (error) {
        if (!isUnauthorized(error) || !handleUnauthorized())
          setWorkspaceError(`移动失败：${errorMessage(error)}`);
      }
    },
    [client, flushDraft, handleUnauthorized, loadArticle, saveState],
  );

  const deleteSelectedArticle = useCallback(async () => {
    const candidate = deleteCandidate;
    if (!candidate || deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      if (
        candidate.id === activeIdRef.current &&
        (saveState === "dirty" || saveState === "saving")
      ) {
        if (!(await flushDraft())) return;
      }
      const current =
        candidate.id === activeIdRef.current
          ? activeArticleRef.current
          : await client.getArticle(candidate.id);
      if (!current) return;
      const pending = await client.deleteArticle(current.id, current.version);
      if (pending) {
        setArticles((items) => updateArticleSummary(items, pending));
        if (pending.id === activeIdRef.current) {
          activeArticleRef.current = pending;
          setActiveArticle(pending);
          setSaveState("clean");
        }
        setNotice(
          "文章已标记为待删除；仓库尚未改变，点击“推送当前”后才会执行删除。",
        );
      } else {
        setArticles((items) => items.filter((item) => item.id !== current.id));
        if (current.id === activeIdRef.current) {
          activeIdRef.current = null;
          activeArticleRef.current = null;
          setActiveArticle(null);
        }
        setNotice("未推送文章已删除。");
      }
      setDeleteCandidate(null);
    } catch (error) {
      if (!isUnauthorized(error) || !handleUnauthorized())
        setDeleteError(errorMessage(error));
    } finally {
      setDeleteBusy(false);
    }
  }, [
    client,
    deleteBusy,
    deleteCandidate,
    flushDraft,
    handleUnauthorized,
    saveState,
  ]);

  const revertSelectedArticle = useCallback(async () => {
    const candidate = revertCandidate;
    if (!candidate || revertBusy) return;
    if (
      candidate.id === activeIdRef.current &&
      (saveState === "dirty" || saveState === "saving")
    ) {
      setRevertError("当前编辑尚未自动保存，请等待保存完成后再撤销。");
      return;
    }
    setRevertBusy(true);
    setRevertError(null);
    try {
      const current =
        candidate.id === activeIdRef.current
          ? activeArticleRef.current
          : await client.getArticle(candidate.id);
      if (!current) return;
      const restored = await client.discardDraft(current.id, current.version);
      if (restored) {
        setArticles((items) => updateArticleSummary(items, restored));
        if (restored.id === activeIdRef.current) {
          activeArticleRef.current = restored;
          setActiveArticle(restored);
          sourceRef.current = restored.source;
          pathRef.current = restored.path;
          setSource(restored.source);
          setPath(restored.path);
          const parsed = parseArticleSource(restored.source, restored.metadata);
          setMetadata(parsed.metadata);
          setDiagnostics(validateSource(restored.source));
          setSaveState("clean");
          changeRevisionRef.current = 0;
          lastSavedRevisionRef.current = 0;
        }
        setNotice("已撤销 CMS 改动，恢复到最近一次仓库版本。");
      } else {
        setArticles((items) => items.filter((item) => item.id !== current.id));
        if (current.id === activeIdRef.current) {
          activeIdRef.current = null;
          activeArticleRef.current = null;
          setActiveArticle(null);
        }
        setNotice("从未推送的 CMS 文章已移除。");
      }
      setNoticeUrl(null);
      setRevertCandidate(null);
    } catch (error) {
      if (!isUnauthorized(error) || !handleUnauthorized())
        setRevertError(errorMessage(error));
    } finally {
      setRevertBusy(false);
    }
  }, [client, handleUnauthorized, revertBusy, revertCandidate, saveState]);

  const openHistoryReference = useCallback(async () => {
    const article = activeArticleRef.current;
    if (!article) return;
    setHistoryReferenceOpen(true);
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      setRevisions(await client.listArticleRevisions(article.id));
    } catch (error) {
      if (!isUnauthorized(error) || !handleUnauthorized())
        setHistoryError(errorMessage(error));
    } finally {
      setHistoryLoading(false);
    }
  }, [client, handleUnauthorized]);

  const restoreVersion = useCallback(
    async (revision: ArticleRevision) => {
      if (historyBusy) return;
      setHistoryBusy(true);
      setHistoryError(null);
      try {
        if (saveState === "dirty" || saveState === "saving") {
          if (!(await flushDraft())) return;
        }
        const current = activeArticleRef.current;
        if (!current || current.id !== revision.articleId) return;
        const restored = await client.restoreArticleRevision(
          current.id,
          revision.id,
          current.version,
        );
        activeArticleRef.current = restored;
        activeIdRef.current = restored.id;
        setActiveArticle(restored);
        setArticles((items) => updateArticleSummary(items, restored));
        sourceRef.current = restored.source;
        pathRef.current = restored.path;
        setSource(restored.source);
        setPath(restored.path);
        setMetadata(
          parseArticleSource(restored.source, restored.metadata).metadata,
        );
        setDiagnostics(validateSource(restored.source));
        setSaveState("saved");
        changeRevisionRef.current = 0;
        lastSavedRevisionRef.current = 0;
        setRevisions(await client.listArticleRevisions(restored.id));
        setNotice("历史版本已恢复为待推送内容，仓库还没有发生变化。");
        setNoticeUrl(null);
      } catch (error) {
        if (!isUnauthorized(error) || !handleUnauthorized())
          setHistoryError(errorMessage(error));
      } finally {
        setHistoryBusy(false);
      }
    },
    [client, flushDraft, handleUnauthorized, historyBusy, saveState],
  );

  const tagSuggestions = useMemo(
    () =>
      Array.from(
        new Set(articles.flatMap((article) => article.metadata.tags)),
      ).sort((left, right) => left.localeCompare(right, "zh-CN")),
    [articles],
  );

  const login = async (password: string) => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      await authRequest("/api/auth/login", password);
      setAuthenticated(true);
    } catch (error) {
      setAuthError(
        isUnauthorized(error) ? "密码错误，请重新输入。" : errorMessage(error),
      );
    } finally {
      setAuthBusy(false);
    }
  };

  const initialize = async (values: SetupValues) => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      await initializeRequest(values);
      setSetupRequired(false);
      setAuthenticated(true);
    } catch (error) {
      setAuthError(errorMessage(error));
    } finally {
      setAuthBusy(false);
    }
  };

  const logout = async () => {
    if (
      (saveState === "dirty" || saveState === "saving") &&
      !(await flushDraft())
    ) {
      setWorkspaceError("当前修改尚未保存，保存成功后才能退出登录。");
      return;
    }
    try {
      await authRequest("/api/auth/logout");
    } finally {
      handleUnauthorized(null);
    }
  };

  if (authChecking) {
    return <LoginScreen busy error={authError} onLogin={login} />;
  }

  if (setupRequired) {
    return (
      <SetupScreen
        database={setupDatabase}
        busy={authBusy}
        error={authError}
        onTestRepository={testSetupRepositoryRequest}
        onInitialize={initialize}
      />
    );
  }

  if (!authenticated) {
    return <LoginScreen busy={authBusy} error={authError} onLogin={login} />;
  }

  return (
    <div
      className={`cms-shell${activeArticle ? " has-document" : ""}${sidebarOpen ? " has-sidebar" : ""}${metadataOpen ? " has-metadata" : ""}`}
    >
      <a className="skip-link" href="#editor-workspace">
        跳到编辑器
      </a>
      <div
        className="mobile-overlay"
        onClick={() => {
          setSidebarOpen(false);
          setMetadataOpen(false);
        }}
        aria-hidden="true"
      />

      <ArticleSidebar
        articles={articles}
        activeId={activeArticle?.id ?? null}
        activeSaveState={saveState}
        loading={loadingArticles}
        error={listError}
        onSelect={loadArticle}
        onNew={() => {
          setNewArticleDirectory(
            repositoryStatus?.contentRoot || "src/content",
          );
          setNewDialogOpen(true);
        }}
        onNewInFolder={(folderPath) => {
          setNewArticleDirectory(folderPath);
          setNewDialogOpen(true);
        }}
        onMoveArticle={(article, folderPath) =>
          void moveArticleToFolder(article, folderPath)
        }
        onRevertArticle={(article) => {
          setRevertError(null);
          setRevertCandidate(article);
        }}
        onDeleteArticle={(article) => {
          setDeleteError(null);
          setDeleteCandidate(article);
        }}
        onRetry={() => void loadArticles(false)}
        onClose={() => setSidebarOpen(false)}
        onSettings={() => {
          setSettingsOpen(true);
          setSidebarOpen(false);
        }}
        onLogout={() => void logout()}
        repositoryStatus={repositoryStatus}
        repositoryLoading={repositoryLoading}
        repositoryError={repositoryError}
        syncingRepository={syncingRepository}
        pushingRepository={publishing}
        onPullRepository={() => void syncRepository()}
        onPushCurrent={() => {
          if (!activeArticle) return;
          if (localRepository) void publish();
          else {
            setPublishTargetIds([activeArticle.id]);
            setPublishDialogOpen(true);
          }
        }}
        onPushSelected={(articleIds) => {
          if (localRepository) void publishMany(articleIds);
          else {
            setPublishTargetIds(articleIds);
            setPublishDialogOpen(true);
          }
        }}
        conflictCount={conflicts.length}
      />

      <main id="editor-workspace" className="editor-workspace">
        {activeArticle ? (
          <>
            <div className="editor-subheader">
              <button
                className="icon-button mobile-menu"
                type="button"
                onClick={() => setSidebarOpen(true)}
                aria-label="打开文章列表"
              >
                <Icon name="menu" />
              </button>
              <div className="document-path" title={path}>
                <Icon name="file" size={15} />
                <span>{path}</span>
                <b>{activeArticle.format.toUpperCase()}</b>
              </div>

              <div className="editor-subheader__actions">
                <div
                  className="view-switcher desktop-view-switcher"
                  role="group"
                  aria-label="编辑器视图"
                >
                  <button
                    type="button"
                    className={
                      !historyReferenceOpen && view === "editOnly"
                        ? "is-active"
                        : ""
                    }
                    onClick={() => {
                      setHistoryReferenceOpen(false);
                      setView("editOnly");
                    }}
                    aria-pressed={!historyReferenceOpen && view === "editOnly"}
                  >
                    <Icon name="edit" />
                    编辑
                  </button>
                  <button
                    type="button"
                    className={
                      !historyReferenceOpen && view === "edit&preview"
                        ? "is-active"
                        : ""
                    }
                    onClick={() => {
                      setHistoryReferenceOpen(false);
                      setView("edit&preview");
                    }}
                    aria-pressed={
                      !historyReferenceOpen && view === "edit&preview"
                    }
                  >
                    <span className="split-icon" />
                    分屏
                  </button>
                  <button
                    type="button"
                    className={
                      !historyReferenceOpen && view === "previewOnly"
                        ? "is-active"
                        : ""
                    }
                    onClick={() => {
                      setHistoryReferenceOpen(false);
                      setView("previewOnly");
                    }}
                    aria-pressed={
                      !historyReferenceOpen && view === "previewOnly"
                    }
                  >
                    <Icon name="preview" />
                    预览
                  </button>
                  <button
                    type="button"
                    className={historyReferenceOpen ? "is-active" : ""}
                    onClick={() =>
                      historyReferenceOpen
                        ? setHistoryReferenceOpen(false)
                        : void openHistoryReference()
                    }
                    aria-pressed={historyReferenceOpen}
                  >
                    <Icon name="history" />
                    历史
                  </button>
                </div>
                <button
                  className="button button--quiet metadata-trigger metadata-trigger--subheader"
                  type="button"
                  onClick={() => setMetadataOpen(true)}
                  disabled={activeArticle.syncStatus === "deleting"}
                  aria-label="打开文章设置"
                >
                  <Icon name="metadata" />
                  <span>文章设置</span>
                </button>
              </div>
            </div>

            <div
              className="mobile-editor-tabs"
              role="tablist"
              aria-label="编辑与预览"
            >
              <button
                type="button"
                role="tab"
                aria-selected={!historyReferenceOpen && mobilePane === "write"}
                className={
                  !historyReferenceOpen && mobilePane === "write"
                    ? "is-active"
                    : ""
                }
                onClick={() => {
                  setHistoryReferenceOpen(false);
                  setMobilePane("write");
                }}
              >
                <Icon name="edit" />
                写作
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={
                  !historyReferenceOpen && mobilePane === "preview"
                }
                className={
                  !historyReferenceOpen && mobilePane === "preview"
                    ? "is-active"
                    : ""
                }
                onClick={() => {
                  setHistoryReferenceOpen(false);
                  setMobilePane("preview");
                }}
              >
                <Icon name="preview" />
                预览
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={historyReferenceOpen}
                className={historyReferenceOpen ? "is-active" : ""}
                onClick={() =>
                  historyReferenceOpen
                    ? setHistoryReferenceOpen(false)
                    : void openHistoryReference()
                }
              >
                <Icon name="history" />
                历史
              </button>
            </div>

            {workspaceError ? (
              <div className="workspace-alert" role="alert">
                <Icon name="warning" />
                <span>{workspaceError}</span>
                <button
                  type="button"
                  onClick={() => setWorkspaceError(null)}
                  aria-label="关闭错误提示"
                >
                  <Icon name="close" size={15} />
                </button>
              </div>
            ) : null}

            <div
              className={`editor-stage${historyReferenceOpen ? " is-history-reference" : ""}${activeArticle.format === "mdx" && !historyReferenceOpen && effectiveView === "edit&preview" ? " is-mdx-split" : ""}${activeArticle.format === "mdx" && !historyReferenceOpen && effectiveView === "previewOnly" ? " is-mdx-preview-only" : ""}`}
              aria-busy={loadingArticle}
            >
              {loadingArticle ? (
                <div className="editor-loading">
                  <span className="spinner" />
                  正在打开文章…
                </div>
              ) : null}
              <CherryEditor
                key={activeArticle.id}
                ref={editorRef}
                value={source}
                format={activeArticle.format}
                view={
                  activeArticle.format === "mdx" ? "editOnly" : effectiveView
                }
                onChange={applySource}
                onUpload={
                  client.uploadMedia
                    ? async (file) => {
                        const asset = await client.uploadMedia!(
                          activeArticle.id,
                          file,
                        );
                        return {
                          url: asset.markdownUrl ?? asset.url,
                          name: asset.name,
                        };
                      }
                    : undefined
                }
                onUploadError={(error) =>
                  setWorkspaceError(`媒体上传失败：${errorMessage(error)}`)
                }
                onFormat={(changed) =>
                  setNotice(
                    changed
                      ? "Markdown 已由 Prettier 格式化，将自动保存到 CMS。"
                      : "Prettier 检查完成，当前文章无需调整。",
                  )
                }
                onFormatError={() =>
                  setWorkspaceError(
                    `无法格式化这篇 ${activeArticle.format.toUpperCase()}：请检查语法是否完整后重试。`,
                  )
                }
              />
              {activeArticle.format === "mdx" &&
              !historyReferenceOpen &&
              effectiveView !== "editOnly" ? (
                <MdxPreview source={source} />
              ) : null}
              {historyReferenceOpen ? (
                <HistoryReferencePanel
                  articleId={activeArticle.id}
                  currentPath={path}
                  currentSource={source}
                  revisions={revisions}
                  loading={historyLoading}
                  error={historyError}
                />
              ) : null}
            </div>

            <footer className="workspace-statusbar">
              <div className="workspace-statusbar__repository">
                <span>
                  <span className="connection-dot" />
                  <strong>
                    {repositoryStatus?.owner && repositoryStatus.repository
                      ? `${repositoryStatus.owner} / ${repositoryStatus.repository}`
                      : repositoryStatus?.provider === "filesystem"
                        ? "本地内容目录"
                        : "GitHub 内容仓库"}
                  </strong>
                  <em>{repositoryStatus?.configured ? "已连接" : "未连接"}</em>
                </span>
                <span>
                  同步 {formatRepositoryCheckTime(repositoryStatus?.checkedAt)}
                  {repositoryStatus?.headCommit
                    ? ` · ${repositoryStatus.headCommit.slice(0, 8)}`
                    : ""}
                </span>
              </div>
              <div className="workspace-statusbar__article">
                <span>v{activeArticle.version}</span>
                <span>
                  {source.trim() ? source.trim().split(/\s+/).length : 0} 词
                </span>
                <span>{source.length} 字符</span>
              </div>
            </footer>
          </>
        ) : (
          <section className="workspace-empty">
            <button
              className="icon-button mobile-menu workspace-empty__menu"
              type="button"
              onClick={() => setSidebarOpen(true)}
              aria-label="打开文章列表"
            >
              <Icon name="menu" />
            </button>
            <span className="empty-illustration">
              <Icon name="article" size={36} />
            </span>
            <span className="eyebrow">A quiet place for ideas</span>
            <h2>{loadingArticles ? "正在整理文章…" : "从一篇文章开始"}</h2>
            <p>在数据库中安心写作，推送时会检查远端并安全更新主分支。</p>
            {!loadingArticles ? (
              <button
                className="button button--primary"
                type="button"
                onClick={() => setNewDialogOpen(true)}
              >
                <Icon name="plus" />
                新建文章
              </button>
            ) : (
              <span className="spinner" />
            )}
          </section>
        )}
      </main>

      {activeArticle ? (
        <MetadataPanel
          metadata={metadata}
          tagSuggestions={tagSuggestions}
          diagnostics={diagnostics}
          disabled={saveState === "saving" || publishing}
          onMetadataChange={updateMetadata}
          onClose={() => setMetadataOpen(false)}
        />
      ) : null}

      <ConflictCenterDialog
        open={conflictCenterOpen}
        conflicts={conflicts}
        busy={conflictBusy}
        error={conflictError}
        onClose={() => setConflictCenterOpen(false)}
        onResolve={(id, input) => void resolveConflict(id, input)}
      />

      {settingsOpen ? (
        <SystemSettingsDialog
          automationSettings={automationSettings}
          automationSaving={automationSaving}
          onAutomationChange={(next) => void updateAutomation(next)}
          onLoadRepository={loadRepositorySettings}
          onSaveRepository={saveRepositorySettings}
          onTestRepository={testRepositorySettings}
          onLoadPasswordSettings={loadPasswordSettings}
          onSavePasswordSettings={savePasswordSettings}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}

      <VersionHistoryDialog
        open={historyOpen}
        article={
          activeArticle ? { ...activeArticle, source, path, metadata } : null
        }
        revisions={revisions}
        loading={historyLoading}
        busy={historyBusy}
        error={historyError}
        onClose={() => {
          if (!historyBusy) setHistoryOpen(false);
        }}
        onRestore={(revision) => void restoreVersion(revision)}
      />

      <NewArticleDialog
        open={newDialogOpen}
        busy={createBusy}
        error={createError}
        localMode={localRepository}
        initialDirectory={newArticleDirectory}
        onClose={() => {
          if (!createBusy) {
            setNewDialogOpen(false);
            setCreateError(null);
          }
        }}
        onCreate={(values) => void createArticle(values)}
      />

      <DeleteArticleDialog
        article={deleteCandidate}
        busy={deleteBusy}
        error={deleteError}
        localMode={localRepository}
        onClose={() => {
          if (!deleteBusy) {
            setDeleteCandidate(null);
            setDeleteError(null);
          }
        }}
        onConfirm={() => void deleteSelectedArticle()}
      />

      <RevertArticleDialog
        article={revertCandidate}
        busy={revertBusy}
        error={revertError}
        onClose={() => {
          if (!revertBusy) {
            setRevertCandidate(null);
            setRevertError(null);
          }
        }}
        onConfirm={() => void revertSelectedArticle()}
      />

      {publishTargetIds.length > 0 ? (
        <PublishArticleDialog
          open={publishDialogOpen}
          busy={publishing}
          articleTitles={publishTargetIds
            .map(
              (articleId) =>
                articles.find((article) => article.id === articleId)?.metadata
                  .title,
            )
            .filter((title): title is string => Boolean(title))}
          defaultMessage={
            publishTargetIds.length > 1
              ? `更新内容：${publishTargetIds.length} 篇文章`
              : activeArticle
                ? `${activeArticle.syncStatus === "deleting" ? "删除" : activeArticle.baseGitHash ? "更新" : "发布"}：${activeArticle.metadata.title}`
                : "更新文章"
          }
          branch={repositoryStatus?.branch || "默认分支"}
          onClose={() => {
            if (!publishing) {
              setPublishDialogOpen(false);
              setPublishTargetIds([]);
            }
          }}
          onConfirm={(commitMessage) => {
            setPublishDialogOpen(false);
            const targets = publishTargetIds;
            setPublishTargetIds([]);
            if (targets.length === 1 && targets[0] === activeArticle?.id)
              void publish(commitMessage);
            else void publishMany(targets, commitMessage);
          }}
        />
      ) : null}

      {activeArticle ? (
        <MoveArticleDialog
          open={moveDialogOpen}
          currentPath={path}
          contentRoot={repositoryStatus?.contentRoot || "src/content"}
          occupiedPaths={articles
            .filter((article) => article.id !== activeArticle.id)
            .map((article) => article.path)}
          onClose={() => setMoveDialogOpen(false)}
          onMove={(nextPath) => {
            changeRevisionRef.current += 1;
            pathRef.current = nextPath;
            setPath(nextPath);
            setSaveState("dirty");
            setMoveDialogOpen(false);
            setNotice(
              "新位置将自动保存到 CMS，并出现在“待同步”列表；仓库尚未发生变化。",
            );
            setNoticeUrl(null);
          }}
        />
      ) : null}

      {notice ? (
        <div className="cms-toast" role="status" aria-live="polite">
          <Icon name="check" />
          <span>
            <strong>操作完成</strong>
            {notice}
            {noticeUrl ? (
              <a href={noticeUrl} target="_blank" rel="noreferrer">
                查看 Pull Request <Icon name="external" size={12} />
              </a>
            ) : null}
          </span>
          <button
            type="button"
            onClick={() => {
              setNotice(null);
              setNoticeUrl(null);
            }}
            aria-label="关闭通知"
          >
            <Icon name="close" size={15} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
