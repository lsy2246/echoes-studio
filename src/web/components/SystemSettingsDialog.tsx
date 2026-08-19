import { useEffect, useId, useState, type FormEvent } from "react";
import type {
  AutomationSettings,
  PasswordSettings,
  RepositoryConnectionSettings,
  RepositoryConnectionTestResult,
  UpdateRepositoryConnectionInput,
} from "../../shared/editor-contract";
import { Icon } from "./Icons";
import { SelectMenu } from "./SelectMenu";

type SettingsSection = "connection" | "automation" | "security";

interface SystemSettingsDialogProps {
  automationSettings: AutomationSettings;
  automationSaving: boolean;
  onAutomationChange: (
    settings: Pick<AutomationSettings, "autoSaveSeconds" | "autoSyncMinutes">,
  ) => void;
  onLoadRepository: () => Promise<RepositoryConnectionSettings>;
  onSaveRepository: (
    input: UpdateRepositoryConnectionInput,
  ) => Promise<RepositoryConnectionSettings>;
  onTestRepository: (
    input: UpdateRepositoryConnectionInput,
  ) => Promise<RepositoryConnectionTestResult>;
  onLoadPasswordSettings: () => Promise<PasswordSettings>;
  onSavePasswordSettings: (input: {
    currentPassword: string;
    newPassword?: string;
    iterations: PasswordSettings["iterations"];
  }) => Promise<PasswordSettings>;
  onClose: () => void;
}

const NAV_ITEMS: Array<{
  id: SettingsSection;
  label: string;
  description: string;
  icon: "cloud" | "refresh" | "settings";
}> = [
  {
    id: "connection",
    label: "仓库连接",
    description: "配置内容仓库",
    icon: "cloud",
  },
  {
    id: "automation",
    label: "自动化",
    description: "保存与拉取周期",
    icon: "refresh",
  },
  {
    id: "security",
    label: "登录与安全",
    description: "修改登录密码",
    icon: "settings",
  },
];

const EMPTY_REPOSITORY: RepositoryConnectionSettings = {
  provider: "github",
  owner: "",
  repository: "",
  branch: "",
  contentRoot: "src/content",
  filesystemPath: "",
  tokenConfigured: false,
  updatedAt: null,
};

function repositoryAddress(settings: RepositoryConnectionSettings): string {
  return settings.owner && settings.repository
    ? `${settings.owner}/${settings.repository}`
    : "";
}

function parseRepositoryAddress(
  value: string,
  provider: "github" | "gitee",
): { owner: string; repository: string } | null {
  const host = provider === "gitee" ? "gitee.com" : "github.com";
  const normalized = value
    .trim()
    .replace(new RegExp(`^git@${host.replace(".", "\\.")}:`, "i"), "")
    .replace(new RegExp(`^https?://(?:www\\.)?${host.replace(".", "\\.")}/`, "i"), "")
    .replace(/\.git$/i, "")
    .replace(/^\/+|\/+$/g, "");
  const [owner, repository, ...rest] = normalized.split("/");
  return owner && repository && rest.length === 0
    ? { owner, repository }
    : null;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败，请稍后重试。";
}

