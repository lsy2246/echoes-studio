import { findFencedCodeBlocks } from "../lib/markdown-preview";

interface MermaidInstance {
  getMarkdown: () => string;
  setMarkdown: (source: string, keepCursor?: boolean) => void;
}

export interface LabelTarget {
  from: number;
  to: number;
  value: string;
  replace: (value: string) => string;
}

interface MermaidFigureState {
  figure: HTMLElement;
  canvas: HTMLElement;
  svg: SVGSVGElement;
  scale: number;
  panX: number;
  panY: number;
  cleanup: () => void;
}

const MERMAID_LANGUAGES = new Set(["mermaid"]);
const NODE_ID_PATTERN = /-(?:flowchart|graph)-(.+)-\d+$/;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function visibleText(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function labelText(value: string): string {
  return value
    .replace(/<br\s*\/?>[ \t]*(?:\r?\n[ \t]*)?/gi, "\n")
    .replace(/&quot;/g, '"');
}

function mermaidSource(
  source: string,
  figureIndex: number,
): { from: number; to: number; body: string } | null {
  const block = findFencedCodeBlocks(source).filter((item) =>
    MERMAID_LANGUAGES.has(item.language.toLowerCase()),
  )[figureIndex];
  return block
    ? {
        from: block.from,
        to: block.to,
        body: source.slice(block.from, block.to),
      }
    : null;
}

function lineEntries(body: string): Array<{ text: string; start: number }> {
  const entries: Array<{ text: string; start: number }> = [];
  let start = 0;
  while (start <= body.length) {
    const newline = body.indexOf("\n", start);
    const end = newline === -1 ? body.length : newline;
    entries.push({ text: body.slice(start, end).replace(/\r$/, ""), start });
    if (newline === -1) break;
    start = newline + 1;
  }
  return entries;
}

export function findMermaidNodeLabelTarget(
  body: string,
  id: string,
  baseOffset = 0,
): LabelTarget | null {
  const token = new RegExp(
    `(^|[^A-Za-z0-9_-])(${escapeRegExp(id)})(?=[^A-Za-z0-9_-]|$)`,
  );
  const shapes = [
    ["[(", ")]"],
    ["([", "])"],
    ["[[", "]]"],
    ["{{", "}}"],
    ["((", "))"],
    ["[", "]"],
    ["{", "}"],
    ["(", ")"],
  ] as const;

  for (const line of lineEntries(body)) {
    const trimmed = line.text.trimStart();
    if (
      !trimmed ||
      trimmed.startsWith("%%") ||
      /^(?:flowchart|graph|direction|subgraph|end)\b/.test(trimmed)
    ) {
      continue;
    }
    const match = token.exec(line.text);
    if (!match) continue;
    const tokenStart = (match.index ?? 0) + match[1].length;
    const afterId = line.text.slice(tokenStart + id.length);
    const whitespaceLength = afterId.match(/^[ \t]*/)?.[0].length ?? 0;
    const shapeStart = line.start + tokenStart + id.length + whitespaceLength;
    const delimiters = shapes.find(([open]) => body.startsWith(open, shapeStart));
    if (delimiters) {
      const [open, close] = delimiters;
      const labelStart = shapeStart + open.length;
      const closeIndex = body.indexOf(close, labelStart);
      if (closeIndex < 0) continue;
      const rawLabel = body.slice(labelStart, closeIndex);
      const quoted =
        rawLabel.length >= 2 &&
        ((rawLabel.startsWith('"') && rawLabel.endsWith('"')) ||
          (rawLabel.startsWith("'") && rawLabel.endsWith("'")));
      const labelFrom =
        baseOffset + labelStart + (quoted ? 1 : 0);
      const labelTo = baseOffset + closeIndex - (quoted ? 1 : 0);
      const quote = quoted ? rawLabel[0] : "";
      return {
        from: labelFrom,
        to: labelTo,
        value: labelText(quoted ? rawLabel.slice(1, -1) : rawLabel),
        replace: (value) => {
          const delimiter = quote || '"';
          const escaped = value.replaceAll(
            delimiter,
            delimiter === '"' ? "&quot;" : "&#39;",
          );
          return quote ? escaped : `${delimiter}${escaped}${delimiter}`;
        },
      };
    }
  }

  const fallback = new RegExp(
    `(^|[^A-Za-z0-9_-])(${escapeRegExp(id)})(?=[^A-Za-z0-9_-]|$)`,
  );
  for (const line of lineEntries(body)) {
    const trimmed = line.text.trimStart();
    if (!trimmed || trimmed.startsWith("%%") || trimmed.startsWith("subgraph"))
      continue;
    const match = fallback.exec(line.text);
    if (!match) continue;
    const from = baseOffset + line.start + (match.index ?? 0) + match[1].length;
    const to = from + id.length;
    return {
      from,
      to,
      value: id,
      replace: (value) => `${id}["${value.replaceAll('"', "&quot;")}"]`,
    };
  }
  return null;
}

function subgraphIds(body: string): string[] {
  return lineEntries(body).flatMap(({ text }) => {
    const match = text.match(/^\s*subgraph\s+([A-Za-z0-9_-]+)(?=\s|\[|$)/);
    return match ? [match[1]] : [];
  });
}

export function findMermaidSubgraphLabelTarget(
  body: string,
  id: string,
  baseOffset = 0,
): LabelTarget | null {
  for (const line of lineEntries(body)) {
    const match = line.text.match(/^\s*subgraph\s+([A-Za-z0-9_-]+)\s*/);
    if (!match || match[1] !== id) continue;
    const shapeStart = line.start + match[0].length;
    if (!body.startsWith("[", shapeStart)) continue;
    const labelStart = shapeStart + 1;
    const closeIndex = body.indexOf("]", labelStart);
    if (closeIndex < 0) continue;
    const rawLabel = body.slice(labelStart, closeIndex);
    const quoted =
      rawLabel.length >= 2 &&
      ((rawLabel.startsWith('"') && rawLabel.endsWith('"')) ||
        (rawLabel.startsWith("'") && rawLabel.endsWith("'")));
    const quote = quoted ? rawLabel[0] : "";
    return {
      from: baseOffset + labelStart + (quoted ? 1 : 0),
      to: baseOffset + closeIndex - (quoted ? 1 : 0),
      value: labelText(quoted ? rawLabel.slice(1, -1) : rawLabel),
      replace: (value) => {
        const delimiter = quote || '"';
        const escaped = value.replaceAll(
          delimiter,
          delimiter === '"' ? "&quot;" : "&#39;",
        );
        return quote ? escaped : `${delimiter}${escaped}${delimiter}`;
      },
    };
  }
  return null;
}

function edgeLabelTarget(
  body: string,
  baseOffset: number,
  edgeElement: Element,
  figure: HTMLElement,
): LabelTarget | null {
  const labels = [
    ...figure.querySelectorAll<SVGGElement>("g.edgeLabel"),
  ].filter((element) => visibleText(element.textContent ?? ""));
  const current = edgeElement.closest<SVGGElement>("g.edgeLabel");
  const edgeIndex = current ? labels.indexOf(current) : -1;
  if (edgeIndex < 0) return null;

  const matches: Array<{ from: number; to: number; value: string }> = [];
  for (const line of lineEntries(body)) {
    const pattern = /\|([^|\n]+)\|/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(line.text))) {
      matches.push({
        from: baseOffset + line.start + match.index + 1,
        to: baseOffset + line.start + match.index + match[0].length - 1,
        value: labelText(match[1]),
      });
    }
  }
  const match = matches[edgeIndex];
  if (!match) return null;
  return { ...match, replace: (value) => value.replaceAll("|", "&#124;") };
}

