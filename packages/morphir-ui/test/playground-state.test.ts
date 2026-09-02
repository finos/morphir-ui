import { describe, expect, test } from 'vitest'
import {
  capabilityDetail,
  capabilityLabel,
  compatibleTargets,
  editorDiagnosticsFor,
  normalizeCatalog,
  playgroundPackage,
  preferredIrVersion,
  targetRefusalReason,
  PlaygroundState,
} from '../src/views/playground/playground-state.svelte.ts'

const frontend = (languageId: string, irVersions: string[]) => ({
  languageId,
  displayName: languageId,
  fileExtensions: [],
  irVersions,
  compile: true,
  incremental: null,
  fragments: null,
  provider: {
    extensionId: `morphir-${languageId}`,
    extensionName: languageId,
    version: '1.0.0',
    origin: 'installed' as const,
    invocationMode: 'spawned-process',
  },
})

const target = (name: string, irVersions: string[]) => ({
  target: name,
  displayName: name,
  irVersions,
  generate: true,
  provider: {
    extensionId: `morphir-${name}`,
    extensionName: name,
    version: '1.0.0',
    origin: 'installed' as const,
    invocationMode: 'spawned-process',
  },
})

describe('playground selection', () => {
  test('compatible targets intersect IR versions', () => {
    const catalog = {
      frontends: [frontend('elm', ['3'])],
      targets: [target('scala', ['3']), target('future', ['4'])],
    }

    expect(compatibleTargets(catalog, catalog.frontends[0]!).map((t) => t.target)).toEqual([
      'scala',
    ])
  })

  test('an incompatible target explains itself', () => {
    const reason = targetRefusalReason(frontend('elm', ['3']), target('future', ['4']))

    expect(reason).toContain('4')
    expect(reason).toContain('3')
  })

  test('a compatible target has no refusal reason', () => {
    expect(targetRefusalReason(frontend('elm', ['3']), target('scala', ['3']))).toBeNull()
  })

  // Defensive branch: the daemon rejects registering a provider that
  // advertises zero IR versions, so a real catalog should never contain a
  // frontend shaped like this. The wire schema still permits an empty
  // array, so this covers that graceful-degradation path, not a case
  // expected to occur against a real server.
  test('a frontend with no declared IR versions (defensive: the server does not register these) gets a distinct reason', () => {
    const mystery = frontend('morphir-mystery', [])

    expect(targetRefusalReason(mystery, target('scala', ['3']))).toContain('does not declare')
  })

  test('selecting a frontend clears a target that is no longer compatible', () => {
    const state = new PlaygroundState()
    state.catalog = {
      frontends: [frontend('elm', ['3']), frontend('next', ['4'])],
      targets: [target('scala', ['3'])],
    }
    state.selectFrontend('elm')
    state.selectTarget('scala')
    expect(state.selectedTarget).toBe('scala')

    state.selectFrontend('next')

    expect(state.selectedTarget).toBeNull()
  })

  test('editing the active document clears the previous results', () => {
    const state = new PlaygroundState()
    state.compileResult = { success: true, irVersion: '3', ir: {}, diagnostics: [], modules: [] }
    state.generateResult = { success: true, artifacts: [], diagnostics: [] }

    state.updateActiveDocument('module Main exposing (..)')

    expect(state.compileResult).toBeNull()
    expect(state.generateResult).toBeNull()
  })

  test('the active document version increments on every edit, not just the first', () => {
    const state = new PlaygroundState()
    expect(state.activeDocument?.version).toBe(1)

    state.updateActiveDocument('module Main exposing (..)')
    expect(state.activeDocument?.version).toBe(2)

    state.updateActiveDocument('module Main exposing (..)\n\nx = 1')
    expect(state.activeDocument?.version).toBe(3)
  })

  test('a snapshot carries the documents and both selections', () => {
    const state = new PlaygroundState()
    state.catalog = { frontends: [frontend('elm', ['3'])], targets: [target('scala', ['3'])] }
    state.updateActiveDocument('x = 1')
    state.selectTarget('scala')

    const snap = state.snapshot()

    expect(snap.languageId).toBe('elm')
    expect(snap.target).toBe('scala')
    expect(snap.activeDocumentId).toBe('main')
    expect(snap.documents.map((doc) => doc.text)).toEqual(['x = 1'])
  })

  test('hydrating restores the documents and selections', () => {
    const state = new PlaygroundState()

    state.hydrate({
      documents: [
        {
          id: 'main',
          uri: 'morphir-playground:/Main.elm',
          languageId: 'elm',
          version: 9,
          text: 'restored = 1',
        },
      ],
      activeDocumentId: 'main',
      languageId: 'elm',
      target: 'scala',
    })

    expect(state.activeDocument?.text).toBe('restored = 1')
    expect(state.activeDocument?.version).toBe(9)
    expect(state.selectedLanguageId).toBe('elm')
    expect(state.selectedTarget).toBe('scala')
  })

  // A config that has never held a playground decodes to nulls and an empty document
  // list. Treating that as "restore nothing" is what keeps the sample source on screen
  // for a first-time user instead of an empty editor.
  test('hydrating from an untouched config leaves the sample document alone', () => {
    const state = new PlaygroundState()
    const before = state.activeDocument?.text

    state.hydrate({ documents: [], activeDocumentId: null, languageId: null, target: null })

    expect(state.activeDocument?.text).toBe(before)
    expect(state.selectedTarget).toBeNull()
  })

  test('hydrating an active id that no document matches falls back to the first document', () => {
    const state = new PlaygroundState()

    state.hydrate({
      documents: [
        {
          id: 'main',
          uri: 'morphir-playground:/Main.elm',
          languageId: 'elm',
          version: 1,
          text: 'a',
        },
      ],
      activeDocumentId: 'missing',
      languageId: null,
      target: null,
    })

    expect(state.activeDocumentId).toBe('main')
    expect(state.activeDocument?.text).toBe('a')
  })
})

