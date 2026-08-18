import { useEffect, useId, useState, type FormEvent } from "react";
import type {
  AutomationSettings,
  RepositoryConnectionSettings,
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
  onChangePassword: (
    currentPassword: string,
    newPassword: string,
  ) => Promise<void>;
  onLoadInternalToken: () => Promise<string>;
  onRotateInternalToken: () => Promise<string>;
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
): { owner: string; repository: string } | null {
  const normalized = value
    .trim()
    .replace(/^git@github\.com:/i, "")
    .replace(/^https?:\/\/(?:www\.)?github\.com\//i, "")
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
  onChangePassword,
  onLoadInternalToken,
  onRotateInternalToken,
  onClose,
}: SystemSettingsDialogProps) {
  const titleId = useId();
  const [section, setSection] = useState<SettingsSection>("connection");
  const [repository, setRepository] = useState(EMPTY_REPOSITORY);
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [repositoryToken, setRepositoryToken] = useState("");
  const [repositoryLoading, setRepositoryLoading] = useState(true);
  const [repositorySaving, setRepositorySaving] = useState(false);
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
  const [passwordFeedback, setPasswordFeedback] = useState<{
    kind: "error" | "success";
    text: string;
  } | null>(null);
  const [internalToken, setInternalToken] = useState("");
  const [internalTokenBusy, setInternalTokenBusy] = useState(false);

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
  }, [onLoadRepository]);

  const saveRepository = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setRepositorySaving(true);
    setRepositoryFeedback(null);
    try {
      const coordinates =
        repository.provider === "github"
          ? parseRepositoryAddress(repositoryUrl)
          : null;
      if (repository.provider === "github" && !coordinates) {
        setRepositoryFeedback({
          kind: "error",
          text: "请输入 owner/repository 或完整 GitHub 仓库地址。",
        });
        return;
      }
      const saved = await onSaveRepository({
        provider: repository.provider,
        owner: coordinates?.owner ?? repository.owner,
        repository: coordinates?.repository ?? repository.repository,
        branch: repository.branch,
        contentRoot: repository.contentRoot,
        filesystemPath: repository.filesystemPath,
        token: repositoryToken || undefined,
      });
      setRepository(saved);
      setRepositoryUrl(repositoryAddress(saved));
      setRepositoryToken("");
      setRepositoryFeedback({
        kind: "success",
        text: "仓库连接已保存并立即生效。",
      });
    } catch (error) {
      setRepositoryFeedback({ kind: "error", text: message(error) });
    } finally {
      setRepositorySaving(false);
    }
  };

  const changePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPasswordFeedback(null);
    if (passwords.next.length < 8) {
      setPasswordFeedback({ kind: "error", text: "新密码至少需要 8 个字符。" });
      return;
    }
    if (passwords.next !== passwords.confirm) {
      setPasswordFeedback({ kind: "error", text: "两次输入的新密码不一致。" });
      return;
    }
    setPasswordSaving(true);
    try {
      await onChangePassword(passwords.current, passwords.next);
      setPasswords({ current: "", next: "", confirm: "" });
      setPasswordFeedback({
        kind: "success",
        text: "密码已修改，其他浏览器会话已失效。",
      });
    } catch (error) {
      setPasswordFeedback({ kind: "error", text: message(error) });
    } finally {
      setPasswordSaving(false);
    }
  };

  const revealInternalToken = async () => {
    setInternalTokenBusy(true);
    try {
      setInternalToken(await onLoadInternalToken());
    } catch (error) {
      setRepositoryFeedback({ kind: "error", text: message(error) });
    } finally {
      setInternalTokenBusy(false);
    }
  };

  const rotateInternalToken = async () => {
    setInternalTokenBusy(true);
    try {
      setInternalToken(await onRotateInternalToken());
    } catch (error) {
      setRepositoryFeedback({ kind: "error", text: message(error) });
    } finally {
      setInternalTokenBusy(false);
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
                        { value: "filesystem", label: "本地文件仓库" },
                      ]}
                      onChange={(provider) =>
                        setRepository((current) => ({ ...current, provider }))
                      }
                    />
                  </div>
                  {repository.provider === "github" ? (
                    <>
                      <div className="settings-field settings-field--wide">
                        <label htmlFor="settings-repo-url">GitHub 仓库</label>
                        <input
                          id="settings-repo-url"
                          value={repositoryUrl}
                          onChange={(event) =>
                            setRepositoryUrl(event.target.value)
                          }
                          placeholder="https://github.com/you/blog"
                          required
                        />
                        <small>支持完整地址或 owner/repository</small>
                      </div>
                      <div className="settings-field settings-field--wide">
                        <label htmlFor="settings-repo-token">
                          GitHub Token
                        </label>
                        <input
                          id="settings-repo-token"
                          type="password"
                          value={repositoryToken}
                          onChange={(event) =>
                            setRepositoryToken(event.target.value)
                          }
                          placeholder={
                            repository.tokenConfigured
                              ? "已配置；留空则保持不变"
                              : "github_pat_..."
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
                        onChange={(event) =>
                          setRepository((current) => ({
                            ...current,
                            filesystemPath: event.target.value,
                          }))
                        }
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
                      onChange={(event) =>
                        setRepository((current) => ({
                          ...current,
                          branch: event.target.value,
                        }))
                      }
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
                      onChange={(event) =>
                        setRepository((current) => ({
                          ...current,
                          contentRoot: event.target.value,
                        }))
                      }
                      placeholder="src/content"
                      required
                    />
                  </div>
                  <footer className="settings-form-footer">
                    <span
                      className={
                        repositoryFeedback
                          ? `settings-feedback is-${repositoryFeedback.kind}`
                          : "settings-feedback"
                      }
                      role="status"
                    >
                      {repositoryFeedback?.text}
                    </span>
                    <button
                      className="button button--primary"
                      type="submit"
                      disabled={repositoryLoading || repositorySaving}
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
                <section className="settings-panel settings-panel--form">
                  <div className="settings-row">
                    <span>
                      <strong>外部调度令牌</strong>
                      <small>
                        仅 EdgeOne、Vercel 等外部定时器调用自动拉取接口时需要。
                      </small>
                    </span>
                    <button
                      className="button button--quiet"
                      type="button"
                      disabled={internalTokenBusy}
                      onClick={() => void revealInternalToken()}
                    >
                      {internalTokenBusy ? (
                        <span className="spinner" />
                      ) : (
                        <Icon name="preview" />
                      )}
                      {internalToken ? "重新显示" : "显示令牌"}
                    </button>
                  </div>
                  {internalToken ? (
                    <div className="settings-field settings-field--wide">
                      <label htmlFor="settings-internal-token">
                        已自动生成
                      </label>
                      <input
                        id="settings-internal-token"
                        value={internalToken}
                        readOnly
                        onFocus={(event) => event.currentTarget.select()}
                      />
                      <small>
                        复制到受信任调度器的 Bearer
                        Token。重新生成后，旧令牌立即失效。
                      </small>
                      <button
                        className="button button--quiet"
                        type="button"
                        disabled={internalTokenBusy}
                        onClick={() => void rotateInternalToken()}
                      >
                        <Icon name="refresh" />
                        重新生成
                      </button>
                    </div>
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
                    修改工作台登录密码。保存后，其他设备需要使用新密码重新登录。
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
                      required
                    />
                    <small>至少 8 个字符</small>
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
                      required
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
                      {passwordSaving ? "正在修改…" : "修改密码"}
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
