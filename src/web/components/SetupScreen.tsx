import { useEffect, useId, useState, type FormEvent } from "react";
import type { RepositoryConnectionTestResult } from "../../shared/editor-contract";
import { Icon } from "./Icons";
import { SelectMenu } from "./SelectMenu";

export interface SetupValues {
  password: string;
  repositoryProvider: "github" | "gitee";
  repositoryUrl: string;
  repositoryToken: string;
  branch: string;
  contentRoot: string;
}

interface SetupScreenProps {
  database?: string;
  busy?: boolean;
  error?: string | null;
  onTestRepository: (input: {
    provider: "github" | "gitee";
    repositoryUrl: string;
    repositoryToken: string;
    branch: string;
    contentRoot: string;
  }) => Promise<RepositoryConnectionTestResult>;
  onInitialize: (values: SetupValues) => void | Promise<void>;
}

type SetupConnectionState =
  | "idle"
  | "dirty"
  | "checking"
  | "connected"
  | "failed";

interface SetupRepositoryDraft {
  repositoryUrl: string;
  repositoryToken: string;
}

export function SetupScreen({
  database = "数据库",
  busy = false,
  error,
  onTestRepository,
  onInitialize,
}: SetupScreenProps) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [connectionState, setConnectionState] =
    useState<SetupConnectionState>("idle");
  const [connectionMessage, setConnectionMessage] = useState(
    "填写仓库地址和 Token 后自动检测",
  );
  const [repositoryDrafts, setRepositoryDrafts] = useState<
    Record<"github" | "gitee", SetupRepositoryDraft>
  >({
    github: { repositoryUrl: "", repositoryToken: "" },
    gitee: { repositoryUrl: "", repositoryToken: "" },
  });
  const [values, setValues] = useState({
    password: "",
    confirmPassword: "",
    repositoryProvider: "github" as "github" | "gitee",
    branch: "",
    contentRoot: "src/content",
  });
  const passwordMismatch = Boolean(
    values.confirmPassword && values.password !== values.confirmPassword,
  );
  const activeRepository = repositoryDrafts[values.repositoryProvider];

  useEffect(() => {
    const repositoryUrl = activeRepository.repositoryUrl.trim();
    const repositoryToken = activeRepository.repositoryToken.trim();
    if (!repositoryUrl || !repositoryToken) {
      setConnectionState(repositoryUrl || repositoryToken ? "dirty" : "idle");
      setConnectionMessage(
        repositoryUrl || repositoryToken
          ? "继续填写仓库地址和 Token"
          : "填写仓库地址和 Token 后自动检测",
      );
      return;
    }
    let cancelled = false;
    setConnectionState("dirty");
    setConnectionMessage("配置已改变，准备检测连接");
    const timer = window.setTimeout(() => {
      setConnectionState("checking");
      setConnectionMessage("正在验证仓库、分支和访问权限…");
      void onTestRepository({
        provider: values.repositoryProvider,
        repositoryUrl,
        repositoryToken,
        branch: values.branch.trim(),
        contentRoot: values.contentRoot.trim() || "src/content",
      })
        .then((result) => {
          if (cancelled) return;
          setConnectionState("connected");
          setConnectionMessage(result.message);
        })
        .catch((testError) => {
          if (cancelled) return;
          setConnectionState("failed");
          setConnectionMessage(
            testError instanceof Error ? testError.message : "连接失败，请检查地址和 Token",
          );
        });
    }, 700);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    activeRepository.repositoryToken,
    activeRepository.repositoryUrl,
    onTestRepository,
    values.branch,
    values.contentRoot,
    values.repositoryProvider,
  ]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      busy ||
      values.password.length < 8 ||
      passwordMismatch ||
      connectionState !== "connected"
    )
      return;
    void onInitialize({
      password: values.password,
      repositoryProvider: values.repositoryProvider,
      repositoryUrl: activeRepository.repositoryUrl.trim(),
      repositoryToken: activeRepository.repositoryToken.trim(),
      branch: values.branch.trim(),
      contentRoot: values.contentRoot.trim() || "src/content",
    });
  };

  return (
    <main className="setup-screen">
      <header className="setup-topbar">
        <span className="setup-wordmark">
          <span className="brand-mark" aria-hidden="true">
            E
          </span>
          <span>
            <strong>Echoes Studio</strong>
            <small>首次初始化</small>
          </span>
        </span>
        <span className="setup-topbar__note">
          <Icon name="check" size={15} />
          随机密钥由服务端自动生成
        </span>
      </header>

      <div className="setup-layout">
        <section className="setup-intro">
          <span className="eyebrow">One-time setup</span>
          <h1>只填真正需要你决定的内容。</h1>
          <p>
            数据库已经由部署平台连接。Studio
            会自动创建会话密钥、内部令牌和默认同步配置，不再要求你手工生成随机字符串。
          </p>
          <ol className="setup-steps">
            <li className="is-active">
              <span>1</span>
              <div>
                <strong>创建登录密码</strong>
                <small>用于进入你的工作台</small>
              </div>
            </li>
            <li className="is-active">
              <span>2</span>
              <div>
                <strong>授权内容仓库</strong>
                <small>粘贴仓库地址和 Token</small>
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                <strong>开始写作</strong>
                <small>分支与文章目录使用自动默认值</small>
              </div>
            </li>
          </ol>
          <div className="setup-database-card">
            <span className="setup-database-card__icon">
              <Icon name="cloud" size={17} />
            </span>
            <div>
              <strong>数据库已连接</strong>
              <small>{database}</small>
            </div>
            <span className="setup-status setup-status--neutral">READY</span>
          </div>
        </section>

        <section className="setup-card" aria-labelledby={`${id}-title`}>
          <header>
            <div>
              <span className="eyebrow">Initialize</span>
              <h2 id={`${id}-title`}>初始化工作台</h2>
            </div>
            <span className="setup-counter">一次完成</span>
          </header>
          <form onSubmit={submit}>
            <div className="setup-fields">
              <fieldset className="setup-fieldset">
                <legend>登录密码</legend>
                <p>以后只需要使用这个密码登录，不需要保存系统生成的密钥。</p>
                <div className="setup-grid setup-grid--passwords">
                  <label className="setup-field">
                    <span>密码</span>
                    <div className="setup-input">
                      <Icon name="command" size={16} />
                      <input
                        type={visible ? "text" : "password"}
                        value={values.password}
                        onChange={(event) =>
                          setValues((current) => ({
                            ...current,
                            password: event.target.value,
                          }))
                        }
                        minLength={8}
                        autoComplete="new-password"
                        autoFocus
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setVisible((current) => !current)}
                        aria-label={visible ? "隐藏密码" : "显示密码"}
                      >
                        <Icon name="preview" size={16} />
                      </button>
                    </div>
                    <small>至少 8 个字符</small>
                  </label>
                  <label className="setup-field">
                    <span>确认密码</span>
                    <div className="setup-input">
                      <Icon name="check" size={16} />
                      <input
                        type={visible ? "text" : "password"}
                        value={values.confirmPassword}
                        onChange={(event) =>
                          setValues((current) => ({
                            ...current,
                            confirmPassword: event.target.value,
                          }))
                        }
                        aria-invalid={passwordMismatch}
                        autoComplete="new-password"
                        required
                      />
                    </div>
                    {passwordMismatch ? (
                      <small className="setup-field-error">
                        两次输入的密码不一致
                      </small>
                    ) : (
                      <small>再次输入密码</small>
                    )}
                  </label>
                </div>
              </fieldset>

              <fieldset className="setup-fieldset">
                <legend>远端内容仓库</legend>
                <p>
                  选择 GitHub 或 Gitee，填入仓库地址和 Token，所有者、仓库名和默认分支会自动识别。
                </p>
                <label className="setup-field setup-field--provider">
                  <span>仓库平台</span>
                  <SelectMenu<"github" | "gitee">
                    label="仓库平台"
                    value={values.repositoryProvider}
                    options={[
                      { value: "github", label: "GitHub" },
                      { value: "gitee", label: "Gitee" },
                    ]}
                    onChange={(repositoryProvider) =>
                      setValues((current) => ({
                        ...current,
                        repositoryProvider,
                      }))
                    }
                  />
                </label>
                <div className="setup-grid">
                  <label className="setup-field">
                    <span>仓库地址</span>
                    <div className="setup-input">
                      <Icon name="cloud" size={16} />
                      <input
                        value={activeRepository.repositoryUrl}
                        onChange={(event) =>
                          setRepositoryDrafts((current) => ({
                            ...current,
                            [values.repositoryProvider]: {
                              ...current[values.repositoryProvider],
                              repositoryUrl: event.target.value,
                            },
                          }))
                        }
                        placeholder={`https://${values.repositoryProvider === "gitee" ? "gitee.com" : "github.com"}/you/blog`}
                        inputMode="url"
                        required
                      />
                    </div>
                  </label>
                  <label className="setup-field">
                    <span>{values.repositoryProvider === "gitee" ? "Gitee" : "GitHub"} Token</span>
                    <div className="setup-input setup-input--token">
                      <Icon name="command" size={16} />
                      <input
                        type="password"
                        value={activeRepository.repositoryToken}
                        onChange={(event) =>
                          setRepositoryDrafts((current) => ({
                            ...current,
                            [values.repositoryProvider]: {
                              ...current[values.repositoryProvider],
                              repositoryToken: event.target.value,
                            },
                          }))
                        }
                        placeholder={values.repositoryProvider === "gitee" ? "Gitee 私人令牌" : "github_pat_..."}
                        autoComplete="off"
                        required
                      />
                    </div>
                    <small>
                      {values.repositoryProvider === "gitee"
                        ? "Token 需要目标仓库的读写权限"
                        : "Token 只需授予目标仓库的 Contents 读写权限"}
                    </small>
                  </label>
                </div>
                <div
                  className={`setup-connection-state is-${connectionState}`}
                  role="status"
                  aria-live="polite"
                >
                  <span className="setup-connection-state__icon">
                    {connectionState === "checking" ? (
                      <span className="spinner" />
                    ) : (
                      <span className="connection-dot" />
                    )}
                  </span>
                  <span>
                    <strong>
                      {connectionState === "connected"
                        ? "连接成功"
                        : connectionState === "failed"
                          ? "连接失败"
                          : connectionState === "checking"
                            ? "正在检测"
                            : connectionState === "dirty"
                              ? "等待检测"
                              : "尚未检测"}
                    </strong>
                    <small>{connectionMessage}</small>
                  </span>
                </div>
              </fieldset>

              <div className="setup-advanced">
                <button
                  className="setup-advanced__trigger"
                  type="button"
                  aria-expanded={advanced}
                  onClick={() => setAdvanced((current) => !current)}
                >
                  <span>
                    <Icon name="settings" size={15} />
                    高级选项
                  </span>
                  <span>
                    通常不需要修改 <Icon name="chevron" size={13} />
                  </span>
                </button>
                {advanced ? (
                  <div className="setup-advanced__content">
                    <label className="setup-field">
                      <span>分支</span>
                      <input
                        value={values.branch}
                        onChange={(event) =>
                          setValues((current) => ({
                            ...current,
                            branch: event.target.value,
                          }))
                        }
                        placeholder="自动读取默认分支"
                      />
                    </label>
                    <label className="setup-field">
                      <span>文章目录</span>
                      <input
                        value={values.contentRoot}
                        onChange={(event) =>
                          setValues((current) => ({
                            ...current,
                            contentRoot: event.target.value,
                          }))
                        }
                        placeholder="src/content"
                        required
                      />
                    </label>
                  </div>
                ) : null}
              </div>

              {error ? (
                <p className="setup-form-error" role="alert">
                  <Icon name="warning" size={16} />
                  {error}
                </p>
              ) : null}
            </div>
            <footer>
              <p>
                <Icon name="check" size={15} />
                安装密钥和内部令牌会自动生成
              </p>
              <button
                className="button button--primary setup-submit"
                type="submit"
                disabled={
                  busy ||
                  passwordMismatch ||
                  values.password.length < 8 ||
                  connectionState !== "connected"
                }
              >
                {busy ? <span className="spinner" /> : <Icon name="chevron" />}
                {busy ? "正在初始化…" : "完成并进入工作台"}
              </button>
            </footer>
          </form>
        </section>
      </div>
    </main>
  );
}