// Requirement: an installed provider's capability record carries only languages, IR
// versions and the compile flag, so `incremental`/`fragments` arrive as null when the
// session could not tell. Null must never collapse into false.
describe('normalizeCatalog', () => {
  const withOrigin = <T extends { provider: { origin: 'builtin' | 'installed' } }>(
    entry: T,
    origin: 'builtin' | 'installed',
    extensionId: string,
  ): T => ({
    ...entry,
    displayName: `${origin} ${extensionId}`,
    provider: { ...entry.provider, origin, extensionId },
  })

  // Requirement: a real session can advertise the same language from an installed
  // extension and a builtin at once (the captured Rust catalog in
  // morphir-workspace/test/connected-playground.test.ts does exactly this for Gleam).
  // The wire protocol addresses a compile by languageId alone, so only one of them is
  // ever reachable — and the daemon's registry resolves that duplicate to the
  // installed provider. The catalog shown must be the catalog that would run.
  test('keeps one frontend per language: the installed provider, regardless of order', () => {
    const builtin = withOrigin(frontend('gleam', ['4']), 'builtin', 'gleam-builtin')
    const installed = withOrigin(frontend('gleam', ['4']), 'installed', 'gleam-installed')

    const fromInstalledFirst = normalizeCatalog({
      frontends: [installed, builtin, frontend('elm', ['3'])],
      targets: [],
    })
    const fromBuiltinFirst = normalizeCatalog({
      frontends: [builtin, installed, frontend('elm', ['3'])],
      targets: [],
    })

    for (const catalog of [fromInstalledFirst, fromBuiltinFirst]) {
      expect(catalog.frontends.map((entry) => entry.languageId)).toEqual(['gleam', 'elm'])
      expect(catalog.frontends[0]!.provider.extensionId).toBe('gleam-installed')
    }
  })

  test('keeps one target per name the same way', () => {
    const builtin = withOrigin(target('gleam', ['4']), 'builtin', 'gleam-builtin')
    const installed = withOrigin(target('gleam', ['4']), 'installed', 'gleam-installed')

    const catalog = normalizeCatalog({
      frontends: [],
      targets: [builtin, installed, target('scala', ['3'])],
    })

    expect(catalog.targets.map((entry) => entry.target)).toEqual(['gleam', 'scala'])
    expect(catalog.targets[0]!.provider.extensionId).toBe('gleam-installed')
  })

  // The registry refuses to resolve two providers of the same origin as ambiguous, so
  // for display there is no "right" one; the first keeps the catalog's own order.
  test('keeps the first entry when duplicates share an origin', () => {
    const first = withOrigin(frontend('gleam', ['4']), 'installed', 'gleam-first')
    const second = withOrigin(frontend('gleam', ['4']), 'installed', 'gleam-second')

    const catalog = normalizeCatalog({ frontends: [first, second], targets: [] })

    expect(catalog.frontends.map((entry) => entry.provider.extensionId)).toEqual(['gleam-first'])
  })

  test('leaves a catalog without duplicates untouched', () => {
    const catalog = {
      frontends: [frontend('elm', ['3']), frontend('gleam', ['4'])],
      targets: [target('scala', ['3']), target('gleam', ['4'])],
    }

    expect(normalizeCatalog(catalog)).toEqual(catalog)
  })
})

