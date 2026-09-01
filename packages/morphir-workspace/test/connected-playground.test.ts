import { describe, expect, test } from 'bun:test'
import { Schema } from 'effect'
import {
  CONNECTED_METHODS,
  CapabilityCatalogSchema,
  PlaygroundCompileResultSchema,
  PlaygroundGenerateResultSchema,
} from '../src/connected.ts'

describe('playground wire schemas', () => {
  test('method names match the Rust protocol', () => {
    expect(CONNECTED_METHODS.playgroundCatalog).toBe('morphir.playground.catalog')
    expect(CONNECTED_METHODS.playgroundCompile).toBe('morphir.playground.compile')
    expect(CONNECTED_METHODS.playgroundGenerate).toBe('morphir.playground.generate')
  })

  test('a catalog decodes frontends and targets', () => {
    const decoded = Schema.decodeUnknownSync(CapabilityCatalogSchema)({
      frontends: [
        {
          languageId: 'elm',
          displayName: 'Elm',
          fileExtensions: ['elm'],
          irVersions: ['3'],
          languagesDeclared: true,
          compile: true,
          provider: {
            extensionId: 'morphir-elm',
            extensionName: 'Morphir Elm',
            version: '1.2.3',
            kind: 'installed',
          },
        },
      ],
      targets: [
        {
          target: 'scala',
          displayName: 'Scala',
          irVersions: ['3'],
          generate: true,
          provider: {
            extensionId: 'morphir-scala',
            extensionName: 'Morphir Scala',
            version: '1.0.0',
            kind: 'installed',
          },
        },
      ],
    })

    expect(decoded.frontends[0]?.languageId).toBe('elm')
    expect(decoded.frontends[0]?.provider.kind).toBe('installed')
    expect(decoded.targets[0]?.target).toBe('scala')
  })

  test('an undeclared frontend decodes with no languages', () => {
    const decoded = Schema.decodeUnknownSync(CapabilityCatalogSchema)({
      frontends: [
        {
          languageId: 'morphir-mystery',
          displayName: 'Mystery',
          fileExtensions: [],
          irVersions: [],
          languagesDeclared: false,
          compile: true,
          provider: {
            extensionId: 'morphir-mystery',
            extensionName: 'Mystery',
            version: null,
            kind: 'installed',
          },
        },
      ],
      targets: [],
    })

    expect(decoded.frontends[0]?.languagesDeclared).toBe(false)
    expect(decoded.frontends[0]?.irVersions).toEqual([])
  })

  test('a compile result carries diagnostics with zero-based ranges', () => {
    const decoded = Schema.decodeUnknownSync(PlaygroundCompileResultSchema)({
      success: false,
      irVersion: null,
      ir: null,
      modules: [],
      diagnostics: [
        {
          severity: 'error',
          code: null,
          message: 'Type mismatch',
          location: {
            uri: 'morphir-playground:/Main.elm',
            range: { start: { line: 0, character: 4 }, end: { line: 0, character: 9 } },
          },
        },
      ],
    })

    expect(decoded.success).toBe(false)
    expect(decoded.diagnostics[0]?.location?.range.end.character).toBe(9)
  })

  test('a generate result carries artifacts and no output path', () => {
    const decoded = Schema.decodeUnknownSync(PlaygroundGenerateResultSchema)({
      success: true,
      artifacts: [{ path: 'schema.avsc', content: '{}', binary: false }],
      diagnostics: [],
    })

    expect(decoded.artifacts[0]?.path).toBe('schema.avsc')
    expect(decoded.artifacts[0]?.binary).toBe(false)
  })

  test('provider selection is a string for installed providers and defaults to null otherwise', () => {
    const decoded = Schema.decodeUnknownSync(CapabilityCatalogSchema)({
      frontends: [
        {
          languageId: 'elm',
          displayName: 'Morphir Elm',
          fileExtensions: ['.elm'],
          irVersions: ['3'],
          languagesDeclared: true,
          compile: true,
          provider: {
            extensionId: 'morphir-elm',
            extensionName: 'Morphir Elm',
            version: '1.2.3',
            kind: 'installed',
            selection: 'channel stable',
          },
        },
      ],
      targets: [
        {
          target: 'scala',
          displayName: 'Morphir Scala',
          irVersions: ['3'],
          generate: true,
          provider: {
            extensionId: 'morphir-scala',
            extensionName: 'Morphir Scala',
            version: null,
            kind: 'builtin',
          },
        },
      ],
    })

    expect(decoded.frontends[0]?.provider.selection).toBe('channel stable')
    expect(decoded.targets[0]?.provider.selection).toBe(null)
  })

  test('a malformed catalog is rejected rather than coerced', () => {
    expect(() =>
      Schema.decodeUnknownSync(CapabilityCatalogSchema)({ frontends: 'not an array', targets: [] }),
    ).toThrow()
  })
})
