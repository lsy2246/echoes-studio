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
  if (raw && /repository/i.test(raw)) return "仓库操作失败，请拉取最新内容后重试。";
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
