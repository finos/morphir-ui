import { describe, expect, test } from 'vitest'
import {
  compatibleTargets,
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

    expect(compatibleTargets(catalog, catalog.frontends[0]!).map((t) => t.target)).toEqual(['scala'])
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
        { id: 'main', uri: 'morphir-playground:/Main.elm', languageId: 'elm', version: 1, text: 'a' },
      ],
      activeDocumentId: 'missing',
      languageId: null,
      target: null,
    })

    expect(state.activeDocumentId).toBe('main')
    expect(state.activeDocument?.text).toBe('a')
  })
})
