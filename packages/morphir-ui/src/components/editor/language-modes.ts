// Internal to the editor component: maps the capability catalog's language id
// (e.g. "elm") to a CodeMirror LanguageSupport. This is the one file allowed
// to know that CodeMirror is the current editor library. A future Monaco
// implementation would replace this file's internals and keep the same
// exported shape for `lspPositionToOffset`, which callers outside this
// component never need — it exists so this translation stays tested.
import { LanguageSupport, StreamLanguage } from '@codemirror/language'
import { elm } from '@codemirror/legacy-modes/mode/elm'

const languageModes = new Map<string, () => LanguageSupport>([
  ['elm', () => new LanguageSupport(StreamLanguage.define(elm))],
])

/** Resolves a catalog language id to a CodeMirror LanguageSupport, or null when
 * no mode is registered for it. Never throws on an unknown id. */
export function resolveLanguageMode(languageId: string): LanguageSupport | null {
  const createMode = languageModes.get(languageId)
  return createMode ? createMode() : null
}

/** The catalog language ids this registry currently knows how to highlight. */
export function registeredLanguageIds(): ReadonlyArray<string> {
  return Array.from(languageModes.keys())
}

/** The minimal document shape `lspPositionToOffset` needs. CodeMirror's
 * `Text` satisfies this structurally (it has `lines` and `line()` with a
 * superset of these fields), so callers can pass a real `Text` without this
 * module importing it — and a future Monaco implementation, whose document
 * model has no `Text` class at all, can implement this same tested contract
 * with its own line/offset lookup. */
export interface DocumentLines {
  readonly lines: number
  line(lineNumber: number): { readonly from: number; readonly length: number }
}

/** Translates a zero-based LSP {line, character} position into a document
 * offset: `doc.line(line + 1).from + character`, clamped so a character past
 * its line's end lands at the line end, and a line past the end of the
 * document lands on the document's last line. */
export function lspPositionToOffset(
  doc: DocumentLines,
  position: { readonly line: number; readonly character: number },
): number {
  const lineNumber = Math.min(Math.max(position.line, 0), doc.lines - 1) + 1
  const line = doc.line(lineNumber)
  const character = Math.min(Math.max(position.character, 0), line.length)
  return line.from + character
}
