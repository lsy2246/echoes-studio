import type { ArticleSummary } from "../../shared/editor-contract";

export interface ArticleFolderNode {
  name: string;
  path: string;
  folders: ArticleFolderNode[];
  articles: ArticleSummary[];
  articleCount: number;
}

export interface ArticleTree {
  folders: ArticleFolderNode[];
  articles: ArticleSummary[];
  articleCount: number;
}

interface MutableFolderNode {
  name: string;
  path: string;
  folders: Map<string, MutableFolderNode>;
  articles: ArticleSummary[];
}

const collator = new Intl.Collator("zh-CN", {
  numeric: true,
  sensitivity: "base",
});

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
}

export function relativeArticlePath(path: string, contentRoot: string): string {
  const normalizedPath = normalizePath(path);
  const normalizedRoot = normalizePath(contentRoot);
  if (!normalizedRoot) return normalizedPath;
  if (normalizedPath === normalizedRoot) return "";
  return normalizedPath.startsWith(`${normalizedRoot}/`)
    ? normalizedPath.slice(normalizedRoot.length + 1)
    : normalizedPath;
}

function finalizeFolder(folder: MutableFolderNode): ArticleFolderNode {
  const folders = [...folder.folders.values()]
    .sort((left, right) => collator.compare(left.name, right.name))
    .map(finalizeFolder);
  const articles = [...folder.articles].sort((left, right) =>
    collator.compare(left.metadata.title || left.path, right.metadata.title || right.path));
  return {
    name: folder.name,
    path: folder.path,
    folders,
    articles,
    articleCount: articles.length + folders.reduce((total, child) => total + child.articleCount, 0),
  };
}

export function buildArticleTree(
  articles: ArticleSummary[],
  contentRoot: string,
): ArticleTree {
  const root: MutableFolderNode = {
    name: normalizePath(contentRoot) || "content",
    path: "",
    folders: new Map(),
    articles: [],
  };

  for (const article of articles) {
    const parts = relativeArticlePath(article.path, contentRoot).split("/").filter(Boolean);
    parts.pop();
    let current = root;
    for (const part of parts) {
      const path = current.path ? `${current.path}/${part}` : part;
      let folder = current.folders.get(part);
      if (!folder) {
        folder = { name: part, path, folders: new Map(), articles: [] };
        current.folders.set(part, folder);
      }
      current = folder;
    }
    current.articles.push(article);
  }

  const finalized = finalizeFolder(root);
  return {
    folders: finalized.folders,
    articles: finalized.articles,
    articleCount: finalized.articleCount,
  };
}

export function articleFolderPaths(path: string, contentRoot: string): string[] {
  const parts = relativeArticlePath(path, contentRoot).split("/").filter(Boolean);
  parts.pop();
  return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
}