describe('capability flags gate their operations', () => {
  // Requirement: a target that advertises generate: false must be refused with a
  // reason, not offered and then failed. IR agreement does not override the flag.
  test('a target that refuses generation gets a refusal even when IR versions agree', () => {
    const refusing = { ...target('scala', ['3']), generate: false }

    const reason = targetRefusalReason(frontend('elm', ['3']), refusing)

    expect(reason).toMatch(/does not support/i)
    expect(reason).toContain('scala')
  })

  test('a target that generates and agrees on IR still has no refusal', () => {
    expect(targetRefusalReason(frontend('elm', ['3']), target('scala', ['3']))).toBeNull()
  })
})

describe('input revision', () => {
  // Requirement: a compile or generate response must be attributable to the input it
  // answered. Every mutation that clears the results advances the revision, so a
  // response captured against an older revision can be recognized as stale and dropped.
  test('editing the active document advances the revision', () => {
    const state = new PlaygroundState()
    const before = state.revision

    state.updateActiveDocument('module Main exposing (..)')

    expect(state.revision).toBeGreaterThan(before)
  })

  test('switching frontend advances the revision', () => {
    const state = new PlaygroundState()
    state.catalog = {
      frontends: [frontend('elm', ['3']), frontend('gleam', ['4'])],
      targets: [],
    }
    const before = state.revision

    state.selectFrontend('gleam')

    expect(state.revision).toBeGreaterThan(before)
  })

  test('re-selecting the current frontend changes neither results nor revision', () => {
    const state = new PlaygroundState()
    const before = state.revision

    state.selectFrontend(state.selectedLanguageId)

    expect(state.revision).toBe(before)
  })

  test('selecting a target leaves the revision alone: it invalidates no compile', () => {
    const state = new PlaygroundState()
    const before = state.revision

    state.selectTarget('scala')

    expect(state.revision).toBe(before)
  })
})

describe('capability reporting', () => {
  test('unknown is a third answer, not a refusal', () => {
    expect(capabilityLabel(true)).toBe('Supported')
    expect(capabilityLabel(false)).toBe('Not supported')
    expect(capabilityLabel(null)).toBe('Unknown')
    expect(capabilityLabel(null)).not.toBe(capabilityLabel(false))
  })

  test('each answer explains itself differently', () => {
    const detail = [capabilityDetail(true), capabilityDetail(false), capabilityDetail(null)]
    expect(new Set(detail).size).toBe(3)
    expect(capabilityDetail(null)).toMatch(/could not determine/i)
    expect(capabilityDetail(false)).toMatch(/does not support/i)
  })
})

