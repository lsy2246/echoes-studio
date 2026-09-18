import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Icon } from "./Icons";

interface RenameArticleDialogProps {
  open: boolean;
  currentPath: string;
  occupiedPaths: string[];
  onClose: () => void;
  onRename: (path: string) => void;
}

function splitPath(path: string): { directory: string; filename: string } {
  const separator = path.lastIndexOf("/");
  return separator < 0
    ? { directory: "", filename: path }
    : { directory: path.slice(0, separator), filename: path.slice(separator + 1) };
}

export function RenameArticleDialog({ open, currentPath, occupiedPaths, onClose, onRename }: RenameArticleDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const current = splitPath(currentPath);
  const [filename, setFilename] = useState(current.filename);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setFilename(current.filename);
      dialog.showModal();
      requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.select(); });
    } else if (!open && dialog.open) dialog.close();
  }, [current.filename, open]);

  const normalizedFilename = filename.trim();
  const nextPath = current.directory ? `${current.directory}/${normalizedFilename}` : normalizedFilename;
  const error = useMemo(() => {
    if (!normalizedFilename) return "请输入新的文件名。";
    if (normalizedFilename.includes("/") || normalizedFilename.includes("\\")) return "文件名不能包含目录分隔符；如需更换目录，请使用“移动文章”。";
    if (normalizedFilename === "." || normalizedFilename === "..") return "文件名不能是 . 或 ..。";
    if (/[\u0000-\u001f\u007f]/.test(normalizedFilename)) return "文件名包含不可用字符。";
    const extension = current.filename.toLowerCase().endsWith(".mdx") ? ".mdx" : ".md";
    if (!normalizedFilename.toLowerCase().endsWith(extension)) return `重命名时需保留 ${extension} 格式。`;
    if (nextPath === currentPath) return "请输入不同的文件名。";
    if (occupiedPaths.includes(nextPath)) return "当前目录已经存在同名文章。";
    return null;
  }, [current.filename, currentPath, nextPath, normalizedFilename, occupiedPaths]);

  return (
    <dialog ref={dialogRef} className="new-article-dialog rename-article-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} onCancel={(event) => { event.preventDefault(); onClose(); }} onClose={() => { if (open) onClose(); }}>
      <form method="dialog" onSubmit={(event) => { event.preventDefault(); if (!error) onRename(nextPath); }}>
        <header>
          <span className="dialog-icon"><Icon name="edit" size={22} /></span>
          <div><span className="eyebrow">Rename document</span><h2 id={`${id}-title`}>重命名文章</h2><p id={`${id}-description`}>先在 CMS 中保存新文件名，主动推送后仓库路径才会更新。</p></div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭"><Icon name="close" /></button>
        </header>
        <div className="dialog-fields">
          <div className="move-path-comparison" aria-label="文章所在目录"><span>所在目录</span><code>{current.directory || "/"}</code></div>
          <label className="form-field" htmlFor={`${id}-filename`}><span>新文件名</span><div className="path-input"><Icon name="file" size={15} /><input ref={inputRef} id={`${id}-filename`} value={filename} onChange={(event) => setFilename(event.target.value)} spellCheck={false} aria-invalid={Boolean(error)} /></div></label>
          {error ? <p className="dialog-hint" role="status"><Icon name="warning" />{error}</p> : <p className="dialog-hint dialog-hint--ready"><Icon name="check" />新路径：{nextPath}</p>}
        </div>
        <footer><button className="button button--ghost" type="button" onClick={onClose}>取消</button><button className="button button--primary" type="submit" disabled={Boolean(error)}><Icon name="edit" />保存名称</button></footer>
      </form>
    </dialog>
  );
}
