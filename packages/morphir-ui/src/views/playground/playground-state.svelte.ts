import type {
  CapabilityCatalog,
  FrontendEntry,
  PlaygroundCompileResult,
  PlaygroundDiagnostic,
  PlaygroundGenerateResult,
  TargetEntry,
} from '@morphir/workspace'
import type { EditorDiagnostic } from '../../components/editor/types.ts'

/** Where a Playground exchange currently stands. Set by whatever invokes the
 * pipeline service; this class only initializes it to 'idle' and does not
 * itself transition or clear it. */
export type PlaygroundStatus = 'idle' | 'compiling' | 'generating' | 'error'

/** An in-memory document edited in the Playground. Mirrors the shape MEP's
 * `SourceDocument` expects on the wire: `version` increments on every edit
 * and is never reset, since MEP documents it as monotonically increasing. */
export interface PlaygroundDocument {
  readonly id: string
  readonly uri: string
  readonly languageId: string
  readonly version: number
  readonly text: string
}

/** What survives a reload, matching `UiConfig['playground']`. A null selection and an
 * empty document list mean "nothing was ever persisted", which is why hydrate leaves
 * the sample document in place rather than emptying the editor. */
export interface PlaygroundSnapshot {
  readonly documents: ReadonlyArray<PlaygroundDocument>
  readonly activeDocumentId: string | null
  readonly languageId: string | null
  readonly target: string | null
}

const EMPTY_CATALOG: CapabilityCatalog = { frontends: [], targets: [] }

const DEFAULT_LANGUAGE_ID = 'elm'

/** Placeholder source shown before the user has typed anything, one entry
 * per known frontend language. Frontends absent from this map (or from a
 * connected session's catalog entirely) fall back to a generic comment. */
const SAMPLE_TEXT_BY_LANGUAGE: Record<string, string> = {
  elm: [
    'module Main exposing (..)',
    '',
    '',
    'greet : String -> String',
    'greet name =',
    '    "Hello, " ++ name',
    '',
  ].join('\n'),
}

const sampleTextFor = (languageId: string): string =>
  SAMPLE_TEXT_BY_LANGUAGE[languageId] ?? `-- Morphir Playground sample for ${languageId}\n`

const makeMainDocument = (languageId: string): PlaygroundDocument => ({
  id: 'main',
  uri: `morphir-playground:/Main.${languageId}`,
  languageId,
  version: 1,
  text: sampleTextFor(languageId),
})

/** Client-side mirror of the Rust `compatible_targets`: the targets whose
 * `irVersions` share at least one value with the frontend's. An empty list
 * on either side yields no matches, and catalog order is preserved. */
export const compatibleTargets = (
  catalog: CapabilityCatalog,
  frontend: FrontendEntry,
): TargetEntry[] => {
  return catalog.targets.filter((target) =>
    target.irVersions.some((version) => frontend.irVersions.includes(version)),
  )
}

/** Explains why `target` is not offered alongside `frontend`, or `null` when
 * their IR versions intersect and the pairing is allowed.
 *
 * A frontend that declares no IR versions at all is a distinct case from one
 * whose versions simply don't overlap the target's: the former means the
 * session could not determine what the extension supports, the latter means
 * it asked and got an incompatible answer. Collapsing them into one message
 * would hide that difference from the person picking a target. */
export const targetRefusalReason = (
  frontend: FrontendEntry,
  target: TargetEntry,
): string | null => {
  // Defensive only: the daemon's ExtensionRegistry rejects registering a
  // provider that advertises zero IR versions (registry.rs's
  // normalize_advertised_releases, for both builtin and installed origins),
  // so a real catalog should never contain a frontend with an empty
  // irVersions array. The wire schema still allows an empty array, though,
  // so this branch stays as graceful degradation rather than an assumption
  // that the server enforces it forever.
  if (frontend.irVersions.length === 0) {
    return `The ${frontend.displayName} extension does not declare its languages or IR versions`
  }
  const intersects = target.irVersions.some((version) => frontend.irVersions.includes(version))
  if (intersects) return null
  return `${target.displayName} requires Morphir IR ${target.irVersions.join(', ')}; ${frontend.displayName} emits ${frontend.irVersions.join(', ')}`
}

/** How a tri-state capability flag reads to the user.
 *
 * `null` is NOT `false`. An installed provider's capability metadata is rebuilt from what
 * its install persisted, and that record carries only languages, IR versions and the
 * compile flag — so `incremental` and `fragments` arrive as null whenever the session
 * could not tell. Rendering that as "not supported" would invent a refusal the extension
 * never made. The server preserved the distinction; so does this. */
export const capabilityLabel = (
  value: boolean | null,
): 'Supported' | 'Not supported' | 'Unknown' =>
  value === null ? 'Unknown' : value ? 'Supported' : 'Not supported'

/** The long form of {@link capabilityLabel}, for a title/tooltip. Three answers, three
 * explanations — "unknown" says why it is unknown rather than sounding like a refusal. */
export const capabilityDetail = (value: boolean | null): string => {
  if (value === null) {
    return 'This session could not determine whether the extension supports this: its install record carries only languages, IR versions and the compile flag'
  }
  return value
    ? 'The extension advertises support for this'
    : 'The extension reports that it does not support this'
}