function nodeId(element: Element): string | null {
  const match = element.id.match(NODE_ID_PATTERN);
  return match?.[1] ?? null;
}

function subgraphId(element: Element, body: string): string | null {
  const domId = element.closest<SVGGElement>("g.cluster")?.id ?? "";
  return (
    subgraphIds(body)
      .sort((left, right) => right.length - left.length)
      .find((id) => domId === id || domId.endsWith(`-${id}`)) ?? null
  );
}

function updateTransform(state: MermaidFigureState): void {
  state.svg.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.scale})`;
}

function fitFigure(state: MermaidFigureState): void {
  const viewBox = state.svg.viewBox.baseVal;
  const naturalWidth =
    viewBox.width ||
    Number.parseFloat(state.svg.getAttribute("width") ?? "") ||
    1;
  const naturalHeight =
    viewBox.height ||
    Number.parseFloat(state.svg.getAttribute("height") ?? "") ||
    1;
  const availableWidth = Math.max(1, state.canvas.clientWidth - 32);
  const availableHeight = Math.max(1, state.canvas.clientHeight - 52);
  state.scale = Math.min(
    1,
    availableWidth / naturalWidth,
    availableHeight / naturalHeight,
  );
  state.panX = 0;
  state.panY = 0;
  updateTransform(state);
}

function createButton(
  label: string,
  title: string,
  onClick: () => void,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "cms-mermaid-control";
  button.textContent = label;
  button.title = title;
  button.setAttribute("aria-label", title);
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  return button;
}

function installFigure(
  figure: HTMLElement,
  figureIndex: number,
  instance: MermaidInstance,
  readOnly: boolean,
): MermaidFigureState | null {
  const svg = figure.querySelector<SVGSVGElement>("svg");
  if (!svg || figure.dataset.cmsMermaidReady === "true") return null;
  figure.dataset.cmsMermaidReady = "true";
  figure.classList.add("cms-mermaid-editor");
  figure.classList.toggle("is-read-only", readOnly);
  figure
    .closest(".cherry")
    ?.querySelector<HTMLElement>(".cherry-previewer-img-handler")
    ?.remove();

  const canvas = document.createElement("div");
  canvas.className = "cms-mermaid-canvas";
  svg.parentElement?.insertBefore(canvas, svg);
  canvas.appendChild(svg);

  const state: MermaidFigureState = {
    figure,
    canvas,
    svg,
    scale: 1,
    panX: 0,
    panY: 0,
    cleanup: () => {},
  };

  const toolbar = document.createElement("div");
  toolbar.className = "cms-mermaid-toolbar";
  toolbar.setAttribute("aria-label", "Mermaid 图表视图控制");
  toolbar.append(
    createButton("−", "缩小图表", () => {
      state.scale = Math.max(0.5, +(state.scale - 0.1).toFixed(2));
      updateTransform(state);
    }),
    createButton("＋", "放大图表", () => {
      state.scale = Math.min(4, +(state.scale + 0.1).toFixed(2));
      updateTransform(state);
    }),
    createButton("适应", "适应图表到窗口", () => fitFigure(state)),
  );
  figure.appendChild(toolbar);

  const pointer = { active: false, moved: false, x: 0, y: 0 };
  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    pointer.moved = false;
    if (
      (event.target as Element | null)?.closest(
        ".node, .edgeLabel, .cluster-label",
      )
    )
      return;
    pointer.active = true;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add("is-panning");
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!pointer.active) return;
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) pointer.moved = true;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    state.panX += dx;
    state.panY += dy;
    updateTransform(state);
  };
  const stopPan = () => {
    pointer.active = false;
    canvas.classList.remove("is-panning");
  };
  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    state.scale = Math.min(
      4,
      Math.max(
        0.5,
        +(state.scale + (event.deltaY < 0 ? 0.1 : -0.1)).toFixed(2),
      ),
    );
    updateTransform(state);
  };

  const closeEditor = () => {
    figure.querySelector(".cms-mermaid-label-editor")?.remove();
  };
  const openEditor = (
    element: Element,
    target: LabelTarget,
    kind: "node" | "edge" | "subgraph",
    identifier?: string,
  ) => {
    closeEditor();
    const editor = document.createElement("form");
    editor.className = "cms-mermaid-label-editor";
    const title =
      kind === "node"
        ? "编辑节点文字"
        : kind === "edge"
          ? "编辑连线文字"
          : "编辑分组名称";
    editor.innerHTML = `<strong>${title}</strong>`;
    if (identifier) {
      const idRow = document.createElement("div");
      idRow.className = "cms-mermaid-label-editor-id";
      const idLabel = document.createElement("span");
      idLabel.textContent = kind === "subgraph" ? "分组 ID" : "节点 ID";
      const idValue = document.createElement("code");
      idValue.textContent = identifier;
      idRow.append(idLabel, idValue);
      editor.appendChild(idRow);
    }
    const textarea = document.createElement("textarea");
    textarea.rows = 3;
    textarea.value = target.value;
    textarea.setAttribute(
      "aria-label",
      kind === "node"
        ? "节点文字"
        : kind === "edge"
          ? "连线文字"
          : "分组名称",
    );
    const actions = document.createElement("div");
    actions.className = "cms-mermaid-label-editor-actions";
    const cancel = createButton("取消", "取消修改", closeEditor);
    const save = createButton("保存", "保存修改", () => {
      const next = textarea.value.trim();
      if (!next) return;
      const current = instance.getMarkdown();
      const sourceBlock = mermaidSource(current, figureIndex);
      if (!sourceBlock) return;
      const replacement = target.replace(next.replace(/\r?\n/g, "<br/>"));
      instance.setMarkdown(
        `${current.slice(0, target.from)}${replacement}${current.slice(target.to)}`,
        true,
      );
      closeEditor();
    });
    actions.append(cancel, save);
    editor.append(textarea, actions);
    figure.appendChild(editor);
    const anchor = element.getBoundingClientRect();
    const parent = figure.getBoundingClientRect();
    editor.style.left = `${Math.max(8, Math.min(parent.width - 236, anchor.left - parent.left))}px`;
    editor.style.top = `${Math.max(8, anchor.bottom - parent.top + 8)}px`;
    textarea.focus();
    textarea.select();
  };

  const onClick = (event: MouseEvent) => {
    event.stopPropagation();
    if (readOnly || pointer.moved) return;
    const target = event.target as Element | null;
    if (!target) return;
    if (target.closest(".cms-mermaid-label-editor, .cms-mermaid-toolbar")) return;
    const sourceBlock = mermaidSource(instance.getMarkdown(), figureIndex);
    if (!sourceBlock) return;
    const clusterLabel = target.closest("g.cluster-label");
    if (clusterLabel) {
      const id = subgraphId(clusterLabel, sourceBlock.body);
      const editable = id
        ? findMermaidSubgraphLabelTarget(
            sourceBlock.body,
            id,
            sourceBlock.from,
          )
        : null;
      if (editable) {
        event.preventDefault();
        event.stopPropagation();
        openEditor(clusterLabel, editable, "subgraph", id ?? undefined);
      }
      return;
    }
    const node = target.closest(".node");
    if (node) {
      const id = nodeId(node);
      const editable = id
        ? findMermaidNodeLabelTarget(sourceBlock.body, id, sourceBlock.from)
        : null;
      if (editable) {
        event.preventDefault();
        event.stopPropagation();
        openEditor(node, editable, "node", id ?? undefined);
      }
      return;
    }
    const edge = target.closest(".edgeLabel");
    if (edge && visibleText(edge.textContent ?? "")) {
      const editable = edgeLabelTarget(
        sourceBlock.body,
        sourceBlock.from,
        edge,
        figure,
      );
      if (editable) {
        event.preventDefault();
        event.stopPropagation();
        openEditor(edge, editable, "edge");
      }
      return;
    }
    closeEditor();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      closeEditor();
      return;
    }
    if (event.key !== "Enter" && event.key !== " ") return;
    const target = event.target as Element | null;
    if (!target?.matches(".node, g.edgeLabel, g.cluster-label")) return;
    event.preventDefault();
    target.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  };

  svg.setAttribute("tabindex", "0");
  svg.setAttribute("aria-label", "可缩放 Mermaid 图表");
  if (!readOnly) {
    svg.querySelectorAll<SVGElement>(".node").forEach((node) => {
      node.setAttribute("tabindex", "0");
      node.setAttribute("role", "button");
      node.setAttribute(
        "aria-label",
        `编辑节点：${visibleText(node.textContent ?? "")}`,
      );
    });
    svg.querySelectorAll<SVGGElement>("g.edgeLabel").forEach((edge) => {
      const text = visibleText(edge.textContent ?? "");
      if (!text) return;
      edge.setAttribute("tabindex", "0");
      edge.setAttribute("role", "button");
      edge.setAttribute("aria-label", `编辑连线文字：${text}`);
    });
    svg.querySelectorAll<SVGGElement>("g.cluster-label").forEach((label) => {
      const text = visibleText(label.textContent ?? "");
      if (!text) return;
      label.setAttribute("tabindex", "0");
      label.setAttribute("role", "button");
      label.setAttribute("aria-label", `编辑分组名称：${text}`);
    });
  }
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", stopPan);
  canvas.addEventListener("pointercancel", stopPan);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  figure.addEventListener("click", onClick);
  canvas.addEventListener("keydown", onKeyDown);
  requestAnimationFrame(() => fitFigure(state));
  state.cleanup = () => {
    closeEditor();
    toolbar.remove();
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", stopPan);
    canvas.removeEventListener("pointercancel", stopPan);
    canvas.removeEventListener("wheel", onWheel);
    figure.removeEventListener("click", onClick);
    canvas.removeEventListener("keydown", onKeyDown);
    if (canvas.parentElement === figure) {
      if (svg.parentElement === canvas) figure.insertBefore(svg, canvas);
      canvas.remove();
    }
    delete figure.dataset.cmsMermaidReady;
    figure.classList.remove("cms-mermaid-editor", "is-read-only");
  };
  return state;
}

export function enhanceMermaidPreviews(
  host: HTMLElement,
  instance: MermaidInstance,
  readOnly: boolean,
): () => void {
  const states = new WeakMap<HTMLElement, MermaidFigureState>();
  const refresh = () => {
    const previewer = host.querySelector<HTMLElement>(".cherry-previewer");
    if (!previewer) return;
    const figures = [
      ...previewer.querySelectorAll<HTMLElement>('figure[data-type="mermaid"]'),
    ];
    figures.forEach((figure, index) => {
      const existing = states.get(figure);
      const renderedSvg = figure.querySelector("svg");
      if (existing && existing.svg !== renderedSvg) {
        existing.cleanup();
        states.delete(figure);
      }
      if (!states.has(figure)) {
        const state = installFigure(figure, index, instance, readOnly);
        if (state) states.set(figure, state);
      }
    });
  };
  refresh();
  const observer = new MutationObserver(refresh);
  observer.observe(host, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
    const previewer = host.querySelector<HTMLElement>(".cherry-previewer");
    if (!previewer) return;
    previewer
      .querySelectorAll<HTMLElement>('figure[data-type="mermaid"]')
      .forEach((figure) => {
        states.get(figure)?.cleanup();
      });
  };
}
