// Public contract for the shared code editor component. Deliberately free of
// any editor-library types (CodeMirror, Monaco, ...) so the implementation
// behind CodeEditor.svelte can change without callers noticing.

/** LSP-shaped diagnostic: a zero-based {line, character} start and end, exactly
 * as `PlaygroundDiagnostic.location.range` is already shaped in `@morphir/workspace`. */
export interface EditorDiagnostic {
  readonly severity: 'error' | 'warning' | 'info' | 'hint'
  readonly message: string
  readonly range: {
    readonly start: { readonly line: number; readonly character: number }
    readonly end: { readonly line: number; readonly character: number }
  }
}

export interface CodeEditorProps {
  value: string
  /** The capability catalog's language id (for example "elm") — never an
   * editor-specific mode name. */
  languageId: string
  readOnly?: boolean
  diagnostics?: ReadonlyArray<EditorDiagnostic>
  onChange?: (value: string) => void
}
