import { describe, expect, test } from 'bun:test'
import { Effect, Exit } from 'effect'
import {
  DECODABLE_FORMAT_VERSIONS,
  DECODABLE_IR_RELEASES,
  canDecodeIrVersion,
  decodeEntryValueDef,
  decodeMorphirIr,
} from '../src/index.ts'

const fixture = (name: string) => Bun.file(new URL(`./fixtures/${name}`, import.meta.url)).text()

describe('decodeMorphirIr', () => {
  test('decodes the minimal legal IR (zero modules)', async () => {
    const lib = await Effect.runPromise(decodeMorphirIr(await fixture('base-ir.json')))
    expect(lib.packageName).toEqual([['morphir'], ['example'], ['app']])
    expect(lib.modules).toHaveLength(0)
  })

  test('decodes multi-level module paths', async () => {
    const lib = await Effect.runPromise(decodeMorphirIr(await fixture('multilevelModules-ir.json')))
    expect(lib.modules).toHaveLength(2)
  })

  test('decodes types and values with access and doc', async () => {
    const lib = await Effect.runPromise(decodeMorphirIr(await fixture('simpleTypeTree-ir.json')))
    const forecast = lib.modules[0]!
    expect(forecast.path).toEqual([['forecast']])
    expect(forecast.access).toBe('Public')
    expect(forecast.types).toHaveLength(5)
    expect(forecast.types.map((t) => t.name)).toEqual([
      ['celcius'],
      ['custom', 'report'],
      ['forecast'],
      ['forecast', 'detail'],
      ['forecast', 'percent'],
    ])
    expect(forecast.values).toHaveLength(0)
  })

  test('decodes a v4 library into the explorer model', async () => {
    const typeDefinition = { CustomTypeDefinition: { typeParams: [], constructors: {} } }
    const valueDefinition = {
      ExpressionBody: {
        inputTypes: {},
        outputType: 'morphir/sdk:basics#int',
        body: { Literal: { literal: { IntegerLiteral: { value: 42 } }, attrs: {} } },
      },
    }
    const v4 = JSON.stringify({
      formatVersion: 4,
      distribution: {
        Library: {
          packageName: 'morphir/ui-smoke',
          dependencies: {},
          def: {
            modules: {
              'main/domain': {
                access: 'Private',
                value: {
                  types: {
                    greeting: {
                      access: 'Public',
                      value: { doc: 'A greeting.', value: typeDefinition },
                    },
                  },
                  values: {
                    answer: { access: 'Public', value: valueDefinition },
                  },
                },
              },
            },
          },
        },
      },
    })

    const lib = await Effect.runPromise(decodeMorphirIr(v4))
    expect(lib.packageName).toEqual([['morphir'], ['ui', 'smoke']])
    expect(lib.modules).toHaveLength(1)
    expect(lib.modules[0]?.path).toEqual([['main'], ['domain']])
    expect(lib.modules[0]?.access).toBe('Private')
    expect(lib.modules[0]?.types[0]).toEqual({
      name: ['greeting'],
      access: 'Public',
      doc: 'A greeting.',
      rawDefinition: typeDefinition,
    })
    expect(lib.modules[0]?.values[0]).toEqual({
      name: ['answer'],
      access: 'Public',
      doc: null,
      rawDefinition: valueDefinition,
    })
  })

  test('normalizes flattened v4 type and value definitions', async () => {
    const typeDefinition = {
      TypeAliasDefinition: { typeParams: [], typeExp: { Unit: { attrs: {} } } },
    }
    const valueDefinition = {
      ExpressionBody: {
        inputTypes: {},
        outputType: { Unit: { attrs: {} } },
        body: { Literal: { literal: { IntegerLiteral: { value: 42 } }, attrs: {} } },
      },
    }
    const v4 = JSON.stringify({
      formatVersion: 4,
      distribution: {
        Library: {
          packageName: 'morphir/ui-smoke',
          dependencies: {},
          def: {
            modules: {
              main: {
                access: 'Public',
                value: {
                  types: {
                    greeting: {
                      access: 'Private',
                      doc: 'A greeting.',
                      ...typeDefinition,
                    },
                  },
                  values: {
                    answer: {
                      access: 'Public',
                      doc: 'The answer.',
                      ...valueDefinition,
                    },
                  },
                },
              },
            },
          },
        },
      },
    })

    const lib = await Effect.runPromise(decodeMorphirIr(v4))
    const module = lib.modules[0]!
    expect(module.types[0]).toEqual({
      name: ['greeting'],
      access: 'Private',
      doc: 'A greeting.',
      rawDefinition: typeDefinition,
    })
    expect(module.values[0]).toEqual({
      name: ['answer'],
      access: 'Public',
      doc: 'The answer.',
      rawDefinition: valueDefinition,
    })

    const decodedValue = decodeEntryValueDef(module.values[0]!)
    expect(decodedValue?.body).toEqual({
      kind: 'literal',
      attr: {},
      literal: { kind: 'whole-number', value: 42 },
    })
  })

  test('normalizes canonical-key v4 modules, types, and values', async () => {
    const typeDefinition = {
      TypeAliasDefinition: { typeParams: [], typeExp: { Unit: { attrs: {} } } },
    }
    const valueDefinition = {
      ExpressionBody: {
        inputTypes: {},
        outputType: { Unit: { attrs: {} } },
        body: {
          Literal: {
            literal: { IntegerLiteral: { value: 42 } },
            attributes: { source: 'canonical' },
          },
        },
      },
    }
    const v4 = JSON.stringify({
      formatVersion: '4.0.0',
      distribution: {
        Library: {
          packageName: 'morphir/ui-smoke',
          dependencies: {},
          def: {
            modules: {
              main: {
                Public: {
                  types: {
                    greeting: {
                      Private: { doc: 'A greeting.', value: typeDefinition },
                    },
                  },
                  values: {
                    answer: { Public: valueDefinition },
                  },
                },
              },
            },
          },
        },
      },
    })

    const lib = await Effect.runPromise(decodeMorphirIr(v4))
    const module = lib.modules[0]!
    expect(module.access).toBe('Public')
    expect(module.types[0]).toEqual({
      name: ['greeting'],
      access: 'Private',
      doc: 'A greeting.',
      rawDefinition: typeDefinition,
    })
    expect(module.values[0]).toEqual({
      name: ['answer'],
      access: 'Public',
      doc: null,
      rawDefinition: valueDefinition,
    })
    const canonicalBody = decodeEntryValueDef(module.values[0]!)?.body
    expect(canonicalBody?.kind).toBe('literal')
    if (canonicalBody?.kind === 'literal')
      expect(canonicalBody.attr).toEqual({ source: 'canonical' })
  })

  test('normalizes every accepted canonical-key access spelling', async () => {
    const typeDefinition = {
      TypeAliasDefinition: { typeParams: [], typeExp: { Unit: { attrs: {} } } },
    }
    const valueDefinition = {
      ExpressionBody: {
        inputTypes: {},
        outputType: { Unit: { attrs: {} } },
        body: { Unit: { attrs: {} } },
      },
    }
    const spellings = [
      ['Public', 'Public'],
      ['Private', 'Private'],
      ['public', 'Public'],
      ['private', 'Private'],
      ['pub', 'Public'],
    ] as const

    for (const [spelling, normalized] of spellings) {
      const moduleDefinition = {
        types: { item: { [spelling]: typeDefinition } },
        values: { answer: { [spelling]: valueDefinition } },
      }
      const v4 = JSON.stringify({
        formatVersion: 4,
        distribution: {
          Library: {
            packageName: 'morphir/ui-smoke',
            def: { modules: { main: { [spelling]: moduleDefinition } } },
          },
        },
      })

      const module = (await Effect.runPromise(decodeMorphirIr(v4))).modules[0]!
      expect(module.access, spelling).toBe(normalized)
      expect(module.types[0]?.access, spelling).toBe(normalized)
      expect(module.values[0]?.access, spelling).toBe(normalized)
      expect(module.types[0]?.rawDefinition, spelling).toEqual(typeDefinition)
      expect(module.values[0]?.rawDefinition, spelling).toEqual(valueDefinition)
    }
  })

  test('normalizes every accepted explicit access spelling', async () => {
    const typeDefinition = {
      TypeAliasDefinition: { typeParams: [], typeExp: { Unit: { attrs: {} } } },
    }
    const valueDefinition = {
      ExpressionBody: {
        inputTypes: {},
        outputType: { Unit: { attrs: {} } },
        body: { Unit: { attrs: {} } },
      },
    }
    const spellings = [
      ['Public', 'Public'],
      ['Private', 'Private'],
      ['public', 'Public'],
      ['private', 'Private'],
      ['pub', 'Public'],
    ] as const

    for (const [spelling, normalized] of spellings) {
      const v4 = JSON.stringify({
        formatVersion: 4,
        distribution: {
          Library: {
            packageName: 'morphir/ui-smoke',
            def: {
              modules: {
                main: {
                  access: spelling,
                  value: {
                    types: { item: { access: spelling, value: typeDefinition } },
                    values: { answer: { access: spelling, value: valueDefinition } },
                  },
                },
              },
            },
          },
        },
      })

      const module = (await Effect.runPromise(decodeMorphirIr(v4))).modules[0]!
      expect(module.access, spelling).toBe(normalized)
      expect(module.types[0]?.access, spelling).toBe(normalized)
      expect(module.values[0]?.access, spelling).toBe(normalized)
      expect(module.types[0]?.rawDefinition, spelling).toEqual(typeDefinition)
      expect(module.values[0]?.rawDefinition, spelling).toEqual(valueDefinition)
    }
  })

  test('rejects ambiguous canonical and explicit access wrappers', async () => {
    const moduleDefinition = { types: {}, values: {} }
    const typeDefinition = {
      TypeAliasDefinition: { typeParams: [], typeExp: { Unit: { attrs: {} } } },
    }
    const invalidModules = [
      { Public: moduleDefinition, private: moduleDefinition },
      {
        Public: {
          types: {
            item: { pub: typeDefinition, access: 'Private', value: typeDefinition },
          },
          values: {},
        },
      },
    ]

    for (const invalidModule of invalidModules) {
      const v4 = JSON.stringify({
        formatVersion: 4,
        distribution: {
          Library: {
            packageName: 'morphir/ui-smoke',
            def: { modules: { main: invalidModule } },
          },
        },
      })
      const exit = await Effect.runPromiseExit(decodeMorphirIr(v4))
      expect(Exit.isFailure(exit)).toBe(true)
    }
  })

  test('prefers published attributes and preserves the attrs fallback', async () => {
    const expressionBody = (attributeKey: 'attributes' | 'attrs', source: string) => ({
      ExpressionBody: {
        inputTypes: {},
        outputType: { Unit: { attrs: {} } },
        body: {
          Literal: {
            literal: { IntegerLiteral: { value: 42 } },
            [attributeKey]: { source },
          },
        },
      },
    })
    const v4 = JSON.stringify({
      formatVersion: 4,
      distribution: {
        Library: {
          packageName: 'morphir/ui-smoke',
          dependencies: {},
          def: {
            modules: {
              main: {
                access: 'Public',
                value: {
                  types: {},
                  values: {
                    published: {
                      access: 'Public',
                      value: expressionBody('attributes', 'published'),
                    },
                    fallback: {
                      access: 'Public',
                      value: expressionBody('attrs', 'fallback'),
                    },
                  },
                },
              },
            },
          },
        },
      },
    })

    const values = (await Effect.runPromise(decodeMorphirIr(v4))).modules[0]!.values
    const publishedBody = decodeEntryValueDef(values[0]!)?.body
    const fallbackBody = decodeEntryValueDef(values[1]!)?.body
    expect(publishedBody?.kind).toBe('literal')
    expect(fallbackBody?.kind).toBe('literal')
    if (publishedBody?.kind === 'literal')
      expect(publishedBody.attr).toEqual({ source: 'published' })
    if (fallbackBody?.kind === 'literal') expect(fallbackBody.attr).toEqual({ source: 'fallback' })
  })

  test('rejects canonical and legacy definition payload arrays', async () => {
    const definition = {
      TypeAliasDefinition: { typeParams: [], typeExp: { Unit: { attrs: {} } } },
    }
    for (const invalidEntry of [
      { Public: [definition] },
      { access: 'Public', value: [definition] },
    ]) {
      const v4 = JSON.stringify({
        formatVersion: 4,
        distribution: {
          Library: {
            packageName: 'morphir/ui-smoke',
            dependencies: {},
            def: {
              modules: {
                main: {
                  access: 'Public',
                  value: { types: { greeting: invalidEntry }, values: {} },
                },
              },
            },
          },
        },
      })

      const exit = await Effect.runPromiseExit(decodeMorphirIr(v4))
      expect(Exit.isFailure(exit)).toBe(true)
    }
  })

  test('rejects arrays at every v4 mapping boundary', async () => {
    const library = (def: unknown) => ({
      Library: { packageName: 'morphir/ui-smoke', def },
    })
    const cases: ReadonlyArray<readonly [string, unknown]> = [
      ['distribution', []],
      ['Library payload', { Library: [] }],
      ['package definition', { Library: { packageName: 'morphir/ui-smoke', def: [] } }],
      ['modules map', library({ modules: [] })],
      ['types map', library({ modules: { main: { Public: { types: [], values: {} } } } })],
      ['values map', library({ modules: { main: { Public: { types: {}, values: [] } } } })],
    ]

    for (const [boundary, distribution] of cases) {
      const exit = await Effect.runPromiseExit(
        decodeMorphirIr(JSON.stringify({ formatVersion: 4, distribution })),
      )
      expect(Exit.isFailure(exit), boundary).toBe(true)
    }
  })

  test('decodes baseline release strings exactly like their integer spellings', async () => {
    const v3Distribution = ['Library', [['morphir'], ['example'], ['app']], [], { modules: [] }]
    const v4Distribution = {
      Library: {
        packageName: 'morphir/example/app',
        dependencies: {},
        def: { modules: {} },
      },
    }

    for (const [major, distribution] of [
      [3, v3Distribution],
      [4, v4Distribution],
    ] as const) {
      const integerLibrary = await Effect.runPromise(
        decodeMorphirIr(JSON.stringify({ formatVersion: major, distribution })),
      )
      const releaseStringLibrary = await Effect.runPromise(
        decodeMorphirIr(JSON.stringify({ formatVersion: `${major}.0.0`, distribution })),
      )
      expect(releaseStringLibrary).toEqual(integerLibrary)
    }
  })

  test('rejects an unsupported v4 revision without losing its release', async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        decodeMorphirIr(
          JSON.stringify({
            formatVersion: '4.1.0',
            distribution: [],
          }),
        ),
      ),
    )

    expect(error._tag).toBe('UnsupportedFormatVersion')
    if (error._tag === 'UnsupportedFormatVersion') {
      expect(error.found).toBe('4.1.0')
      expect(error.message).toContain('format version 4.1.0')
      expect(error.message).not.toContain('NaN')
    }
  })

  test('rejects formatVersion 2 with the regenerate message', async () => {
    const v2 = JSON.stringify({
      formatVersion: 2,
      distribution: ['Library', [], [], { modules: [] }],
    })
    const exit = await Effect.runPromiseExit(decodeMorphirIr(v2))
    expect(Exit.isFailure(exit)).toBe(true)
    const message = Exit.isFailure(exit) ? String(exit.cause) : ''
    expect(message).toContain('format version 2')
    expect(message).toContain('supports versions 3 and 4')
  })

  // A release string must be an exact triplet. Coercible scalars and collections do not
  // become valid merely because Number() can turn them into a supported major.
  test('rejects malformed or coercible format versions at the envelope boundary', async () => {
    for (const found of [
      '3',
      '4.0',
      ' 4.0.0',
      '04.0.0',
      '4.4294967296.0',
      0,
      -1,
      3.1,
      4_294_967_296,
      true,
      null,
      [3],
      ['3'],
      { valueOf: () => 3 },
    ]) {
      const ir = JSON.stringify({
        formatVersion: found,
        distribution: ['Library', [], [], { modules: [] }],
      })
      const error = await Effect.runPromise(Effect.flip(decodeMorphirIr(ir)))
      expect(error._tag, JSON.stringify(found)).toBe('UnsupportedFormatVersion')
    }
  })

  test('rejects formatVersion 1 as legacy', async () => {
    const v1 = JSON.stringify({ formatVersion: 1, distribution: [] })
    const exit = await Effect.runPromiseExit(decodeMorphirIr(v1))
    expect(String(exit)).toContain('format version 1')
  })

  test('rejects a missing formatVersion with the regenerate message', async () => {
    const exit = await Effect.runPromiseExit(decodeMorphirIr('{"distribution": []}'))
    expect(String(exit)).toContain("doesn't have a format version")
  })

  test('rejects invalid JSON', async () => {
    const exit = await Effect.runPromiseExit(decodeMorphirIr('not json'))
    expect(Exit.isFailure(exit)).toBe(true)
  })
})

