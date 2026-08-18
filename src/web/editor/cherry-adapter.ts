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

  validate(): EditorDiagnostic[] {
    return this.#validator(this.getSource());
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#cherry.destroy();
  }
}