describe('editorDiagnosticsFor', () => {
  const located = (uri: string, message: string) => ({
    severity: 'error' as const,
    code: null,
    message,
    location: {
      uri,
      range: { start: { line: 1, character: 0 }, end: { line: 1, character: 4 } },
    },
  })

  test('keeps only the diagnostics anchored in the given document', () => {
    const result = editorDiagnosticsFor(
      [located('a.elm', 'mine'), located('b.elm', 'theirs')],
      'a.elm',
    )

    expect(result.map((diagnostic) => diagnostic.message)).toEqual(['mine'])
    expect(result[0]?.range).toEqual({
      start: { line: 1, character: 0 },
      end: { line: 1, character: 4 },
    })
  })

  test('a diagnostic with no location belongs to no document', () => {
    const unlocated = {
      severity: 'error' as const,
      code: null,
      message: 'whole run',
      location: null,
    }

    expect(editorDiagnosticsFor([unlocated], 'a.elm')).toEqual([])
  })
})

describe('playgroundPackage', () => {
  test('takes the module name from the source, mirroring the CLI', () => {
    expect(playgroundPackage('module Pricing.Rules exposing (..)\n')).toEqual({
      name: 'local/pricing-rules',
      exposedModules: ['Pricing.Rules'],
    })
  })

  test('falls back to Main when no module header is present', () => {
    expect(playgroundPackage('x = 1')).toEqual({ name: 'local/main', exposedModules: ['Main'] })
  })

  // Gleam has no `module X` header at all, so the Elm-shaped regex would never match
  // regardless of the source text. Its module name comes from the document's own URI
  // instead, mirroring module_name_from_document_uri in morphir-gleam-binding.
  test('derives the module name from the URI for Gleam, not from the source text', () => {
    expect(
      playgroundPackage(
        'pub fn hello() { "world" }',
        'gleam',
        'morphir-playground:/main.gleam',
      ),
    ).toEqual({ name: 'local/main', exposedModules: ['main'] })
  })
})

describe('preferredIrVersion', () => {
  test('prefers a version the chosen target also emits', () => {
    expect(preferredIrVersion(frontend('elm', ['2', '3']), target('scala', ['3']))).toBe('3')
  })

  // Requirement: a compile whose IR this client cannot decode leaves Insight and XRay
  // showing a format error while the compile itself reports success — a failure that
  // looks like a broken view rather than a badly chosen request. When the frontend
  // offers a decodable version at all, ask for that one.
  test('prefers a decodable version over an earlier undecodable one', () => {
    expect(preferredIrVersion(frontend('elm', ['4', '3']), null)).toBe('3')
  })

  test('matches a decodable version spelled as a triplet', () => {
    expect(preferredIrVersion(frontend('elm', ['4.0.0', '3.0.0']), null)).toBe('3.0.0')
  })

  // Generation compatibility outranks decodability: an IR the target cannot consume
  // fails the generate outright, while an undecodable one only degrades the inspect
  // panes, which is what morphir-19s6 tracks.
  test('never trades target agreement away for decodability', () => {
    expect(preferredIrVersion(frontend('gleam', ['4', '3']), target('gleam', ['4']))).toBe('4')
  })

  test('falls back to the first agreed version when none of them is decodable', () => {
    expect(preferredIrVersion(frontend('gleam', ['4', '5']), target('gleam', ['5', '4']))).toBe(
      '5',
    )
  })

  // A target selected before the frontend changed can survive as an incompatible
  // selection (hydrate restores one without a compatibility check), and compiling is
  // still allowed in that state. With no agreement to honor, the frontend's own
  // versions are the candidates.
  test('ignores a target that agrees on nothing and picks from the frontend', () => {
    expect(preferredIrVersion(frontend('elm', ['4', '3']), target('scala', ['9']))).toBe('3')
  })

  test('falls back to the first version when the frontend offers nothing decodable', () => {
    expect(preferredIrVersion(frontend('gleam', ['4', '5']), null)).toBe('4')
  })

  // A revision inside a decodable major is a different release, spelled on the wire as
  // an exact string the decoder rejects. Preferring it over the frontend's own first
  // choice would trade a working request for one that cannot be rendered either way.
  test('does not prefer an undecodable revision of a decodable major', () => {
    expect(preferredIrVersion(frontend('elm', ['4', '3.1.0']), null)).toBe('4')
  })

  test('an empty frontend yields an empty version rather than throwing', () => {
    expect(preferredIrVersion(frontend('elm', []), null)).toBe('')
  })
})

