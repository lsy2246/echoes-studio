interface HighlightRegistryLike {
  set: (name: string, highlight: unknown) => void;
  delete: (name: string) => void;
}

interface HighlightWindow extends Window {
  Highlight?: new (...ranges: Range[]) => unknown;
}

const HIGHLIGHT_NAME = "cms-preview-search";
const IGNORED_PREVIEW_TEXT = [
  "button",
  "input",
  "textarea",
  "script",
  "style",
  "[hidden]",
  ".cms-mermaid-toolbar",
  ".cms-mermaid-label-editor",
  ".cherry-mermaid-source-toolbar",
].join(",");

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildPreviewSearchRegex(
  query: string,
  caseSensitive: boolean,
  wholeWord: boolean,
  useRegex: boolean,
): RegExp | null {
  if (!query) return null;
  let pattern = useRegex ? query : escapeRegExp(query);
  if (!useRegex && wholeWord) pattern = `\\b${pattern}\\b`;
  try {
    return new RegExp(pattern, caseSensitive ? "g" : "gi");
  } catch {
    return null;
  }
}

function highlightRegistry(): HighlightRegistryLike | null {
  if (typeof CSS === "undefined") return null;
  return (
    CSS as typeof CSS & { highlights?: HighlightRegistryLike }
  ).highlights ?? null;
}

function previewRanges(preview: HTMLElement, regex: RegExp): Range[] {
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(preview, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      const parent = node.parentElement;
      if (!node.textContent || !parent || parent.closest(IGNORED_PREVIEW_TEXT)) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let node = walker.nextNode();
  while (node) {
    const text = node.textContent ?? "";
    const matcher = new RegExp(regex.source, regex.flags);
    let match: RegExpExecArray | null;
    while ((match = matcher.exec(text))) {
      if (!match[0]) {
        matcher.lastIndex += 1;
        continue;
      }
      const range = document.createRange();
      range.setStart(node, match.index);
      range.setEnd(node, match.index + match[0].length);
      ranges.push(range);
    }
    node = walker.nextNode();
  }
  return ranges;
}

export function matchesPreviewSearch(text: string, regex: RegExp): boolean {
  return new RegExp(regex.source, regex.flags).test(text);
}

function syncMermaidHighlights(
  preview: HTMLElement,
  regex: RegExp | null,
): void {
  preview
    .querySelectorAll<SVGElement>(
      ".cms-mermaid-canvas .node, .cms-mermaid-canvas g.edgeLabel, .cms-mermaid-canvas g.cluster-label",
    )
    .forEach((element) => {
      const matches = regex
        ? matchesPreviewSearch(element.textContent ?? "", regex)
        : false;
      element.classList.toggle("cms-preview-search-mermaid-match", matches);
    });
}

export function enhancePreviewSearch(host: HTMLElement): () => void {
  const registry = highlightRegistry();
  const HighlightConstructor = (window as HighlightWindow).Highlight;

  let timer = 0;
  const clear = (preview?: HTMLElement | null) => {
    registry?.delete(HIGHLIGHT_NAME);
    if (preview) syncMermaidHighlights(preview, null);
  };
  const sync = () => {
    timer = 0;
    const panel = host.querySelector<HTMLElement>(".cherry-searcher");
    const preview = host.querySelector<HTMLElement>(".cherry-previewer");
    const input = panel?.querySelector<HTMLInputElement>(".cherry-searcher__input");
    if (!panel || panel.style.display === "none" || !preview || !input?.value) {
      clear(preview);
      return;
    }
    const pressed = (type: string) =>
      panel
        .querySelector<HTMLElement>(`[data-type="${type}"]`)
        ?.getAttribute("aria-pressed") === "true";
    const regex = buildPreviewSearchRegex(
      input.value,
      pressed("caseSensitive"),
      pressed("wholeWord"),
      pressed("useRegex"),
    );
    if (!regex) {
      clear(preview);
      return;
    }
    if (registry && HighlightConstructor) {
      registry.set(
        HIGHLIGHT_NAME,
        new HighlightConstructor(...previewRanges(preview, regex)),
      );
    }
    syncMermaidHighlights(preview, regex);
  };
  const schedule = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(sync, 80);
  };
  const observer = new MutationObserver(schedule);
  observer.observe(host, {
    attributes: true,
    attributeFilter: ["aria-pressed", "class", "style"],
    characterData: true,
    childList: true,
    subtree: true,
  });
  host.addEventListener("input", schedule);
  host.addEventListener("click", schedule);
  host.addEventListener("keydown", schedule);
  schedule();

  return () => {
    window.clearTimeout(timer);
    observer.disconnect();
    host.removeEventListener("input", schedule);
    host.removeEventListener("click", schedule);
    host.removeEventListener("keydown", schedule);
    clear(host.querySelector<HTMLElement>(".cherry-previewer"));
  };
}
