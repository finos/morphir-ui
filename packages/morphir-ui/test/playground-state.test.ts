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
})
