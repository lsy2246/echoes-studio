import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Icon } from "./Icons";

interface MoveArticleDialogProps {
  open: boolean;
  currentPath: string;
  contentRoot: string;
  occupiedPaths: string[];
  onClose: () => void;
  onMove: (path: string) => void;
}

function normalizedPath(value: string): string {
  return value.trim().replaceAll("\\", "/").replace(/\/{2,}/g, "/");
}

export function MoveArticleDialog({
  open,
  currentPath,
  contentRoot,
  occupiedPaths,
  onClose,
  onMove,
}: MoveArticleDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const [nextPath, setNextPath] = useState(currentPath);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setNextPath(currentPath);
      dialog.showModal();
      requestAnimationFrame(() => inputRef.current?.focus());
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [currentPath, open]);

  const normalized = normalizedPath(nextPath);
  const error = useMemo(() => {
    if (!normalized) return "请输入目标路径。";
    if (!normalized.startsWith(`${contentRoot}/`)) return `目标必须位于 ${contentRoot}/ 下。`;
    if (normalized.split("/").some((part) => !part || part === "." || part === "..")) return "路径中不能包含空目录、. 或 ..。";
    const currentExtension = currentPath.toLowerCase().endsWith(".mdx") ? ".mdx" : ".md";
    if (!normalized.toLowerCase().endsWith(currentExtension)) return `移动时需保留 ${currentExtension} 格式。`;
    if (normalized === currentPath) return "请选择不同的目录或文件名。";
    if (occupiedPaths.includes(normalized)) return "目标路径已经有一篇文章。";
    return null;
  }, [contentRoot, currentPath, normalized, occupiedPaths]);

  return (
    <dialog
      ref={dialogRef}
      className="new-article-dialog move-article-dialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClose={() => { if (open) onClose(); }}
    >
      <form
        method="dialog"
        onSubmit={(event) => {
          event.preventDefault();
          if (!error) onMove(normalized);
        }}
      >
        <header>
          <span className="dialog-icon"><Icon name="move" size={22} /></span>
          <div>
            <span className="eyebrow">Move document</span>
            <h2 id={`${id}-title`}>移动文章</h2>
            <p id={`${id}-description`}>先把新位置保存到 CMS；只有主动同步后，仓库才会写入新文件并删除旧文件。</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭">
            <Icon name="close" />
          </button>
        </header>

        <div className="dialog-fields">
          <div className="move-path-comparison" aria-label="当前路径">
            <span>当前位置</span>
            <code>{currentPath}</code>
          </div>
          <label className="form-field" htmlFor={`${id}-move-path`}>
            <span>移动到</span>
            <div className="path-input">
              <Icon name="folder" size={15} />
              <input
                ref={inputRef}
                id={`${id}-move-path`}
                value={nextPath}
                onChange={(event) => setNextPath(event.target.value)}
                spellCheck={false}
                aria-invalid={Boolean(error)}
              />
            </div>
          </label>
          {error ? <p className="dialog-hint" role="status"><Icon name="warning" />{error}</p> : (
            <p className="dialog-hint dialog-hint--ready"><Icon name="check" />同步后将移动到该路径</p>
          )}
        </div>

        <footer>
          <button className="button button--ghost" type="button" onClick={onClose}>取消</button>
          <button className="button button--primary" type="submit" disabled={Boolean(error)}>
            <Icon name="move" />保存移动
          </button>
        </footer>
      </form>
    </dialog>
  );
}
