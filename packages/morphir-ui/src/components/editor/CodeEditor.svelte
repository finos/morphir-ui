<script lang="ts">
  // The one place outside language-modes.ts allowed to import CodeMirror.
  // Callers only ever see `CodeEditorProps` / `EditorDiagnostic` (types.ts) —
  // no CodeMirror type crosses this boundary.
  import { untrack } from 'svelte'
  import { basicSetup } from 'codemirror'
  import { EditorView } from '@codemirror/view'
  import { Compartment, EditorState } from '@codemirror/state'
  import { type Diagnostic as CmDiagnostic, linter, setDiagnostics } from '@codemirror/lint'
  import { lspPositionToOffset, resolveLanguageMode } from './language-modes.ts'
  import type { CodeEditorProps, EditorDiagnostic } from './types.ts'

  let { value, languageId, readOnly = false, diagnostics = [], onChange }: CodeEditorProps =
    $props()

  let container: HTMLDivElement | undefined = $state()
  let view: EditorView | undefined

  const languageCompartment = new Compartment()
  const readOnlyCompartment = new Compartment()

  // `onChange` is read from a plain variable (not `$props()` directly) inside
  // the update listener below, so a changed callback reference doesn't force
  // the EditorView to be torn down and recreated.
  let latestOnChange: CodeEditorProps['onChange']
  $effect(() => {
    latestOnChange = onChange
  })

  function readOnlyExtensions(isReadOnly: boolean) {
    return [EditorState.readOnly.of(isReadOnly), EditorView.editable.of(!isReadOnly)]
  }

  function toCmDiagnostics(
    state: EditorState,
    source: ReadonlyArray<EditorDiagnostic>,
  ): CmDiagnostic[] {
    return source.map((diagnostic) => ({
      from: lspPositionToOffset(state.doc, diagnostic.range.start),
      to: lspPositionToOffset(state.doc, diagnostic.range.end),
      severity: diagnostic.severity,
      message: diagnostic.message,
    }))
  }

  // Mounts the EditorView once the container element exists. Reads the
  // current prop values through `untrack` so later prop changes are handled
  // by the dedicated reactive effects below instead of recreating the view
  // (which would lose cursor position and undo history on every keystroke).
  $effect(() => {
    if (!container) return

    const initialValue = untrack(() => value)
    const initialLanguageId = untrack(() => languageId)
    const initialReadOnly = untrack(() => readOnly)
    const initialDiagnostics = untrack(() => diagnostics)

    const state = EditorState.create({
      doc: initialValue,
      extensions: [
        basicSetup,
        languageCompartment.of(resolveLanguageMode(initialLanguageId) ?? []),
        readOnlyCompartment.of(readOnlyExtensions(initialReadOnly)),
        linter(() => []),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) latestOnChange?.(update.state.doc.toString())
        }),
      ],
    })

    const created = new EditorView({ state, parent: container })
    created.dispatch(setDiagnostics(created.state, toCmDiagnostics(created.state, initialDiagnostics)))
    view = created

    return () => {
      created.destroy()
      view = undefined
    }
  })

  $effect(() => {
    const nextLanguageId = languageId
    if (!view) return
    view.dispatch({ effects: languageCompartment.reconfigure(resolveLanguageMode(nextLanguageId) ?? []) })
  })

  $effect(() => {
    const nextReadOnly = readOnly
    if (!view) return
    view.dispatch({ effects: readOnlyCompartment.reconfigure(readOnlyExtensions(nextReadOnly)) })
  })

  // Controlled-value sync: only pushes `value` into the document when it
  // differs from the document's current text, so edits that originated from
  // this editor (echoed back through `onChange` -> parent state -> `value`)
  // don't get overwritten mid-keystroke.
  $effect(() => {
    const nextValue = value
    if (!view) return
    const current = view.state.doc.toString()
    if (nextValue !== current) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: nextValue } })
    }
  })

  $effect(() => {
    const nextDiagnostics = diagnostics
    if (!view) return
    view.dispatch(setDiagnostics(view.state, toCmDiagnostics(view.state, nextDiagnostics)))
  })
</script>

<div class="code-editor" bind:this={container}></div>

<style>
  .code-editor {
    display: flex;
    height: 100%;
    overflow: auto;
  }

  .code-editor :global(.cm-editor) {
    flex: 1;
    height: 100%;
  }
</style>
