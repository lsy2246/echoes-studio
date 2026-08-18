import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type {
  ArticleFormat,
  EditorView,
  MarkdownEditorDriver,
} from "../../shared/editor-contract";
import { validateSource } from "../lib/mdx";
import {
  normalizeNestedFencesForCherry,
  restoreNestedFencesFromCherry,
} from "../lib/markdown-preview";
import { formatMarkdown } from "../lib/format-markdown";
import {
  CherryMarkdownAdapter,
  type CherryInstanceLike,
} from "./cherry-adapter";

interface CherryEditorProps {
  value: string;
  format: ArticleFormat;
  view: EditorView;
  readOnly?: boolean;
  onChange: (source: string) => void;
  onUpload?: (file: File) => Promise<{ url: string; name?: string }>;
  onUploadError?: (error: unknown) => void;
  onFormat?: (changed: boolean) => void;
  onFormatError?: (error: unknown) => void;
  onReady?: () => void;
}

interface CherryOptions {
  id: string;
  value: string;
  locale: "zh_CN";
  editor: {
    defaultModel: EditorView;
    height: string;
    convertWhenPaste: boolean;
  };
  engine: {
    syntax: {
      table: { enableChart: false };
    };
  };
  toolbars: {
    showToolbar: boolean;
    toolbar: string[];
    toolbarRight: string[];
    bubble: string[];
    float: string[];
    customMenu?: Record<string, CherryMenuConstructor>;
  };
  callback: {
    afterInit: (markdown: string, html: string) => void;
    afterChange: (markdown: string, html: string) => void;
  };
  fileUpload?: (
    file: File,
    callback: (url: string, params?: { name?: string }) => void,
  ) => void;
}

type CherryMenuConstructor = new (instance: unknown) => unknown;

interface CherryConstructor {
  new (options: CherryOptions): CherryInstanceLike;
  createMenuHook: (
    name: string,
    options: {
      icon: {
        type: "svg";
        content: string;
        iconStyle?: string;
      };
      onClick: () => void;
    },
  ) => CherryMenuConstructor;
}

const FORMAT_ICON = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">',
  '<path d="M4 6h10M4 12h16M4 18h10"/>',
  '<path d="m17 4 1.1 2.4L20.5 7.5l-2.4 1.1L17 11l-1.1-2.4-2.4-1.1 2.4-1.1L17 4Z"/>',
  "</svg>",
].join("");

const STANDARD_TOOLBAR = [
  "undo",
  "redo",
  "|",
  "header",
  "bold",
  "italic",
  "strikethrough",
  "|",
  "list",
  "quote",
  "link",
  "code",
  "graph",
  "table",
  "hr",
  "formatMarkdown",
  "search",
];

