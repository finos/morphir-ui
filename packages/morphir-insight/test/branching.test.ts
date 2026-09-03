import { describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import {
  decodeMorphirIr,
  decodeEntryValueDef,
  nameToCamel,
  type MorphirLibrary,
  type Pattern,
  type RawDefEntry,
  type ValueDef,
  type ValueExpr,
} from '@morphir/ir'
import { makeContext, toViewTree, type ViewNode } from '../src/index.ts'

const emptyLib: MorphirLibrary = { packageName: [['test']], modules: [] }
const nestedTuplePattern: Pattern = {
  kind: 'pattern-tuple',
  elements: [
    { kind: 'as', inner: { kind: 'wildcard' }, name: ['x'] },
    {
      kind: 'pattern-tuple',
      elements: [
        { kind: 'as', inner: { kind: 'wildcard' }, name: ['y'] },
        { kind: 'as', inner: { kind: 'wildcard' }, name: ['z'] },
      ],
    },
  ],
}
const decisionTable = (subject: ValueExpr, pattern: Pattern = nestedTuplePattern): ViewNode => {
  const def: ValueDef = {
    inputs: [],
    output: { kind: 'type-unit' },
    body: {
      kind: 'pattern-match',
      attr: {},
      subject,
      cases: [{ pattern, body: { kind: 'value-unit', attr: {} } }],
    },
  }
  return toViewTree(def, makeContext(emptyLib))
}

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
  test('nested tuple subject and pattern produce one cell per leaf', () => {
    const node = decisionTable({
      kind: 'value-tuple',
      attr: {},
      elements: [
        { kind: 'variable', attr: {}, name: ['a'] },
        {
          kind: 'value-tuple',
          attr: {},
          elements: [
            { kind: 'variable', attr: {}, name: ['b'] },
            { kind: 'variable', attr: {}, name: ['c'] },
          ],
        },
      ],
    })

    expect(node.kind).toBe('v-decision-table')
    if (node.kind === 'v-decision-table') {
      expect(node.columns).toHaveLength(3)
      expect(node.rows[0]!.cells).toEqual([
        { kind: 'cell-pattern', text: 'x' },
        { kind: 'cell-pattern', text: 'y' },
        { kind: 'cell-pattern', text: 'z' },
      ])
    }
  })

  test('opaque tuple position repeats its subject header for nested pattern leaves', () => {
    const node = decisionTable({
      kind: 'value-tuple',
      attr: {},
      elements: [
        { kind: 'variable', attr: {}, name: ['a'] },
        { kind: 'variable', attr: {}, name: ['pair'] },
      ],
    })

    expect(node.kind).toBe('v-decision-table')
    if (node.kind === 'v-decision-table') {
      expect(node.columns).toEqual([
        { kind: 'v-variable', name: 'a' },
        { kind: 'v-variable', name: 'pair' },
        { kind: 'v-variable', name: 'pair' },
      ])
      expect(node.rows[0]!.cells).toEqual([
        { kind: 'cell-pattern', text: 'x' },
        { kind: 'cell-pattern', text: 'y' },
        { kind: 'cell-pattern', text: 'z' },
      ])
      for (const row of node.rows) expect(row.cells).toHaveLength(node.columns.length)
    }
  })

  test('opaque first tuple position repeats before the following subject header', () => {
    const pattern: Pattern = {
      kind: 'pattern-tuple',
      elements: [
        {
          kind: 'pattern-tuple',
          elements: [
            { kind: 'as', inner: { kind: 'wildcard' }, name: ['x'] },
            { kind: 'as', inner: { kind: 'wildcard' }, name: ['y'] },
          ],
        },
        { kind: 'as', inner: { kind: 'wildcard' }, name: ['z'] },
      ],
    }
    const node = decisionTable(
      {
        kind: 'value-tuple',
        attr: {},
        elements: [
          { kind: 'variable', attr: {}, name: ['pair'] },
          { kind: 'variable', attr: {}, name: ['c'] },
        ],
      },
      pattern,
    )

    expect(node.kind).toBe('v-decision-table')
    if (node.kind === 'v-decision-table') {
      expect(node.columns).toEqual([
        { kind: 'v-variable', name: 'pair' },
        { kind: 'v-variable', name: 'pair' },
        { kind: 'v-variable', name: 'c' },
      ])
      expect(node.rows[0]!.cells).toEqual([
        { kind: 'cell-pattern', text: 'x' },
        { kind: 'cell-pattern', text: 'y' },
        { kind: 'cell-pattern', text: 'z' },
      ])
      for (const row of node.rows) expect(row.cells).toHaveLength(node.columns.length)
    }
  })

  test('nested tuple pattern determines columns for a variable subject', () => {
    const node = decisionTable({ kind: 'variable', attr: {}, name: ['input'] })

    expect(node.kind).toBe('v-decision-table')
    if (node.kind === 'v-decision-table') {
      expect(node.columns).toHaveLength(3)
      expect(node.rows[0]!.cells).toEqual([
        { kind: 'cell-pattern', text: 'x' },
        { kind: 'cell-pattern', text: 'y' },
        { kind: 'cell-pattern', text: 'z' },
      ])
    }
  })

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
