import { describe, expect, test } from 'bun:test'
import { Effect, Exit } from 'effect'
import { decodeMorphirIr } from '../src/index.ts'

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
