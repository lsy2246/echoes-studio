import { useId, useState, type FormEvent } from "react";
import { Icon } from "./Icons";

export interface SetupValues {
  password: string;
  repositoryUrl: string;
  githubToken: string;
  branch: string;
  contentRoot: string;
}

interface SetupScreenProps {
  database?: string;
  busy?: boolean;
  error?: string | null;
  onInitialize: (values: SetupValues) => void | Promise<void>;
}

export function SetupScreen({
  database = "数据库",
  busy = false,
  error,
  onInitialize,
}: SetupScreenProps) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [values, setValues] = useState({
    password: "",
    confirmPassword: "",
    repositoryUrl: "",
    githubToken: "",
    branch: "",
    contentRoot: "src/content",
  });
  const passwordMismatch = Boolean(
    values.confirmPassword && values.password !== values.confirmPassword,
  );

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || values.password.length < 8 || passwordMismatch) return;
    void onInitialize({
      password: values.password,
      repositoryUrl: values.repositoryUrl.trim(),
      githubToken: values.githubToken.trim(),
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
                <legend>GitHub 内容仓库</legend>
                <p>
                  只需要仓库地址和 fine-grained
                  Token，所有者、仓库名和默认分支会自动识别。
                </p>
                <div className="setup-grid">
                  <label className="setup-field">
                    <span>仓库地址</span>
                    <div className="setup-input">
                      <Icon name="cloud" size={16} />
                      <input
                        value={values.repositoryUrl}
                        onChange={(event) =>
                          setValues((current) => ({
                            ...current,
                            repositoryUrl: event.target.value,
                          }))
                        }
                        placeholder="https://github.com/you/blog"
                        inputMode="url"
                        required
                      />
                    </div>
                  </label>
                  <label className="setup-field">
                    <span>GitHub Token</span>
                    <div className="setup-input setup-input--token">
                      <Icon name="command" size={16} />
                      <input
                        type="password"
                        value={values.githubToken}
                        onChange={(event) =>
                          setValues((current) => ({
                            ...current,
                            githubToken: event.target.value,
                          }))
                        }
                        placeholder="github_pat_..."
                        autoComplete="off"
                        required
                      />
                    </div>
                    <small>Token 只需授予目标仓库的 Contents 读写权限</small>
                  </label>
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
                  busy || passwordMismatch || values.password.length < 8
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