/** The subset of `diagnostics` that the editor for `uri` can place, translated to the
 * editor's LSP-shaped contract. A diagnostic with no location belongs to the run rather
 * than to any document, so it is dropped here and shown only in the diagnostics list. */
export const editorDiagnosticsFor = (
  diagnostics: ReadonlyArray<PlaygroundDiagnostic>,
  uri: string,
): EditorDiagnostic[] =>
  diagnostics
    .filter((diagnostic) => diagnostic.location !== null && diagnostic.location.uri === uri)
    .map((diagnostic) => ({
      severity: diagnostic.severity,
      message: diagnostic.message,
      range: diagnostic.location!.range,
    }))

const MODULE_HEADER =
  /^[^\S\r\n]*module[^\S\r\n]+([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)*)/m

/** The package the Playground compiles source as. Mirrors the CLI's single-file compile
 * (crates/morphir/src/commands/compile.rs): the module name comes from the source's own
 * `module` header when it has one, and the package name is `local/` plus that module
 * lowercased with dots turned into dashes. Source with no header compiles as Main, which
 * is what the extension would assume anyway. */
export const playgroundPackage = (text: string): { name: string; exposedModules: string[] } => {
  const moduleName = MODULE_HEADER.exec(text)?.[1] ?? 'Main'
  return {
    name: `local/${moduleName.toLowerCase().replace(/\./g, '-')}`,
    exposedModules: [moduleName],
  }
}

/** The IR version to ask the frontend for. When a target is already chosen, prefer a
 * version both sides emit so the compile output can actually be generated from; otherwise
 * take the frontend's first. Returns '' for a frontend that declares no versions at all,
 * which `targetRefusalReason` already reports as an undeclared extension.  */
export const preferredIrVersion = (frontend: FrontendEntry, target: TargetEntry | null): string => {
  const agreed = target?.irVersions.find((version) => frontend.irVersions.includes(version))
  return agreed ?? frontend.irVersions[0] ?? ''
}

/** Documents being edited, the frontend/target pairing, and the last
 * compile/generate exchange for the Playground view. */
export class PlaygroundState {
  documents = $state<PlaygroundDocument[]>([makeMainDocument(DEFAULT_LANGUAGE_ID)])
  activeDocumentId = $state<string>('main')
  selectedLanguageId = $state<string>(DEFAULT_LANGUAGE_ID)
  selectedTarget = $state<string | null>(null)
  catalog = $state<CapabilityCatalog>(EMPTY_CATALOG)
  compileResult = $state<PlaygroundCompileResult | null>(null)
  generateResult = $state<PlaygroundGenerateResult | null>(null)
  status = $state<PlaygroundStatus>('idle')

  get activeDocument(): PlaygroundDocument | null {
    return this.documents.find((doc) => doc.id === this.activeDocumentId) ?? null
  }

  /** Changes the source language. A previously selected target that is no
   * longer compatible with the new frontend is cleared: leaving a stale,
   * incompatible target selected in place would fail the next compile for a
   * reason invisible to the user. */
  selectFrontend(languageId: string): void {
    this.selectedLanguageId = languageId
    if (this.selectedTarget === null) return

    const frontend = this.catalog.frontends.find((entry) => entry.languageId === languageId)
    const stillCompatible =
      frontend !== undefined &&
      compatibleTargets(this.catalog, frontend).some(
        (entry) => entry.target === this.selectedTarget,
      )
    if (!stillCompatible) this.selectedTarget = null
  }

  selectTarget(target: string): void {
    this.selectedTarget = target
  }

  /** Edits the active document's text, bumping its version. Also clears any
   * previous compile/generate result: stale IR displayed beside edited
   * source would silently mislead, which is worse than an empty pane. */
  updateActiveDocument(text: string): void {
    const active = this.activeDocument
    if (active === null) return

    this.documents = this.documents.map((doc) =>
      doc.id === active.id ? { ...doc, text, version: doc.version + 1 } : doc,
    )
    this.compileResult = null
    this.generateResult = null
  }

  /** The persistable part of this state. Deliberately excludes the catalog (re-fetched
   * from the live session) and both results (meaningless without the session that
   * produced them). */
  snapshot(): PlaygroundSnapshot {
    return {
      documents: this.documents.map((doc) => ({ ...doc })),
      activeDocumentId: this.activeDocumentId,
      languageId: this.selectedLanguageId,
      target: this.selectedTarget,
    }
  }

  /** Restores a previous session's work. Each field is restored only when the snapshot
   * actually carries one, so a config written before the Playground existed does not
   * blank the editor or clear the default language. */
  hydrate(snap: PlaygroundSnapshot): void {
    if (snap.documents.length > 0) {
      this.documents = snap.documents.map((doc) => ({ ...doc }))
      const active = snap.activeDocumentId
      this.activeDocumentId =
        active !== null && this.documents.some((doc) => doc.id === active)
          ? active
          : this.documents[0]!.id
    }
    if (snap.languageId !== null) this.selectedLanguageId = snap.languageId
    if (snap.target !== null) this.selectedTarget = snap.target
  }
}
