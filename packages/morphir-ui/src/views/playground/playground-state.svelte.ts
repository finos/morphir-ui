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
  // Drawn (not invented) from morphir-gleam-binding's own acceptance fixture at
  // tests/fixtures/real_world/rentals.gleam: a function with a real type signature
  // (Result(Int, String)) and pattern matching, so Insight/XRay have something to
  // show beyond a bare declaration. Gleam has no `module X` header — its module name
  // comes from the document's own file path, not from anything in this text.
  gleam: [
    '// Adapted from morphir-examples/tutorial/step_1_first_logic/src/Morphir/Example/App/Rentals.elm',
    '',
    'pub fn request(availability: Int, requested_quantity: Int) -> Result(Int, String) {',
    '  case requested_quantity <= availability {',
    '    True -> Ok(requested_quantity)',
    '    False -> Error("Insufficient availability")',
    '  }',
    '}',
    '',
  ].join('\n'),
}

const sampleTextFor = (languageId: string): string =>
  SAMPLE_TEXT_BY_LANGUAGE[languageId] ?? `-- Morphir Playground sample for ${languageId}\n`

const DEFAULT_STEM = 'Main'

/** The document stem seeded for a frontend, and what retargeting swaps it to. Elm/Haskell
 * accept (and Elm's own compiler convention favors) a capitalized free-form module stem,
 * which is why that stays the default for any language this map does not know about. Gleam
 * is different in a way that actually matters here: morphir-gleam-binding derives a module's
 * name from its own document URI (module_name_from_document_uri in that crate's src/lib.rs),
 * not from a header in the source, and rejects any path segment that is not lowercase
 * ASCII/digits/underscore. A capitalized stem is not a style mismatch for Gleam, it is a
 * compile error before the source is even parsed. */
const STEM_BY_LANGUAGE: Record<string, string> = {
  gleam: 'main',
}

const stemFor = (languageId: string): string => STEM_BY_LANGUAGE[languageId] ?? DEFAULT_STEM

/** The file extension a frontend's documents should carry. Catalog entries declare
 * these with a leading dot (the daemon's protocol emits ".elm", ".gleam"), but the wire
 * schema is a bare string array, so a missing dot is normalized rather than trusted. A
 * frontend that declares no extensions at all falls back to its own language id, which
 * is what makeMainDocument already assumes. */
const extensionFor = (frontend: FrontendEntry | undefined, languageId: string): string => {
  const declared = frontend?.fileExtensions[0]
  if (declared === undefined || declared === '') return `.${languageId}`
  return declared.startsWith('.') ? declared : `.${declared}`
}

/** Swaps a document URI's stem and extension, leaving its directory alone. Both change
 * together, not just the extension: retargeting to a language whose file-naming rules
 * differ from the previous one (Gleam's lowercase module-name-from-path vs. Elm's
 * free-form capitalized stem) needs the stem rewritten too, or the URI stays syntactically
 * valid while still being wrong for the frontend it now claims to belong to. */
const retargetUri = (uri: string, stem: string, extension: string): string => {
  const lastSlash = uri.lastIndexOf('/')
  return `${uri.slice(0, lastSlash + 1)}${stem}${extension}`
}

const makeMainDocument = (languageId: string): PlaygroundDocument => ({
  id: 'main',
  uri: `morphir-playground:/${stemFor(languageId)}.${languageId}`,
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

/** The module name morphir-gleam-binding derives for a document when it has no explicit
 * source root: the last path segment of the document's own URI, minus its `.gleam`
 * extension (module_name_from_document_uri in that crate's src/lib.rs, falling through to
 * `path.segments.last()` for a bare filename). Gleam has no `module X` header for a package
 * to read the name from, so deriving it from the text the way Elm's does would be wrong
 * for this language rather than merely inapplicable. */
const gleamModuleNameFromUri = (uri: string): string => {
  const lastSlash = uri.lastIndexOf('/')
  const name = uri.slice(lastSlash + 1)
  return name.replace(/\.gleam$/, '')
}

/** The package the Playground compiles source as. Mirrors the CLI's single-file compile
 * (crates/morphir/src/commands/compile.rs) for languages shaped like Elm: the module name
 * comes from the source's own `module` header when it has one, and the package name is
 * `local/` plus that module lowercased with dots turned into dashes. Source with no header
 * compiles as Main, which is what the extension would assume anyway.
 *
 * That derivation assumes a header only Elm/Haskell-shaped frontends actually declare, so
 * it stays the default for a language this function does not otherwise know, and is
 * special-cased for Gleam, whose module name is never in the text at all. `languageId` and
 * `uri` default to Elm's shape so existing text-only callers keep behaving exactly as
 * before. */
export const playgroundPackage = (
  text: string,
  languageId: string = DEFAULT_LANGUAGE_ID,
  uri = '',
): { name: string; exposedModules: string[] } => {
  if (languageId === 'gleam') {
    const moduleName = gleamModuleNameFromUri(uri)
    return { name: `local/${moduleName}`, exposedModules: [moduleName] }
  }
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

  /** Changes the source language, and moves everything that language owns with it.
   *
   * Documents are retargeted rather than left behind. A document that kept its old
   * languageId and URI extension while the compile payload claimed the new language is
   * not a cosmetic mismatch: if the extension normalizes the URI in its diagnostics,
   * they stop matching the active document's URI, and the editor gutter goes clean while
   * the diagnostics list underneath still prints the errors. An editor that claims the
   * code compiles while errors are shown below it is the exact misinformation this view
   * exists to avoid.
   *
   * The URI's stem is retargeted alongside its extension, not just alongside a language
   * whose naming rules happen to differ: a stem valid for the previous frontend is not
   * guaranteed valid for the new one (Gleam derives a module name straight from it and
   * rejects anything that is not lowercase), so keeping the old stem could turn a
   * successful retarget into a compile-time naming error the person driving the UI never
   * asked for.
   *
   * Both results are cleared for the same reason `updateActiveDocument` clears them:
   * IR derived from the previous language, displayed under the new frontend's label, is
   * worse than an empty pane.
   *
   * A previously selected target that is no longer compatible is cleared too, since
   * leaving a stale one selected would fail the next compile for an invisible reason.
   *
   * Text the user typed is never touched. A document still holding the untouched sample
   * for its old language does get the new language's sample, because leaving Elm sample
   * code in a Gleam editor teaches the wrong thing and destroys no work. */
  selectFrontend(languageId: string): void {
    const previous = this.selectedLanguageId
    if (previous === languageId) return

    this.selectedLanguageId = languageId
    const frontend = this.catalog.frontends.find((entry) => entry.languageId === languageId)
    const extension = extensionFor(frontend, languageId)
    const stem = stemFor(languageId)
    const previousSample = sampleTextFor(previous)
    this.documents = this.documents.map((doc) => ({
      ...doc,
      languageId,
      uri: retargetUri(doc.uri, stem, extension),
      text: doc.text === previousSample ? sampleTextFor(languageId) : doc.text,
    }))
    this.compileResult = null
    this.generateResult = null

    if (this.selectedTarget === null) return
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
