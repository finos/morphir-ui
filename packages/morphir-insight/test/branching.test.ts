import { describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import { decodeMorphirIr, decodeEntryValueDef, nameToCamel, type MorphirLibrary, type RawDefEntry } from '@morphir/ir'
import { makeContext, toViewTree, type ViewNode } from '../src/index.ts'

let lib: MorphirLibrary
const defs = new Map<string, RawDefEntry>()
const tree = async (name: string): Promise<ViewNode> => {
  if (!defs.size) {
    const text = await Bun.file(new URL('../../morphir-ir/test/fixtures/insight-ir.json', import.meta.url)).text()
    lib = await Effect.runPromise(decodeMorphirIr(text))
    for (const e of lib.modules[0]!.values) defs.set(nameToCamel(e.name), e)
  }
  return toViewTree(decodeEntryValueDef(defs.get(name)!)!, makeContext(lib))
}

describe('if trees', () => {
  test('gradeIf flattens three elif branches over one fallback', async () => {
    const node = await tree('gradeIf')
    expect(node.kind).toBe('v-if-tree')
    if (node.kind === 'v-if-tree') {
      expect(node.branches).toHaveLength(3)
      expect(node.branches[0]!.condition.kind).toBe('v-binary-op')
      expect(node.branches[0]!.thenLabel).toBe('Yes')
      expect(node.fallback).toMatchObject({ kind: 'v-literal', text: '"F"' })
    }
  })

  test('maybeCase becomes a set/not-set if-tree, not a table', async () => {
    const node = await tree('maybeCase')
    expect(node.kind).toBe('v-if-tree')
    if (node.kind === 'v-if-tree') {
      expect(node.branches[0]!.thenLabel).toBe('set')
      expect(node.branches[0]!.elseLabel).toBe('not set')
      expect(node.fallback).toMatchObject({ kind: 'v-literal', text: '0' })
    }
  })
})

describe('decision tables', () => {
  test('colorCase: one column, three constructor rows', async () => {
    const node = await tree('colorCase')
    expect(node.kind).toBe('v-decision-table')
    if (node.kind === 'v-decision-table') {
      expect(node.columns).toHaveLength(1)
      expect(node.rows).toHaveLength(3)
      expect(node.rows[0]!.cells[0]).toEqual({ kind: 'cell-pattern', text: 'Red' })
    }
  })

  test('tupleCase: tuple subject decomposes into two columns; wildcard row widens', async () => {
    const node = await tree('tupleCase')
    expect(node.kind).toBe('v-decision-table')
    if (node.kind === 'v-decision-table') {
      expect(node.columns).toHaveLength(2)
      expect(node.rows[0]!.cells.map((c) => c.kind)).toEqual(['cell-pattern', 'cell-pattern'])
      expect(node.rows[1]!.cells.map((c) => c.kind)).toEqual(['cell-wildcard', 'cell-pattern'])
      expect(node.rows[2]!.cells.map((c) => c.kind)).toEqual(['cell-wildcard', 'cell-wildcard'])
    }
  })

  test('nestedCase: outer table row result embeds the inner Maybe if-tree', async () => {
    const node = await tree('nestedCase')
    expect(node.kind).toBe('v-decision-table')
    if (node.kind === 'v-decision-table') {
      expect(node.rows[0]!.result.kind).toBe('v-if-tree')
      expect(node.rows[1]!.cells[0]!.kind).toBe('cell-wildcard')
    }
  })
})