export function SystemSettingsDialog({
  automationSettings,
  automationSaving,
  onAutomationChange,
  onLoadRepository,
  onSaveRepository,
  onTestRepository,
  onLoadPasswordSettings,
  onSavePasswordSettings,
  onClose,
}: SystemSettingsDialogProps) {
  const titleId = useId();
  const [section, setSection] = useState<SettingsSection>("connection");
  const [repository, setRepository] = useState(EMPTY_REPOSITORY);
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [repositoryToken, setRepositoryToken] = useState("");
  const [repositoryLoading, setRepositoryLoading] = useState(true);
  const [repositorySaving, setRepositorySaving] = useState(false);
  const [repositoryTesting, setRepositoryTesting] = useState(false);
  const [connectionState, setConnectionState] = useState<
    "idle" | "dirty" | "checking" | "connected" | "failed"
  >("idle");
  const [repositoryFeedback, setRepositoryFeedback] = useState<{
    kind: "error" | "success";
    text: string;
  } | null>(null);
  const [passwords, setPasswords] = useState({
    current: "",
    next: "",
    confirm: "",
  });
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordIterations, setPasswordIterations] = useState<
    PasswordSettings["iterations"]
  >(100_000);
  const [passwordFeedback, setPasswordFeedback] = useState<{
    kind: "error" | "success";
    text: string;
  } | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    void onLoadRepository()
      .then((value) => {
        if (!cancelled) {
          setRepository(value);
          setRepositoryUrl(repositoryAddress(value));
          setConnectionState("checking");
          void onTestRepository({
            provider: value.provider,
            owner: value.owner,
            repository: value.repository,
            branch: value.branch,
            contentRoot: value.contentRoot,
            filesystemPath: value.filesystemPath,
          }).then((result) => {
            if (cancelled) return;
            setConnectionState("connected");
            setRepositoryFeedback({ kind: "success", text: result.message });
          }).catch((error) => {
            if (cancelled) return;
            setConnectionState("failed");
            setRepositoryFeedback({ kind: "error", text: message(error) });
          });
        }
      })
      .catch((error) => {
        if (!cancelled)
          setRepositoryFeedback({ kind: "error", text: message(error) });
      })
      .finally(() => {
        if (!cancelled) setRepositoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [onLoadRepository, onTestRepository]);

  useEffect(() => {
    let cancelled = false;
    void onLoadPasswordSettings()
      .then((value) => {
        if (!cancelled) setPasswordIterations(value.iterations);
      })
      .catch((error) => {
        if (!cancelled) {
          setPasswordFeedback({ kind: "error", text: message(error) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [onLoadPasswordSettings]);

  const repositoryInput = (): UpdateRepositoryConnectionInput | null => {
    const remote = repository.provider !== "filesystem";
    const coordinates = repository.provider !== "filesystem"
      ? parseRepositoryAddress(repositoryUrl, repository.provider)
      : null;
    if (remote && !coordinates) {
      setRepositoryFeedback({
        kind: "error",
        text: `请输入 owner/repository 或完整 ${repository.provider === "gitee" ? "Gitee" : "GitHub"} 仓库地址。`,
      });
      setConnectionState("failed");
      return null;
    }
    return {
      provider: repository.provider,
      owner: coordinates?.owner ?? repository.owner,
      repository: coordinates?.repository ?? repository.repository,
      branch: repository.branch,
      contentRoot: repository.contentRoot,
      filesystemPath: repository.filesystemPath,
      token: repositoryToken || undefined,
    };
  };

  const markRepositoryDirty = () => {
    setConnectionState("dirty");
    setRepositoryFeedback(null);
  };

  const testRepository = async () => {
    const input = repositoryInput();
    if (!input) return;
    setRepositoryTesting(true);
    setConnectionState("checking");
    setRepositoryFeedback(null);
    try {
      const result = await onTestRepository(input);
      setConnectionState("connected");
      setRepositoryFeedback({ kind: "success", text: result.message });
      if (!repository.branch) {
        setRepository((current) => ({ ...current, branch: result.branch }));
      }
    } catch (error) {
      setConnectionState("failed");
      setRepositoryFeedback({ kind: "error", text: message(error) });
    } finally {
      setRepositoryTesting(false);
    }
  };

  const saveRepository = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setRepositorySaving(true);
    setRepositoryFeedback(null);
    try {
      const input = repositoryInput();
      if (!input) return;
      setConnectionState("checking");
      const saved = await onSaveRepository(input);
      setRepository(saved);
      setRepositoryUrl(repositoryAddress(saved));
      setRepositoryToken("");
      setConnectionState("connected");
      setRepositoryFeedback({
        kind: "success",
        text: "仓库连接已保存并立即生效。",
      });
    } catch (error) {
      setConnectionState("failed");
      setRepositoryFeedback({ kind: "error", text: message(error) });
    } finally {
      setRepositorySaving(false);
    }
  };

  const changePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPasswordFeedback(null);
    if (passwords.next && passwords.next.length < 8) {
      setPasswordFeedback({ kind: "error", text: "新密码至少需要 8 个字符。" });
      return;
    }
    if (passwords.next !== passwords.confirm) {
      setPasswordFeedback({ kind: "error", text: "两次输入的新密码不一致。" });
      return;
    }
    setPasswordSaving(true);
    try {
      const saved = await onSavePasswordSettings({
        currentPassword: passwords.current,
        newPassword: passwords.next || undefined,
        iterations: passwordIterations,
      });
      setPasswordIterations(saved.iterations);
      setPasswords({ current: "", next: "", confirm: "" });
      setPasswordFeedback({
        kind: "success",
        text: passwords.next
          ? "密码与安全强度已更新，其他浏览器会话已失效。"
          : "安全强度已更新，其他浏览器会话已失效。",
      });
    } catch (error) {
      setPasswordFeedback({ kind: "error", text: message(error) });
    } finally {
      setPasswordSaving(false);
    }
  };

  return (
    <div
      className="system-settings-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="system-settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="system-settings-header">
          <div className="system-settings-header__brand">
            <span className="brand-mark" aria-hidden="true">
              E
            </span>
            <span>
              <strong id={titleId}>系统设置</strong>
              <small>Echoes Studio</small>
            </span>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label="关闭系统设置"
            autoFocus
          >
            <Icon name="close" />
          </button>
        </header>

        <div className="system-settings-layout">
          <nav className="system-settings-nav" aria-label="设置分类">
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={section === item.id ? "is-active" : ""}
                aria-current={section === item.id ? "page" : undefined}
                onClick={() => setSection(item.id)}
              >
                <span className="system-settings-nav__icon">
                  <Icon name={item.icon} size={17} />
                </span>
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.description}</small>
                </span>
                <Icon name="chevron" size={14} />
              </button>
            ))}
          </nav>

          <main className="system-settings-content">
            {section === "connection" ? (
              <>
                <div className="settings-page-heading">
                  <span className="eyebrow">Repository</span>
                  <h2>仓库连接</h2>
                  <p>配置文章来源。保存后，拉取和推送会立即使用新的连接。</p>
                </div>
                <form
                  className="settings-panel settings-edit-form"
                  onSubmit={(event) => void saveRepository(event)}
                >
                  <div className="settings-field settings-field--wide">
                    <label>仓库类型</label>
                    <SelectMenu
                      label="仓库类型"
                      value={repository.provider}
                      disabled={repositoryLoading || repositorySaving}
                      options={[
                        { value: "github", label: "GitHub 远端仓库" },
                        { value: "gitee", label: "Gitee 远端仓库" },
                        { value: "filesystem", label: "本地文件仓库" },
                      ]}
                      onChange={(provider) => {
                        setRepository((current) => ({ ...current, provider }));
                        markRepositoryDirty();
                      }}
                    />
                  </div>
                  <div className={`repository-connection-state is-${connectionState}`} role="status" aria-live="polite">
                    <span className="repository-connection-state__icon">
                      {connectionState === "checking" ? <span className="spinner" /> : <span className="connection-dot" />}
                    </span>
                    <span>
                      <strong>
                        {connectionState === "connected" ? "连接正常" :
                          connectionState === "failed" ? "连接失败" :
                          connectionState === "dirty" ? "配置尚未验证" :
                          connectionState === "checking" ? "正在检测连接" : "等待检测"}
                      </strong>
                      <small>
                        {repositoryFeedback?.text ?? (connectionState === "dirty" ? "地址或凭证已改变，请测试后保存。" : "将验证仓库、分支和访问权限。")}
                      </small>
                    </span>
                  </div>
                  {repository.provider === "github" || repository.provider === "gitee" ? (
                    <>
                      <div className="settings-field settings-field--wide">
                        <label htmlFor="settings-repo-url">
                          {repository.provider === "gitee" ? "Gitee" : "GitHub"} 仓库
                        </label>
                        <input
                          id="settings-repo-url"
                          value={repositoryUrl}
                          onChange={(event) => {
                            setRepositoryUrl(event.target.value);
                            markRepositoryDirty();
                          }}
                          placeholder={`https://${repository.provider === "gitee" ? "gitee.com" : "github.com"}/you/blog`}
                          required
                        />
                        <small>支持完整地址或 owner/repository</small>
                      </div>
                      <div className="settings-field settings-field--wide">
                        <label htmlFor="settings-repo-token">
                          {repository.provider === "gitee" ? "Gitee" : "GitHub"} Token
                        </label>
                        <input
                          id="settings-repo-token"
                          type="password"
                          value={repositoryToken}
                          onChange={(event) => {
                            setRepositoryToken(event.target.value);
                            markRepositoryDirty();
                          }}
                          placeholder={
                            repository.tokenConfigured
                              ? "已配置；留空则保持不变"
                              : repository.provider === "gitee" ? "Gitee 私人令牌" : "github_pat_..."
                          }
                          autoComplete="new-password"
                        />
                        <small>
                          只发送到服务端，使用 AES-GCM 加密后写入数据库。
                        </small>
                      </div>
                    </>
                  ) : (
                    <div className="settings-field settings-field--wide">
                      <label htmlFor="settings-repo-path">
                        本地仓库绝对路径
                      </label>
                      <input
                        id="settings-repo-path"
                        value={repository.filesystemPath}
                        onChange={(event) => {
                          setRepository((current) => ({
                            ...current,
                            filesystemPath: event.target.value,
                          }));
                          markRepositoryDirty();
                        }}
                        placeholder="/path/to/blog"
                        required
                      />
                    </div>
                  )}
                  <div className="settings-field">
                    <label htmlFor="settings-repo-branch">分支</label>
                    <input
                      id="settings-repo-branch"
                      value={repository.branch}
                      onChange={(event) => {
                        setRepository((current) => ({
                          ...current,
                          branch: event.target.value,
                        }));
                        markRepositoryDirty();
                      }}
                      placeholder="留空自动识别"
                      disabled={repository.provider === "filesystem"}
                    />
                    <small>保存时读取仓库默认分支</small>
                  </div>
                  <div className="settings-field">
                    <label htmlFor="settings-content-root">文章目录</label>
                    <input
                      id="settings-content-root"
                      value={repository.contentRoot}
                      onChange={(event) => {
                        setRepository((current) => ({
                          ...current,
                          contentRoot: event.target.value,
                        }));
                        markRepositoryDirty();
                      }}
                      placeholder="src/content"
                      required
                    />
                  </div>
                  <footer className="settings-form-footer">
                    <span className="settings-feedback" />
                    <button
                      className="button button--quiet"
                      type="button"
                      disabled={repositoryLoading || repositorySaving || repositoryTesting}
                      onClick={() => void testRepository()}
                    >
                      {repositoryTesting ? <span className="spinner" /> : <Icon name="refresh" />}
                      {repositoryTesting ? "正在测试…" : "测试连接"}
                    </button>
                    <button
                      className="button button--primary"
                      type="submit"
                      disabled={repositoryLoading || repositorySaving || repositoryTesting}
                    >
                      {repositorySaving ? (
                        <span className="spinner" />
                      ) : (
                        <Icon name="save" />
                      )}
                      {repositorySaving ? "正在保存…" : "保存连接"}
                    </button>
                  </footer>
                </form>
              </>
            ) : null}

            {section === "automation" ? (
              <>
                <div className="settings-page-heading">
                  <span className="eyebrow">Automation</span>
                  <h2>自动化</h2>
                  <p>调整自动保存和服务主动检查仓库的频率。</p>
                </div>
                <section className="settings-panel settings-panel--form">
                  <div className="settings-row">
                    <span>
                      <strong>自动保存延迟</strong>
                      <small>停止输入后，将改动保存到 CMS 数据库。</small>
                    </span>
                    <SelectMenu
                      label="自动保存延迟"
                      value={automationSettings.autoSaveSeconds}
                      disabled={automationSaving}
                      options={[1, 3, 5, 10, 30].map((value) => ({
                        value,
                        label: `${value} 秒`,
                      }))}
                      onChange={(autoSaveSeconds) =>
                        onAutomationChange({
                          ...automationSettings,
                          autoSaveSeconds,
                        })
                      }
                    />
                  </div>
                  <div className="settings-row">
                    <span>
                      <strong>自动拉取仓库</strong>
                      <small>定时获取远端文章，并在写入前执行冲突检查。</small>
                    </span>
                    <SelectMenu
                      label="自动拉取仓库周期"
                      value={automationSettings.autoSyncMinutes}
                      disabled={automationSaving}
                      options={[
                        { value: 0, label: "仅手动" },
                        { value: 5, label: "5 分钟" },
                        { value: 15, label: "15 分钟" },
                        { value: 30, label: "30 分钟" },
                        { value: 60, label: "1 小时" },
                      ]}
                      onChange={(autoSyncMinutes) =>
                        onAutomationChange({
                          ...automationSettings,
                          autoSyncMinutes,
                        })
                      }
                    />
                  </div>
                  {automationSaving ? (
                    <p className="settings-saving">
                      <span className="spinner" />
                      正在保存设置…
                    </p>
                  ) : null}
                </section>
              </>
            ) : null}

            {section === "security" ? (
              <>
                <div className="settings-page-heading">
                  <span className="eyebrow">Security</span>
                  <h2>修改密码</h2>
                  <p>
                    调整密码哈希强度，也可以同时修改登录密码。保存后，其他设备需要重新登录。
                  </p>
                </div>
                <form
                  className="settings-panel settings-password-form"
                  onSubmit={(event) => void changePassword(event)}
                >
                  <div className="settings-field settings-field--wide">
                    <label htmlFor="settings-current-password">当前密码</label>
                    <input
                      id="settings-current-password"
                      type="password"
                      value={passwords.current}
                      onChange={(event) =>
                        setPasswords((current) => ({
                          ...current,
                          current: event.target.value,
                        }))
                      }
                      autoComplete="current-password"
                      required
                    />
                  </div>
                  <div className="settings-field settings-field--wide">
                    <label>密码哈希强度</label>
                    <SelectMenu
                      label="密码哈希强度"
                      value={passwordIterations}
                      disabled={passwordSaving}
                      options={[
                        { value: 100_000, label: "100,000 轮（默认）" },
                        { value: 150_000, label: "150,000 轮" },
                        { value: 210_000, label: "210,000 轮" },
                      ]}
                      onChange={setPasswordIterations}
                    />
                    <small>
                      Cloudflare 免费 Worker 建议保持 100,000 轮；更高强度会消耗更多 CPU。
                    </small>
                  </div>
                  <div className="settings-field">
                    <label htmlFor="settings-new-password">新密码</label>
                    <input
                      id="settings-new-password"
                      type="password"
                      value={passwords.next}
                      onChange={(event) =>
                        setPasswords((current) => ({
                          ...current,
                          next: event.target.value,
                        }))
                      }
                      autoComplete="new-password"
                      minLength={8}
                    />
                    <small>留空表示仅调整安全强度；修改时至少 8 个字符</small>
                  </div>
                  <div className="settings-field">
                    <label htmlFor="settings-confirm-password">
                      确认新密码
                    </label>
                    <input
                      id="settings-confirm-password"
                      type="password"
                      value={passwords.confirm}
                      onChange={(event) =>
                        setPasswords((current) => ({
                          ...current,
                          confirm: event.target.value,
                        }))
                      }
                      autoComplete="new-password"
                      minLength={8}
                    />
                  </div>
                  <footer className="settings-form-footer">
                    <span
                      className={
                        passwordFeedback
                          ? `settings-feedback is-${passwordFeedback.kind}`
                          : "settings-feedback"
                      }
                      role="status"
                    >
                      {passwordFeedback?.text}
                    </span>
                    <button
                      className="button button--primary"
                      type="submit"
                      disabled={passwordSaving}
                    >
                      {passwordSaving ? (
                        <span className="spinner" />
                      ) : (
                        <Icon name="save" />
                      )}
                      {passwordSaving ? "正在保存…" : "保存安全设置"}
                    </button>
                  </footer>
                </form>
              </>
            ) : null}
          </main>
        </div>
      </section>
    </div>
  );
}