describe('canDecodeIrVersion', () => {
  // The catalog spells advertised versions two ways at once: morphir-elm reports a bare
  // major ('3') while morphir-gleam-binding reports a full triplet ('4.0.0'). Per the
  // formatVersion contract those are two spellings of one release — integer N means the
  // baseline release N.0.0 — so both have to answer the same.
  test('reads a bare major and a baseline triplet as the same release', () => {
    expect(canDecodeIrVersion('3')).toBe(true)
    expect(canDecodeIrVersion('3.0.0')).toBe(true)
    expect(canDecodeIrVersion('4')).toBe(true)
    expect(canDecodeIrVersion('4.0.0')).toBe(true)
  })

  // Support is per exact release, not per major family: the contract's own outcomes
  // separate an unsupported revision from an unsupported major. A non-baseline release
  // is written on the wire as the exact string '3.1.0' rather than the integer 3, which
  // is precisely what decodeMorphirIr refuses — so admitting it here would steer a
  // caller into requesting IR that then fails to decode.
  test('a revision inside a decodable major is not itself decodable', () => {
    expect(canDecodeIrVersion('3.1.0')).toBe(false)
    expect(canDecodeIrVersion('3.1')).toBe(false)
    expect(canDecodeIrVersion('3.0.1')).toBe(false)
  })

  // A version this decoder has never heard of is not decodable. Saying otherwise would
  // send a caller off to request IR that fails at the format check instead.
  test('an unparseable or empty version is not decodable', () => {
    expect(canDecodeIrVersion('')).toBe(false)
    expect(canDecodeIrVersion('draft')).toBe(false)
    expect(canDecodeIrVersion('v3')).toBe(false)
  })

  test('rejects noncanonical or out-of-range catalog release spellings', () => {
    for (const version of [
      '03.0.0',
      '3.00.0',
      ' 3.0.0',
      '3.0.0 ',
      '3.0',
      '3.0.0-alpha',
      '3.0.0+build',
      '0000000000000000000000000000000000000003.0.0',
      '3.4294967296.0',
    ]) {
      expect(canDecodeIrVersion(version), version).toBe(false)
    }
  })

  test('publishes immutable and aligned decoder support tables', () => {
    expect(DECODABLE_IR_RELEASES).toEqual(DECODABLE_FORMAT_VERSIONS.map((major) => `${major}.0.0`))
    expect(Object.isFrozen(DECODABLE_IR_RELEASES)).toBe(true)
    expect(Object.isFrozen(DECODABLE_FORMAT_VERSIONS)).toBe(true)
  })

  // The predicate and the decoder must not be able to disagree: whatever
  // canDecodeIrVersion admits, decodeMorphirIr has to accept, or callers are steered
  // toward a version that then fails the format check.
  test('every admitted version is one decodeMorphirIr actually accepts', async () => {
    for (const version of DECODABLE_FORMAT_VERSIONS) {
      expect(canDecodeIrVersion(String(version))).toBe(true)
      const ir = JSON.stringify({
        formatVersion: version,
        distribution:
          version === 3
            ? ['Library', [], [], { modules: [] }]
            : {
                Library: {
                  packageName: 'morphir/example/app',
                  dependencies: {},
                  def: { modules: {} },
                },
              },
      })
      const exit = await Effect.runPromiseExit(decodeMorphirIr(ir))
      expect(Exit.isFailure(exit)).toBe(false)
    }
  })
})
