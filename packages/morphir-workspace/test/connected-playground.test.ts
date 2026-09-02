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
          compile: true,
          incremental: null,
          fragments: null,
          provider: {
            extensionId: 'morphir-elm',
            extensionName: 'Morphir Elm',
            version: '1.2.3',
            origin: 'installed',
            invocationMode: 'process-mep',
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
            origin: 'installed',
            invocationMode: 'process-mep',
          },
        },
      ],
    })

    expect(decoded.frontends[0]?.languageId).toBe('elm')
    expect(decoded.frontends[0]?.provider.origin).toBe('installed')
    expect(decoded.targets[0]?.target).toBe('scala')
  })

  test('a frontend with unknown incremental/fragments support decodes as null, not false', () => {
    const decoded = Schema.decodeUnknownSync(CapabilityCatalogSchema)({
      frontends: [
        {
          languageId: 'morphir-mystery',
          displayName: 'Mystery',
          fileExtensions: [],
          irVersions: [],
          compile: true,
          incremental: null,
          fragments: null,
          provider: {
            extensionId: 'morphir-mystery',
            extensionName: 'Mystery',
            version: '0.1.0',
            origin: 'installed',
            invocationMode: 'process-mep',
          },
        },
      ],
      targets: [],
    })

    expect(decoded.frontends[0]?.incremental).toBe(null)
    expect(decoded.frontends[0]?.fragments).toBe(null)
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

  // Provenance: captured by instrumenting the real Rust catalog path and
  // running it, not hand-written from reading the struct definitions. Two
  // scratch `cargo test` runs (reverted before commit, never landed in any
  // repo) called `NativePlaygroundProvider::catalog()` — once against an
  // empty home (built-in Gleam only) and once against a home with an
  // installed Gleam extension shadowing the built-in — and printed
  // `serde_json::to_string_pretty(&catalog)`. That is the actual wire shape
  // `crates/morphir/src/commands/ui/protocol.rs` produces today, including
  // the field that would have caught the last drift: an installed
  // provider's `incremental`/`fragments` decode as `null` (its capability
  // metadata is rebuilt from a persisted record that never recorded them),
  // while the built-in's decode as the concrete boolean `false`. A schema
  // that made those fields optional rather than nullable, or omitted them
  // entirely, would still pass every other test here and still reject (or
  // silently drop) this exact server response.
  test('decodes a catalog captured from a real Rust playground session', () => {
    const capturedFromRust = {
      frontends: [
        {
          languageId: 'gleam',
          displayName: 'Installed installed-gleam',
          fileExtensions: ['.gleam'],
          irVersions: ['4.0.0'],
          compile: true,
          incremental: null,
          fragments: null,
          provider: {
            extensionId: 'installed-gleam',
            extensionName: 'Installed installed-gleam',
            version: '2.0.0',
            origin: 'installed',
            invocationMode: 'process-mep',
          },
        },
        {
          languageId: 'gleam',
          displayName: 'Morphir Gleam Binding',
          fileExtensions: ['.gleam'],
          irVersions: ['4.0.0'],
          compile: true,
          incremental: false,
          fragments: false,
          provider: {
            extensionId: 'morphir-gleam-binding',
            extensionName: 'Morphir Gleam Binding',
            version: '0.4.0-alpha.5',
            origin: 'builtin',
            invocationMode: 'native-direct',
          },
        },
      ],
      targets: [
        {
          target: 'gleam',
          displayName: 'Installed installed-gleam',
          irVersions: ['4.0.0'],
          generate: true,
          provider: {
            extensionId: 'installed-gleam',
            extensionName: 'Installed installed-gleam',
            version: '2.0.0',
            origin: 'installed',
            invocationMode: 'process-mep',
          },
        },
        {
          target: 'gleam',
          displayName: 'Morphir Gleam Binding',
          irVersions: ['4.0.0'],
          generate: true,
          provider: {
            extensionId: 'morphir-gleam-binding',
            extensionName: 'Morphir Gleam Binding',
            version: '0.4.0-alpha.5',
            origin: 'builtin',
            invocationMode: 'native-direct',
          },
        },
      ],
    }

    const decoded = Schema.decodeUnknownSync(CapabilityCatalogSchema)(capturedFromRust)

    expect(decoded.frontends[0]?.provider.origin).toBe('installed')
    expect(decoded.frontends[0]?.incremental).toBe(null)
    expect(decoded.frontends[0]?.fragments).toBe(null)
    expect(decoded.frontends[1]?.provider.origin).toBe('builtin')
    expect(decoded.frontends[1]?.incremental).toBe(false)
    expect(decoded.frontends[1]?.fragments).toBe(false)
    expect(decoded.frontends[0]?.provider.invocationMode).toBe('process-mep')
    expect(decoded.frontends[1]?.provider.invocationMode).toBe('native-direct')
    expect(decoded.targets.map((t) => t.provider.origin)).toEqual(['installed', 'builtin'])
  })

  test('a malformed catalog is rejected rather than coerced', () => {
    expect(() =>
      Schema.decodeUnknownSync(CapabilityCatalogSchema)({ frontends: 'not an array', targets: [] }),
    ).toThrow()
  })

  // The exact drift this suite exists to catch: the old wire shape
  // (`kind`/`selection` instead of `origin`, `languagesDeclared` instead of
  // nullable `incremental`/`fragments`, no `invocationMode`) must no longer
  // decode. If this test ever passes, the schema has quietly regressed to
  // accepting a shape the server no longer sends.
  test('the previous (pre-rebuild) wire shape is rejected, not coerced', () => {
    expect(() =>
      Schema.decodeUnknownSync(CapabilityCatalogSchema)({
        frontends: [
          {
            languageId: 'elm',
            displayName: 'Elm',
            fileExtensions: ['.elm'],
            irVersions: ['3'],
            languagesDeclared: true,
            compile: true,
            provider: {
              extensionId: 'morphir-elm',
              extensionName: 'Elm',
              version: null,
              kind: 'builtin',
              selection: null,
            },
          },
        ],
        targets: [],
      }),
    ).toThrow()
  })
})
