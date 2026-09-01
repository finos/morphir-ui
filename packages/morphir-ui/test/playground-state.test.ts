import { describe, expect, test } from 'vitest'
import {
  capabilityDetail,
  capabilityLabel,
  compatibleTargets,
  editorDiagnosticsFor,
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
})

describe('preferredIrVersion', () => {
  test('prefers a version the chosen target also emits', () => {
    expect(preferredIrVersion(frontend('elm', ['2', '3']), target('scala', ['3']))).toBe('3')
  })

  test('falls back to the first version the frontend emits when no target is chosen', () => {
    expect(preferredIrVersion(frontend('elm', ['2', '3']), null)).toBe('2')
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
    expect(state.activeDocument?.uri).toBe('morphir-playground:/Main.gleam')
    expect(state.documents.every((doc) => doc.languageId === 'gleam')).toBe(true)
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
    expect(state.activeDocument?.text).toContain('gleam')
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

    expect(state.activeDocument?.uri).toBe('morphir-playground:/Main.gleam')
  })
})
