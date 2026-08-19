export type ErrorCode =
  | "bad_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "method_not_allowed"
  | "conflict"
  | "precondition_required"
  | "payload_too_large"
  | "unsupported_media_type"
  | "bad_gateway"
  | "internal_error"
  | "service_unavailable";

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

const ERROR_CODE_MESSAGES: Record<string, string> = {
  bad_request: "请求参数不正确，请检查后重试。",
  unauthorized: "登录凭证无效或已过期，请重新登录。",
  forbidden: "你没有权限执行此操作。",
  not_found: "请求的内容不存在或已被删除。",
  method_not_allowed: "当前操作不受支持。",
  conflict: "内容已在其他位置发生变化，请刷新或处理冲突后重试。",
  precondition_required: "缺少版本信息，请刷新页面后重试。",
  payload_too_large: "提交的内容过大，请缩小后重试。",
  unsupported_media_type: "提交的数据格式不受支持。",
  bad_gateway: "仓库服务暂时无法完成请求，请稍后重试。",
  internal_error: "服务内部发生错误，请稍后重试或查看本地服务日志。",
  service_unavailable: "服务暂时不可用，请检查配置后重试。",
  network_error: "无法连接本地服务，请确认服务已经启动。",
};

const EXACT_MESSAGE_TRANSLATIONS: Record<string, string> = {
  "Article not found": "文章不存在或已被删除。",
  "Draft not found": "文章的未推送版本不存在。",
  "Content conflict not found": "内容冲突不存在或已经解决。",
  "Publication not found": "发布记录不存在。",
  "Resource not found": "请求的内容不存在。",
  "Access denied": "你没有权限执行此操作。",
  "A valid bearer token is required": "登录凭证无效或已过期，请重新登录。",
  "An unexpected error occurred": "服务内部发生错误，请稍后重试或查看本地服务日志。",
  "Draft version is stale": "未推送内容已在其他位置更新，请刷新后重试。",
  "Article version is stale": "文章已在其他位置更新，请刷新后重试。",
  "Article draft version is stale": "文章内容已在其他位置更新，请刷新后重试。",
  "Another device saved a newer CMS draft": "另一台设备已经保存了更新的内容，请先处理冲突。",
  "Resolve the open content conflict before publishing": "请先处理当前内容冲突，再进行推送。",
  "Resolve the open content conflict before deleting": "请先处理当前内容冲突，再删除文章。",
  "Resolve the open content conflict before discarding the draft": "请先处理当前内容冲突，再撤销改动。",
};

type RepositoryOperation = "status" | "sync" | "publish" | "delete";

export function repositoryErrorMessage(
  error: unknown,
  operation: RepositoryOperation = "sync",
): string {
  const raw = (error instanceof Error ? error.message : String(error ?? "")).trim();
  if (raw && /[\u3400-\u9fff]/u.test(raw)) return raw;
  if (/\b(?:401|bad credentials|authentication failed|requires authentication)\b/i.test(raw)) {
    return "仓库凭证无效，请在仓库连接中重新填写 Token。";
  }
  if (/rate limit|secondary rate/i.test(raw)) {
    return "仓库 API 请求次数已达上限，请稍后再试。";
  }
  if (/\b403\b|insufficient permission|permission denied|forbidden/i.test(raw)) {
    return "仓库 Token 权限不足，请授予目标仓库的 Contents 读写权限。";
  }
  if (/content directory|content_root|cms_content_root/i.test(raw)) {
    return "文章目录不存在，请检查仓库连接中的文章目录设置。";
  }
  if (/default branch|branch .* did not return|branch .* not found/i.test(raw)) {
    return "仓库分支不存在或无法读取，请检查分支设置。";
  }
  if (/\b404\b|not found/i.test(raw)) {
    return "仓库不存在或当前 Token 无权访问，请检查仓库地址和权限。";
  }
  if (/archive.*(?:empty|truncated|missing|exceed|limit|download)|compressed archive|expanded archive/i.test(raw)) {
    return "仓库归档无法完整读取或体积过大，请缩小仓库或文章目录后重试。";
  }
  if (/article .* exceeds|payload too large/i.test(raw)) {
    return "仓库中存在超过大小限制的文章，请缩小该文件后重试。";
  }
  if (/fetch failed|network|timed? ?out|timeout|econn/i.test(raw)) {
    return "无法连接仓库服务，请检查网络后重试。";
  }
  if (/repository changed|synchronize|sync.*retry/i.test(raw)) {
    return "远端仓库已发生变化，请先拉取最新内容后再操作。";
  }
  const fallback: Record<RepositoryOperation, string> = {
    status: "无法读取仓库状态，请检查仓库连接配置。",
    sync: "仓库拉取失败，请检查仓库连接配置后重试。",
    publish: "内容推送失败，请检查仓库连接和写入权限。",
    delete: "文章删除推送失败，请检查仓库连接和写入权限。",
  };
  return fallback[operation];
}

export function localizeErrorMessage(error: {
  code?: string;
  status?: number;
  message?: string;
}): string {
  const raw = error.message?.trim();
  if (raw && /[\u3400-\u9fff]/u.test(raw)) return raw;
  if (raw && EXACT_MESSAGE_TRANSLATIONS[raw]) return EXACT_MESSAGE_TRANSLATIONS[raw];
  if (raw && /^path must be /i.test(raw)) return "文章路径必须是安全的相对 .md 或 .mdx 路径。";
  if (raw && /frontmatter/i.test(raw)) return "文章 Frontmatter 格式不正确，请检查 YAML 内容。";
  if (raw && /version is stale|changed while|changed concurrently/i.test(raw)) {
    return "内容已在其他位置更新，请刷新或处理冲突后重试。";
  }
  if (raw && /repository synchronization failed/i.test(raw)) {
    return repositoryErrorMessage(raw, "sync");
  }
  if (raw && /repository status is unavailable/i.test(raw)) {
    return repositoryErrorMessage(raw, "status");
  }
  if (raw && /repository publish failed/i.test(raw)) {
    return repositoryErrorMessage(raw, "publish");
  }
  if (raw && /repository deletion failed/i.test(raw)) {
    return repositoryErrorMessage(raw, "delete");
  }
  if (raw && /(?:github|gitee|repository|archive|content directory)/i.test(raw)) {
    return repositoryErrorMessage(raw);
  }
  const statusCode = error.status === 401 ? "unauthorized"
    : error.status === 403 ? "forbidden"
    : error.status === 404 ? "not_found"
    : error.status === 409 ? "conflict"
    : error.status === 413 ? "payload_too_large"
    : error.status === 415 ? "unsupported_media_type"
    : error.status === 428 ? "precondition_required"
    : error.status === 502 ? "bad_gateway"
    : error.status === 503 ? "service_unavailable"
    : error.status && error.status >= 500 ? "internal_error"
    : error.status && error.status >= 400 ? "bad_request"
    : "internal_error";
  return ERROR_CODE_MESSAGES[error.code ?? statusCode] ?? ERROR_CODE_MESSAGES[statusCode];
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, "bad_request", message, details);
export const notFound = (message = "Resource not found") =>
  new AppError(404, "not_found", message);
export const conflict = (message: string, details?: unknown) =>
  new AppError(409, "conflict", message, details);
