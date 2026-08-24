import type {
  EditorDiagnostic,
  EditorView,
  MarkdownEditorDriver,
} from "../../shared/editor-contract";

export interface CherryInstanceLike {
  getMarkdown(): string;
  setMarkdown(source: string, keepCursor?: boolean): void;
  insert(source: string, select?: boolean, anchor?: false | [number, number], focus?: boolean): void;
  switchModel(view: EditorView): void;
  getCodeMirror(): unknown;
  destroy(): void;
}

interface CodeMirrorLike {
  focus?: () => void;
  scrollDOM?: HTMLElement;
  posAtCoords?: (coords: { x: number; y: number }) => number | null;
  state?: {
    selection?: {
      main?: { head?: number };
    };
    doc?: {
      lines?: number;
      line?: (number: number) => { from: number };
      lineAt?: (position: number) => { number: number };
    };
  };
  dispatch?: (spec: {
    selection: { anchor: number };
    scrollIntoView: boolean;
  }) => void;
}

/** Isolates the rest of the CMS from Cherry's concrete API. */
export class CherryMarkdownAdapter implements MarkdownEditorDriver {
  readonly #cherry: CherryInstanceLike;
  readonly #validator: (source: string) => EditorDiagnostic[];
  #destroyed = false;

  constructor(
    cherry: CherryInstanceLike,
    validator: (source: string) => EditorDiagnostic[],
  ) {
    this.#cherry = cherry;
    this.#validator = validator;
  }

  getSource(): string {
    return this.#destroyed ? "" : this.#cherry.getMarkdown();
  }

  setSource(source: string, keepCursor = true): void {
    if (!this.#destroyed) this.#cherry.setMarkdown(source, keepCursor);
  }

  insert(source: string, select = false): void {
    if (!this.#destroyed) this.#cherry.insert(source, select, false, true);
  }

  setView(view: EditorView): void {
    if (!this.#destroyed) this.#cherry.switchModel(view);
  }

  focus(): void {
    if (this.#destroyed) return;
    const codeMirror = this.#cherry.getCodeMirror() as CodeMirrorLike | null;
    codeMirror?.focus?.();
  }

  focusLine(line: number): void {
    if (this.#destroyed) return;
    const codeMirror = this.#cherry.getCodeMirror() as CodeMirrorLike | null;
    const document = codeMirror?.state?.doc;
    if (!document?.line || !document.lines || !codeMirror?.dispatch) {
      codeMirror?.focus?.();
      return;
    }
    const safeLine = Math.max(1, Math.min(Math.floor(line), document.lines));
    codeMirror.dispatch({
      selection: { anchor: document.line(safeLine).from },
      scrollIntoView: true,
    });
    codeMirror.focus?.();
  }

  getActiveLine(): number | null {
    if (this.#destroyed) return null;
    const codeMirror = this.#cherry.getCodeMirror() as CodeMirrorLike | null;
    const position = codeMirror?.state?.selection?.main?.head;
    const document = codeMirror?.state?.doc;
    if (typeof position !== "number" || !document?.lineAt) return null;
    return document.lineAt(position).number;
  }

  getViewportLine(): number | null {
    if (this.#destroyed) return null;
    const codeMirror = this.#cherry.getCodeMirror() as CodeMirrorLike | null;
    const scrollDOM = codeMirror?.scrollDOM;
    const document = codeMirror?.state?.doc;
    if (!scrollDOM || !codeMirror?.posAtCoords || !document?.lineAt) return null;
    if (
      scrollDOM.scrollTop > 0 &&
      scrollDOM.scrollTop + scrollDOM.clientHeight >= scrollDOM.scrollHeight - 2
    ) {
      return document.lines ?? null;
    }
    const bounds = scrollDOM.getBoundingClientRect();
    const position = codeMirror.posAtCoords({
      x: bounds.left + 12,
      y: bounds.top + 12,
    });
    return position === null ? null : document.lineAt(position).number;
  }

  validate(): EditorDiagnostic[] {
    return this.#validator(this.getSource());
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#cherry.destroy();
  }
}
