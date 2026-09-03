import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Effect } from 'effect'
import {
  decodeEntryValueDef,
  decodeMorphirIr,
  decodeTypeExpr,
  nameToCamel,
  type FQName,
  type TypeExpr,
  type ValueDef,
  type ValueExpr,
} from '@morphir/ir'
import { expectedDecodedNodeKinds } from '../../morphir-ir/test/support/xray-all-kinds-v3.ts'
import {
  findXRayNode,
  pointerSegment,
  projectXRayDefinition,
  projectXRayValue,
} from '../src/views/insight/xray-tree.ts'

const allKindsFixture = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    '../../morphir-ir/test/fixtures/xray-all-kinds-ir.json',
  ),
  'utf8',
)

const allKindsDefinition = async (): Promise<ValueDef> => {
  const library = await Effect.runPromise(decodeMorphirIr(allKindsFixture))
  const entry = library.modules
    .flatMap((module) => module.values)
    .find((value) => nameToCamel(value.name) === 'allNodes')
  const definition = entry === undefined ? null : decodeEntryValueDef(entry)
  if (!definition) throw new Error('Missing allNodes definition from exhaustive XRay fixture')
  return definition
}

const name = (...parts: string[]) => parts
const fqn = (local: string): FQName => ({
  pkg: [name('morphir'), name('s', 'd', 'k')],
  module: [name('basics')],
  local: name(local),
})
const intType: TypeExpr = { kind: 'type-reference', fqn: fqn('int'), args: [] }
const unitType: TypeExpr = { kind: 'type-unit' }
const literal = (value: number, attr: unknown = {}): ValueExpr => ({
  kind: 'literal',
  attr,
  literal: { kind: 'whole-number', value },
})

describe('pointerSegment', () => {
  test('escapes JSON Pointer segment characters', () => {
    expect(pointerSegment('a/b~c')).toBe('a~1b~0c')
  })
})

