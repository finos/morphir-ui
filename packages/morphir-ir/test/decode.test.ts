import { describe, expect, test } from 'bun:test'
import { Effect, Exit } from 'effect'
import { DECODABLE_FORMAT_VERSIONS, canDecodeIrVersion, decodeMorphirIr } from '../src/index.ts'

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
                    greeting: { access: 'Public', value: typeDefinition },
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
      doc: null,
      rawDefinition: typeDefinition,
    })
    expect(lib.modules[0]?.values[0]).toEqual({
      name: ['answer'],
      access: 'Public',
      doc: null,
      rawDefinition: valueDefinition,
    })
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

  // The envelope's formatVersion is a JSON number, and only a number. Every value here
  // coerces to a supported 3 through Number(), so a membership test that coerces would
  // wave through an envelope whose shape is already wrong.
  test('rejects a formatVersion that is not a number, however coercible', async () => {
    for (const found of ['3', [3], ['3'], { valueOf: () => 3 }]) {
      const ir = JSON.stringify({
        formatVersion: found,
        distribution: ['Library', [], [], { modules: [] }],
      })
      const exit = await Effect.runPromiseExit(decodeMorphirIr(ir))
      expect(Exit.isFailure(exit)).toBe(true)
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
