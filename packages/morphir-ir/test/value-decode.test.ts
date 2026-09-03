import { describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import {
  decodeMorphirIr,
  decodeEntryValueDef,
  decodeValueExpr,
  uncurryApply,
  nameToCamel,
  type DecodedNodeKind,
  type RawDefEntry,
} from '../src/index.ts'
import { expectedDecodedNodeKinds, xrayAllKindsV3 } from './support/xray-all-kinds-v3.ts'

const loadFixture = async () => {
  const text = await Bun.file(new URL('./fixtures/insight-ir.json', import.meta.url)).text()
  const lib = await Effect.runPromise(decodeMorphirIr(text))
  const values = new Map<string, RawDefEntry>()
  for (const entry of lib.modules[0]!.values) values.set(nameToCamel(entry.name), entry)
  return values
}

const collectUnknownTags = (node: unknown, found: string[] = []): string[] => {
  if (Array.isArray(node)) {
    for (const item of node) collectUnknownTags(item, found)
    return found
  }
  if (typeof node === 'object' && node !== null) {
    const rec = node as Record<string, unknown>
    if (rec['kind'] === 'unknown' && typeof rec['tag'] === 'string') found.push(rec['tag'])
    for (const [key, value] of Object.entries(rec)) {
      if (key === 'raw') continue // UnknownNode.raw holds the original JSON; not part of the decoded tree
      collectUnknownTags(value, found)
    }
    return found
  }
  return found
}

const collectDecodedKinds = (
  node: unknown,
  found: Set<DecodedNodeKind> = new Set(),
): ReadonlySet<DecodedNodeKind> => {
  if (Array.isArray(node)) {
    for (const item of node) collectDecodedKinds(item, found)
    return found
  }
  if (typeof node === 'object' && node !== null) {
    const rec = node as Record<string, unknown>
    if (typeof rec['kind'] === 'string') found.add(rec['kind'] as DecodedNodeKind)
    for (const [key, value] of Object.entries(rec)) {
      if (key === 'attr' || key === 'raw') continue
      collectDecodedKinds(value, found)
    }
  }
  return found
}

describe('decodeValueExpr against unit snippets', () => {
  test('literal with full type attribute', () => {
    const raw = [
      'Literal',
      ['Reference', {}, [[['morphir'], ['s', 'd', 'k']], [['basics']], ['int']], []],
      ['WholeNumberLiteral', 0],
    ]
    const d = decodeValueExpr(raw)
    expect(d.kind).toBe('literal')
    if (d.kind === 'literal') expect(d.literal).toEqual({ kind: 'whole-number', value: 0 })
  })
  test('record fields are name/value pairs', () => {
    const raw = ['Record', {}, [[['age'], ['Literal', {}, ['WholeNumberLiteral', 36]]]]]
    const d = decodeValueExpr(raw)
    expect(d.kind).toBe('value-record')
    if (d.kind === 'value-record') {
      expect(d.fields[0]!.name).toEqual(['age'])
      expect(d.fields[0]!.value.kind).toBe('literal')
    }
  })
  test('unknown tag degrades without throwing', () => {
    expect(decodeValueExpr(['Mystery', {}, 1]).kind).toBe('unknown')
  })

  test('decodes compact v4 wrapper payloads', () => {
    const fqn = { pkg: [['pkg']], module: [['module']], local: ['name'] }
    const cases = [
      {
        label: 'variable',
        raw: { Variable: 'x' },
        expected: { kind: 'variable', attr: {}, name: ['x'] },
      },
      {
        label: 'reference',
        raw: { Reference: 'pkg:module#name' },
        expected: { kind: 'value-reference', attr: {}, fqn },
      },
      {
        label: 'constructor',
        raw: { Constructor: 'pkg:module#name' },
        expected: { kind: 'constructor', attr: {}, fqn },
      },
      {
        label: 'tuple',
        raw: { Tuple: [{ Variable: 'x' }] },
        expected: {
          kind: 'value-tuple',
          attr: {},
          elements: [{ kind: 'variable', attr: {}, name: ['x'] }],
        },
      },
      {
        label: 'list',
        raw: { List: [{ Literal: 42 }] },
        expected: {
          kind: 'value-list',
          attr: {},
          items: [
            {
              kind: 'literal',
              attr: {},
              literal: { kind: 'whole-number', value: 42 },
            },
          ],
        },
      },
      {
        label: 'literal',
        raw: { Literal: 42 },
        expected: {
          kind: 'literal',
          attr: {},
          literal: { kind: 'whole-number', value: 42 },
        },
      },
    ] as const

    for (const { label, raw, expected } of cases) {
      expect(decodeValueExpr(raw), label).toEqual(expected)
    }
  })

  test('infers compact v4 literal scalar kinds', () => {
    for (const [raw, expected] of [
      [true, { kind: 'bool', value: true }],
      [42, { kind: 'whole-number', value: 42 }],
      [3.5, { kind: 'float', value: 3.5 }],
      ['hello', { kind: 'string', value: 'hello' }],
    ] as const) {
      const decoded = decodeValueExpr({ Literal: raw })
      expect(decoded.kind, String(raw)).toBe('literal')
      if (decoded.kind === 'literal') expect(decoded.literal, String(raw)).toEqual(expected)
    }
  })

  test('degrades non-finite compact v4 literal payloads', () => {
    for (const raw of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const decoded = decodeValueExpr({ Literal: raw })
      expect(decoded.kind, String(raw)).toBe('literal')
      if (decoded.kind === 'literal') {
        expect(decoded.literal.kind, String(raw)).toBe('unknown')
      }
    }
  })

  test('preserves attributes and expanded v4 wrapper compatibility', () => {
    const attributes = { source: 'expanded' }
    const fqn = { pkg: [['pkg']], module: [['module']], local: ['name'] }
    const cases = [
      {
        label: 'variable',
        raw: { Variable: { attributes, name: 'x' } },
        expected: { kind: 'variable', attr: attributes, name: ['x'] },
      },
      {
        label: 'reference',
        raw: { Reference: { attributes, fqname: 'pkg:module#name' } },
        expected: { kind: 'value-reference', attr: attributes, fqn },
      },
      {
        label: 'constructor',
        raw: { Constructor: { attributes, fqname: 'pkg:module#name' } },
        expected: { kind: 'constructor', attr: attributes, fqn },
      },
      {
        label: 'tuple',
        raw: { Tuple: { attributes, elements: [{ Variable: 'x' }] } },
        expected: {
          kind: 'value-tuple',
          attr: attributes,
          elements: [{ kind: 'variable', attr: {}, name: ['x'] }],
        },
      },
      {
        label: 'list',
        raw: { List: { attributes, items: [{ Literal: 42 }] } },
        expected: {
          kind: 'value-list',
          attr: attributes,
          items: [
            {
              kind: 'literal',
              attr: {},
              literal: { kind: 'whole-number', value: 42 },
            },
          ],
        },
      },
      {
        label: 'literal',
        raw: { Literal: { attributes, literal: 42 } },
        expected: {
          kind: 'literal',
          attr: attributes,
          literal: { kind: 'whole-number', value: 42 },
        },
      },
    ] as const

    for (const { label, raw, expected } of cases) {
      expect(decodeValueExpr(raw), label).toEqual(expected)
    }

    expect(
      decodeValueExpr({
        Variable: {
          attributes: { source: 'published' },
          attrs: { source: 'fallback' },
          name: 'x',
        },
      }),
    ).toEqual({ kind: 'variable', attr: { source: 'published' }, name: ['x'] })
    expect(decodeValueExpr({ Variable: { attrs: { source: 'fallback' }, name: 'x' } })).toEqual({
      kind: 'variable',
      attr: { source: 'fallback' },
      name: ['x'],
    })
  })

  test('v4 expression bodies decode through literals, constructors, and apply', () => {
    const answer = decodeEntryValueDef({
      rawDefinition: {
        ExpressionBody: {
          inputTypes: {},
          outputType: { Reference: { fqname: 'morphir/ui-smoke:main#int', attrs: {} } },
          body: { Literal: { literal: { IntegerLiteral: { value: 42 } }, attrs: {} } },
        },
      },
    })
    expect(answer?.output.kind).toBe('type-reference')
    expect(answer?.body).toEqual({
      kind: 'literal',
      attr: {},
      literal: { kind: 'whole-number', value: 42 },
    })

    const hello = decodeEntryValueDef({
      rawDefinition: {
        ExpressionBody: {
          inputTypes: {},
          outputType: { Reference: { fqname: 'morphir/ui-smoke:main#greeting', attrs: {} } },
          body: {
            Apply: {
              function: { Constructor: { fqname: 'morphir/ui-smoke:main#greeting', attrs: {} } },
              argument: {
                Literal: { literal: { StringLiteral: { value: 'Hello, Morphir!' } }, attrs: {} },
              },
              attrs: {},
            },
          },
        },
      },
    })
    expect(hello?.body.kind).toBe('apply')
    if (hello?.body.kind === 'apply') {
      expect(hello.body.fn.kind).toBe('constructor')
      expect(hello.body.arg).toEqual({
        kind: 'literal',
        attr: {},
        literal: { kind: 'string', value: 'Hello, Morphir!' },
      })
    }
  })
})

describe('decoding the insight fixture', () => {
  test('all 23 definitions decode with zero unknown nodes', async () => {
    const values = await loadFixture()
    expect(values.size).toBe(23)
    for (const [name, entry] of values) {
      const def = decodeEntryValueDef(entry)
      expect(def, name).not.toBeNull()
      const found = collectUnknownTags(def)
      expect(found, `${name} contains unknown tags: ${found.join(',')}`).toEqual([])
    }
  })

  test('chainedArithmetic uncurries to add applied twice', async () => {
    const values = await loadFixture()
    const def = decodeEntryValueDef(values.get('chainedArithmetic')!)!
    const { fn, args } = uncurryApply(def.body)
    expect(fn.kind).toBe('value-reference')
    if (fn.kind === 'value-reference') expect(fn.fqn.local).toEqual(['add'])
    expect(args).toHaveLength(2)
  })

  test('gradeIf decodes as a nested if-then-else chain', async () => {
    const values = await loadFixture()
    const def = decodeEntryValueDef(values.get('gradeIf')!)!
    expect(def.body.kind).toBe('if-then-else')
    if (def.body.kind === 'if-then-else') expect(def.body.elseBranch.kind).toBe('if-then-else')
  })

  test('tupleCase decodes as pattern-match with tuple patterns', async () => {
    const values = await loadFixture()
    const def = decodeEntryValueDef(values.get('tupleCase')!)!
    expect(def.body.kind).toBe('pattern-match')
    if (def.body.kind === 'pattern-match') {
      expect(def.body.cases.length).toBe(3)
      expect(def.body.cases[0]!.pattern.kind).toBe('pattern-tuple')
    }
  })

  test('letBound decodes nested let-definitions with input metadata', async () => {
    const values = await loadFixture()
    const def = decodeEntryValueDef(values.get('letBound')!)!
    expect(def.inputs).toHaveLength(1)
    expect(def.inputs[0]!.name).toEqual(['x'])
    expect(def.body.kind).toBe('let-definition')
  })

  test('updatedPerson decodes update-record with pair fields', async () => {
    const values = await loadFixture()
    const def = decodeEntryValueDef(values.get('updatedPerson')!)!
    expect(def.body.kind).toBe('update-record')
    if (def.body.kind === 'update-record') expect(def.body.fields[0]!.name).toEqual(['age'])
  })

  test('the unknown-walker traverses pair wrappers and nested definitions', () => {
    const planted = { kind: 'unknown', tag: 'Planted', raw: null }
    expect(
      collectUnknownTags({
        kind: 'value-record',
        attr: {},
        fields: [{ name: ['f'], value: planted }],
      }),
    ).toEqual(['Planted'])
    expect(
      collectUnknownTags({
        kind: 'pattern-match',
        attr: {},
        subject: { kind: 'value-unit', attr: {} },
        cases: [{ pattern: { kind: 'wildcard' }, body: planted }],
      }),
    ).toEqual(['Planted'])
    expect(
      collectUnknownTags({
        kind: 'let-definition',
        attr: {},
        name: ['x'],
        definition: { inputs: [], output: { kind: 'type-unit' }, body: planted },
        inValue: { kind: 'value-unit', attr: {} },
      }),
    ).toEqual(['Planted'])
    expect(
      collectUnknownTags({
        kind: 'let-recursion',
        attr: {},
        definitions: [
          { name: ['f'], definition: { inputs: [], output: { kind: 'type-unit' }, body: planted } },
        ],
        inValue: { kind: 'value-unit', attr: {} },
      }),
    ).toEqual(['Planted'])
    expect(
      collectUnknownTags({
        kind: 'update-record',
        attr: {},
        subject: { kind: 'value-unit', attr: {} },
        fields: [{ name: ['f'], value: planted }],
      }),
    ).toEqual(['Planted'])
  })
})

describe('decoding the exhaustive v3 fixture', () => {
  test('finds every normalized node kind', async () => {
    const text = await Bun.file(
      new URL('./fixtures/xray-all-kinds-ir.json', import.meta.url),
    ).text()
    expect(JSON.parse(text)).toEqual(xrayAllKindsV3)

    const library = await Effect.runPromise(decodeMorphirIr(text))
    const coverageModule = library.modules.find(
      (module) =>
        module.path[0]?.[0] === 'x' &&
        module.path[0]?.[1] === 'ray' &&
        module.path[1]?.[0] === 'coverage',
    )
    expect(coverageModule?.path).toEqual([['x', 'ray'], ['coverage']])
    const entry = coverageModule?.values.find((value) => nameToCamel(value.name) === 'allNodes')
    const definition = entry === undefined ? null : decodeEntryValueDef(entry)

    expect(definition).not.toBeNull()
    expect(collectUnknownTags(definition)).toEqual(['FutureExpression'])
    expect([...collectDecodedKinds(definition)].sort()).toEqual(
      [...expectedDecodedNodeKinds].sort(),
    )
  })
})
