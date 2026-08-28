import { describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import {
  decodeMorphirIr,
  nameToCamel,
  nameToTitle,
  pathToTitle,
  toWorkspaceIr,
} from '../src/index.ts'

const load = async (name: string) =>
  toWorkspaceIr(
    await Effect.runPromise(
      decodeMorphirIr(await Bun.file(new URL(`./fixtures/${name}`, import.meta.url)).text()),
    ),
  )

describe('name formatting', () => {
  test('title-cases word parts', () =>
    expect(nameToTitle(['custom', 'report'])).toBe('CustomReport'))
  test('uppercases single letters', () => expect(nameToTitle(['u', 's'])).toBe('US'))
  test('keeps digit parts verbatim', () =>
    expect(nameToTitle(['f', 'r', '2052', 'a'])).toBe('FR2052A'))
  test('camel-cases values', () => expect(nameToCamel(['list', 'example'])).toBe('listExample'))
  test('joins paths with dots', () =>
    expect(pathToTitle([['morphir'], ['example'], ['app']])).toBe('Morphir.Example.App'))
})

describe('toWorkspaceIr', () => {
  test('summarizes the package', async () => {
    const ws = await load('simpleTypeTree-ir.json')
    expect(ws.package).toEqual({ name: 'Morphir.Example.App', moduleCount: 1 })
  })

  test('summarizes modules with counts', async () => {
    const ws = await load('simpleTypeTree-ir.json')
    expect(ws.modules[0]).toEqual({
      packageName: 'Morphir.Example.App',
      name: 'Forecast',
      typeCount: 5,
      valueCount: 0,
    })
  })

  test('formats multi-segment module names', async () => {
    const ws = await load('multilevelModules-ir.json')
    expect(ws.modules.map((m) => m.name)).toEqual(['US.FR2052A', 'US.FR2052A.DataTables'])
  })

  test('lists definitions with refs, kinds and camel-cased value names', async () => {
    const ws = await load('listType-ir.json')
    const kinds = new Set(ws.definitions.map((d) => d.kind))
    expect(kinds).toEqual(new Set(['type', 'value']))
    const value = ws.definitions.find((d) => d.kind === 'value')!
    expect(value.ref.localName).toBe('listExample')
    expect(value.ref.moduleName).toBe('Forecast')
  })
})