describe('projectXRayValue', () => {
  test('projects nested apply fields without mutating the decoded source', () => {
    const value: ValueExpr = {
      kind: 'apply',
      attr: {},
      fn: {
        kind: 'apply',
        attr: {},
        fn: { kind: 'variable', attr: {}, name: name('fn') },
        arg: literal(1),
      },
      arg: literal(2),
    }
    const before = structuredClone(value)

    const root = projectXRayValue(value, 'body', '/body')

    expect(findXRayNode([root], '/body/fn/arg')?.kind).toBe('literal')
    expect(value).toEqual(before)
  })

  test('preserves untagged wrappers and escaped field paths as browsable nodes', () => {
    const root = projectXRayValue({ wrapper: { 'a/b~c': literal(1) } }, 'body', '/body')

    expect(findXRayNode([root], '/body/wrapper/a~1b~0c')?.kind).toBe('literal')
  })

  test('formats readable raw type attributes and omits opaque attributes', () => {
    const readable = projectXRayValue(
      literal(1, [
        'Reference',
        {},
        [[name('morphir')], [name('sdk'), name('basics')], name('int')],
        [],
      ]),
      'value',
      '/value',
    )
    const opaque = projectXRayValue(literal(1, null), 'value', '/value')

    expect(readable.typeText).toBe('Int')
    expect(readable.tokens.types).toContain('Int')
    expect(findXRayNode([readable], '/value/attr')).toBeUndefined()
    expect(opaque.typeText).toBeUndefined()
    expect(opaque.tokens.types).toEqual([])
  })

  test('indexes decoded value references by their full qualified name', () => {
    const root = projectXRayValue(
      { kind: 'value-reference', attr: {}, fqn: fqn('add') },
      'reference',
      '/reference',
    )

    expect(root.tokens.values).toContain('Morphir.SDK.Basics.add')
    expect(findXRayNode([root], '/reference/fqn/pkg')?.scalar).toBe('[["morphir"],["s","d","k"]]')
  })

  test('indexes node kinds, field labels, scalar values, and decoded types', () => {
    const root = projectXRayValue(
      literal(42, [
        'Reference',
        {},
        [[name('morphir')], [name('sdk'), name('basics')], name('int')],
        [],
      ]),
      'answer',
      '/answer',
    )
    const scalar = findXRayNode([root], '/answer/literal/value')

    expect(root.tokens.kinds).toEqual(['literal'])
    expect(root.tokens.fields).toEqual(['answer'])
    expect(root.tokens.types).toEqual(['Int'])
    expect(scalar?.tokens.fields).toEqual(['value'])
    expect(scalar?.tokens.values).toEqual(['42'])
  })

  test('keeps let definitions, pattern cases, and record fields browsable', () => {
    const definition: ValueDef = {
      inputs: [],
      output: unitType,
      body: {
        kind: 'pattern-match',
        attr: {},
        subject: literal(0),
        cases: [{ pattern: { kind: 'wildcard' }, body: literal(1) }],
      },
    }
    const body: ValueExpr = {
      kind: 'let-definition',
      attr: {},
      name: name('answer'),
      definition,
      inValue: {
        kind: 'value-record',
        attr: {},
        fields: [{ name: name('value'), value: literal(1) }],
      },
    }

    const root = projectXRayValue(body, 'body', '/body')

    expect(findXRayNode([root], '/body/definition/body/cases/0/pattern')?.kind).toBe('wildcard')
    expect(findXRayNode([root], '/body/inValue/fields/0/value')?.kind).toBe('literal')
  })

  test('keeps primitive Name and Path arrays inline', () => {
    const root = projectXRayValue(
      { kind: 'variable', attr: {}, name: name('some', 'value') },
      'value',
      '/value',
    )
    const nameNode = findXRayNode([root], '/value/name')

    expect(nameNode?.scalar).toBe('["some","value"]')
    expect(nameNode?.children).toEqual([])
  })

  test('shows unknown tags as warnings without exposing raw children', () => {
    const root = projectXRayValue(
      { kind: 'unknown', attr: {}, tag: 'Mystery', raw: ['Mystery', 1] },
      'unknown',
      '/unknown',
    )

    expect(root.warning).toContain('Mystery')
    expect(root.warning).toContain('raw unavailable in xray')
    expect(findXRayNode([root], '/unknown/raw')).toBeUndefined()
    expect(findXRayNode([root], '/unknown/kind')).toBeUndefined()
    expect(findXRayNode([root], '/unknown/attr')).toBeUndefined()
    expect(findXRayNode([root], '/unknown/tag')).toBeUndefined()
  })

  test('projects a standalone decoded type root', () => {
    const root = projectXRayValue(
      decodeTypeExpr([
        'Reference',
        {},
        [[name('morphir')], [name('sdk'), name('basics')], name('int')],
        [],
      ]),
      'type',
      '/type',
    )

    expect(findXRayNode([root], '/type')).toBe(root)
    expect(root.kind).toBe('type-reference')
  })
})

describe('projectXRayDefinition', () => {
  test('characterizes every decoded node kind in the exhaustive fixture', async () => {
    const roots = projectXRayDefinition(await allKindsDefinition())
    const kinds = new Set<string>()
    const pending = [...roots]

    while (pending.length > 0) {
      const node = pending.pop()
      if (!node) continue
      if (node.kind) kinds.add(node.kind)
      pending.push(...node.children)
    }

    expect([...kinds].sort()).toEqual([...expectedDecodedNodeKinds].sort())
    expect(findXRayNode(roots, '/body/items/22')?.kind).toBe('unknown')
    expect(findXRayNode(roots, '/body/items/19/cases/5/pattern')?.kind).toBe('head-tail')
  })

  test('creates inputs, output, and body section roots', () => {
    const def: ValueDef = {
      inputs: [{ name: name('input'), attr: {}, tpe: intType }],
      output: intType,
      body: literal(0),
    }
    const roots = projectXRayDefinition(def)

    expect(roots.map((root) => root.path)).toEqual(['/inputs', '/output', '/body'])
    expect(findXRayNode(roots, '/inputs/0')?.label).toBe('input')
  })

  test('returns undefined for a missing path', () => {
    expect(findXRayNode([], '/missing')).toBeUndefined()
  })
})
