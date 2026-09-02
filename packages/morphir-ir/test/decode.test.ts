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

  test('rejects formatVersion 2 with the regenerate message', async () => {
    const v2 = JSON.stringify({
      formatVersion: 2,
      distribution: ['Library', [], [], { modules: [] }],
    })
    const exit = await Effect.runPromiseExit(decodeMorphirIr(v2))
    expect(Exit.isFailure(exit)).toBe(true)
    const message = Exit.isFailure(exit) ? String(exit.cause) : ''
    expect(message).toContain('format version 2')
    expect(message).toContain('latest format version is 3')
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
  // major ('3') while morphir-gleam-binding reports a full triplet ('4.0.0'). Both name a
  // format version, so both have to be answerable.
  test('answers for a bare major and for a full triplet alike', () => {
    expect(canDecodeIrVersion('3')).toBe(true)
    expect(canDecodeIrVersion('3.0.0')).toBe(true)
    expect(canDecodeIrVersion('4')).toBe(false)
    expect(canDecodeIrVersion('4.0.0')).toBe(false)
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
        distribution: ['Library', [], [], { modules: [] }],
      })
      const exit = await Effect.runPromiseExit(decodeMorphirIr(ir))
      expect(Exit.isFailure(exit)).toBe(false)
    }
  })
})