// Reachability here is a fact about what extensions are installed, not a code invariant:
// the frontend select is populated straight from the daemon's catalog, so a second
// frontend makes every one of these paths live.
describe('switching frontend', () => {
  const twoFrontends = {
    frontends: [
      { ...frontend('elm', ['3']), fileExtensions: ['.elm'] },
      { ...frontend('gleam', ['3']), fileExtensions: ['.gleam'] },
    ],
    targets: [target('scala', ['3'])],
  }

  test('retargets every document language and uri to the new frontend', () => {
    const state = new PlaygroundState()
    state.catalog = twoFrontends
    state.updateActiveDocument('typed = 1')

    state.selectFrontend('gleam')

    expect(state.activeDocument?.languageId).toBe('gleam')
    expect(state.activeDocument?.uri).toBe('morphir-playground:/main.gleam')
    expect(state.documents.every((doc) => doc.languageId === 'gleam')).toBe(true)
  })

  // Gleam derives a module's name straight from its document's file path (unlike Elm,
  // which reads a `module X` header instead) and rejects any path segment that is not
  // lowercase, so retargeting to Gleam has to rewrite the stem, not just the extension.
  test('retargets the stem, not just the extension, for a language with different naming rules', () => {
    const state = new PlaygroundState()
    state.catalog = twoFrontends

    state.selectFrontend('gleam')

    expect(state.activeDocument?.uri).toBe('morphir-playground:/main.gleam')

    state.selectFrontend('elm')

    expect(state.activeDocument?.uri).toBe('morphir-playground:/Main.elm')
  })

  // The same argument that clears results on edit: IR derived from Elm source, shown
  // under a Gleam frontend label, silently misleads.
  test('clears the previous compile and generate results', () => {
    const state = new PlaygroundState()
    state.catalog = twoFrontends
    state.compileResult = { success: true, irVersion: '3', ir: {}, diagnostics: [], modules: [] }
    state.generateResult = { success: true, artifacts: [], diagnostics: [] }

    state.selectFrontend('gleam')

    expect(state.compileResult).toBeNull()
    expect(state.generateResult).toBeNull()
  })

  test('keeps text the user actually typed', () => {
    const state = new PlaygroundState()
    state.catalog = twoFrontends
    state.updateActiveDocument('mine = 1')

    state.selectFrontend('gleam')

    expect(state.activeDocument?.text).toBe('mine = 1')
  })

  test('swaps an untouched sample for the new language sample', () => {
    const state = new PlaygroundState()
    state.catalog = twoFrontends
    const elmSample = state.activeDocument?.text

    state.selectFrontend('gleam')

    expect(state.activeDocument?.text).not.toBe(elmSample)
    expect(state.activeDocument?.text).toContain('pub fn')
  })

  test('re-selecting the current frontend changes nothing', () => {
    const state = new PlaygroundState()
    state.catalog = twoFrontends
    state.updateActiveDocument('typed = 1')
    state.compileResult = { success: true, irVersion: '3', ir: {}, diagnostics: [], modules: [] }
    const before = state.activeDocument

    state.selectFrontend('elm')

    expect(state.activeDocument).toEqual(before)
    expect(state.compileResult).not.toBeNull()
  })

  test('a frontend that declares no extensions falls back to its language id', () => {
    const state = new PlaygroundState()
    state.catalog = { frontends: [frontend('elm', ['3']), frontend('gleam', ['3'])], targets: [] }

    state.selectFrontend('gleam')

    expect(state.activeDocument?.uri).toBe('morphir-playground:/main.gleam')
  })
})