export const CherryEditor = forwardRef<MarkdownEditorDriver, CherryEditorProps>(
  function CherryEditor(
    {
      value,
      format,
      view,
      readOnly = false,
      onChange,
      onUpload,
      onUploadError,
      onFormat,
      onFormatError,
      onReady,
    },
    forwardedRef,
  ) {
    const reactId = useId();
    const hostId = `cms-cherry-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
    const hostRef = useRef<HTMLDivElement>(null);
    const driverRef = useRef<CherryMarkdownAdapter | null>(null);
    const valueRef = useRef(value);
    const formatRef = useRef(format);
    const onChangeRef = useRef(onChange);
    const onUploadRef = useRef(onUpload);
    const onUploadErrorRef = useRef(onUploadError);
    const onFormatRef = useRef(onFormat);
    const onFormatErrorRef = useRef(onFormatError);
    const onReadyRef = useRef(onReady);
    const [loadError, setLoadError] = useState<string | null>(null);

    valueRef.current = value;
    formatRef.current = format;
    onChangeRef.current = onChange;
    onUploadRef.current = onUpload;
    onUploadErrorRef.current = onUploadError;
    onFormatRef.current = onFormat;
    onFormatErrorRef.current = onFormatError;
    onReadyRef.current = onReady;
    useImperativeHandle(
      forwardedRef,
      (): MarkdownEditorDriver => ({
        getSource: () => {
          const source = driverRef.current?.getSource() ?? valueRef.current;
          return restoreNestedFencesFromCherry(source);
        },
        setSource: (source, keepCursor) => driverRef.current?.setSource(
          normalizeNestedFencesForCherry(source),
          keepCursor,
        ),
        insert: (source, select) => driverRef.current?.insert(source, select),
        setView: (nextView) => driverRef.current?.setView(nextView),
        focus: () => driverRef.current?.focus(),
        validate: () => driverRef.current?.validate() ?? validateSource(valueRef.current),
        destroy: () => driverRef.current?.destroy(),
      }),
      [],
    );

    useLayoutEffect(() => {
      let disposed = false;
      setLoadError(null);

      void import("cherry-markdown").then((module) => {
        if (disposed) return;
        const CherryClass = module.default as unknown as CherryConstructor;
        let instance: CherryInstanceLike | null = null;
        let formatting = false;
        const FormatMarkdownMenu = CherryClass.createMenuHook("formatMarkdown", {
          icon: {
            type: "svg",
            content: FORMAT_ICON,
            iconStyle: "width:16px;height:16px",
          },
          onClick: () => {
            if (!instance || formatting) return;
            const currentSource = restoreNestedFencesFromCherry(instance.getMarkdown());
            const formatButton = hostRef.current?.querySelector<HTMLElement>(
              ".cherry-toolbar-formatMarkdown",
            );
            formatting = true;
            formatButton?.setAttribute("aria-busy", "true");
            formatButton?.classList.add("is-formatting");

            void formatMarkdown(currentSource, formatRef.current)
              .then((formattedSource) => {
                if (disposed || !instance) return;
                const changed = formattedSource !== currentSource;
                if (changed) {
                  valueRef.current = formattedSource;
                  instance.setMarkdown(normalizeNestedFencesForCherry(formattedSource), true);
                  onChangeRef.current(formattedSource);
                }
                onFormatRef.current?.(changed);
              })
              .catch((error: unknown) => onFormatErrorRef.current?.(error))
              .finally(() => {
                formatting = false;
                formatButton?.removeAttribute("aria-busy");
                formatButton?.classList.remove("is-formatting");
              });
          },
        });

        instance = new CherryClass({
          id: hostId,
          value: normalizeNestedFencesForCherry(valueRef.current),
          locale: "zh_CN",
          editor: {
            defaultModel: readOnly ? "editOnly" : view,
            height: "100%",
            convertWhenPaste: true,
          },
          engine: {
            syntax: {
              table: { enableChart: false },
            },
          },
          toolbars: {
            showToolbar: !readOnly,
            toolbar: readOnly
              ? []
              : onUploadRef.current
                ? [...STANDARD_TOOLBAR.slice(0, -1), "image", "search"]
                : STANDARD_TOOLBAR,
            toolbarRight: readOnly ? [] : ["fullScreen"],
            bubble: readOnly ? [] : ["bold", "italic", "strikethrough", "quote"],
            float: [],
            customMenu: readOnly ? undefined : {
              formatMarkdown: FormatMarkdownMenu,
            },
          },
          callback: {
            afterInit: () => {
              if (disposed) return;
              const editable = hostRef.current?.querySelector<HTMLElement>(
                "textarea, [contenteditable='true']",
              );
              editable?.setAttribute("aria-label", "文章 Markdown 源码");
              const graphButton = hostRef.current?.querySelector<HTMLElement>(
                ".cherry-toolbar-graph",
              );
              graphButton?.setAttribute("title", "插入 Mermaid 图表");
              graphButton?.setAttribute("aria-label", "插入 Mermaid 图表");
              const formatButton = hostRef.current?.querySelector<HTMLElement>(
                ".cherry-toolbar-formatMarkdown",
              );
              formatButton?.setAttribute("title", "格式化 Markdown");
              formatButton?.setAttribute("aria-label", "格式化 Markdown");
              onReadyRef.current?.();
            },
            afterChange: (markdown) => {
              const canonicalMarkdown = restoreNestedFencesFromCherry(markdown);
              if (disposed || canonicalMarkdown === valueRef.current) return;
              valueRef.current = canonicalMarkdown;
              onChangeRef.current(canonicalMarkdown);
            },
          },
          fileUpload: onUploadRef.current
            ? (file, callback) => {
                void onUploadRef.current?.(file)
                  .then((asset) => callback(asset.url, { name: asset.name ?? file.name }))
                  .catch((error: unknown) => onUploadErrorRef.current?.(error));
              }
            : undefined,
        });

        const adapter = new CherryMarkdownAdapter(instance, validateSource);
        driverRef.current = adapter;
      }).catch((error: unknown) => {
        if (disposed) return;
        setLoadError(error instanceof Error ? error.message : "Cherry Markdown 初始化失败。");
      });

      return () => {
        disposed = true;
        driverRef.current?.destroy();
        driverRef.current = null;
        if (hostRef.current) hostRef.current.replaceChildren();
      };
    }, [hostId, readOnly]);

    useEffect(() => {
      const driver = driverRef.current;
      const editorValue = normalizeNestedFencesForCherry(value);
      if (!driver || driver.getSource() === editorValue) return;
      valueRef.current = value;
      driver.setSource(editorValue, true);
    }, [value]);

    useEffect(() => {
      driverRef.current?.setView(readOnly ? "editOnly" : view);
    }, [readOnly, view]);

    return (
      <section
        className="cms-cherry"
        aria-label="Markdown 编辑器"
      >
        {loadError ? (
          <div className="editor-load-error" role="alert">
            <strong>编辑器无法启动</strong>
            <p>{loadError}</p>
            <p>请确认已安装 cherry-markdown@0.11.9，并刷新页面。</p>
          </div>
        ) : null}
        <div id={hostId} ref={hostRef} className="cms-cherry__host" />
      </section>
    );
  },
);
