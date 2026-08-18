import { useId, useState, type FormEvent } from "react";
import { Icon } from "./Icons";

interface LoginScreenProps {
  busy?: boolean;
  error?: string | null;
  onLogin: (password: string) => void | Promise<void>;
}

export function LoginScreen({ busy = false, error, onLogin }: LoginScreenProps) {
  const id = useId();
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = password.trim();
    if (value && !busy) void onLogin(value);
  };

  return (
    <main className="login-screen">
      <div className="login-atmosphere" aria-hidden="true">
        <span /><span /><span />
      </div>
      <section className="login-card" aria-labelledby={`${id}-title`}>
        <header>
          <div className="login-brand" aria-hidden="true">E</div>
          <span className="eyebrow">Private workspace</span>
          <h1 id={`${id}-title`}>Echoes Studio</h1>
          <p>New Echoes 的 Git 内容工作台</p>
        </header>

        <form onSubmit={submit}>
          <div className="form-field">
            <label htmlFor={`${id}-password`}>登录密码</label>
            <div className="token-input">
              <Icon name="command" size={17} />
              <input
                id={`${id}-password`}
                type={visible ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="输入登录密码"
                autoComplete="current-password"
                autoFocus
                required
                disabled={busy}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? `${id}-error` : `${id}-hint`}
              />
              <button type="button" onClick={() => setVisible((value) => !value)} aria-label={visible ? "隐藏密码" : "显示密码"}>
                <Icon name={visible ? "close" : "preview"} size={17} />
              </button>
            </div>
          </div>

          {error ? (
            <p id={`${id}-error`} className="login-error" role="alert">
              <Icon name="warning" size={17} />{error}
            </p>
          ) : (
            <p id={`${id}-hint`} className="login-hint">
              登录状态由浏览器安全保存，退出时会立即清除。
            </p>
          )}

          <button className="button button--primary login-submit" type="submit" disabled={busy || !password.trim()}>
            {busy ? <span className="spinner" aria-hidden="true" /> : <Icon name="chevron" />}
            {busy ? "正在验证…" : "进入工作台"}
          </button>
        </form>

      </section>
    </main>
  );
}
