import { describe, expect, test } from 'bun:test'
import type { ValueDef, ValueExpr } from '@morphir/ir'
import { makeContext, patternToText, toViewTree } from '../src/index.ts'
import type { MorphirLibrary } from '@morphir/ir'

const emptyLib: MorphirLibrary = { packageName: [['test']], modules: [] }
const ctx = () => makeContext(emptyLib)
const lit = (n: number): ValueExpr => ({ kind: 'literal', attr: {}, literal: { kind: 'whole-number', value: n } })
const def = (body: ValueExpr): ValueDef => ({ inputs: [], output: { kind: 'type-unit' }, body })

describe('structural transform', () => {
  test('literals format by kind', () => {
    expect(toViewTree(def(lit(42)), ctx())).toEqual({ kind: 'v-literal', text: '42', literalKind: 'whole-number' })
    expect(toViewTree(def({ kind: 'literal', attr: {}, literal: { kind: 'string', value: 'hi' } }), ctx()))
      .toEqual({ kind: 'v-literal', text: '"hi"', literalKind: 'string' })
    expect(toViewTree(def({ kind: 'literal', attr: {}, literal: { kind: 'bool', value: true } }), ctx()))
      .toEqual({ kind: 'v-literal', text: 'True', literalKind: 'bool' })
  })

  test('records, lists, tuples, field access', () => {
    const rec = toViewTree(def({ kind: 'value-record', attr: {}, fields: [{ name: ['age'], value: lit(1) }] }), ctx())
    expect(rec).toEqual({ kind: 'v-record', fields: [{ name: 'age', value: { kind: 'v-literal', text: '1', literalKind: 'whole-number' } }] })
    expect(toViewTree(def({ kind: 'value-list', attr: {}, items: [lit(1), lit(2)] }), ctx()).kind).toBe('v-list')
    expect(toViewTree(def({ kind: 'value-tuple', attr: {}, elements: [lit(1)] }), ctx()).kind).toBe('v-tuple')
    const fa = toViewTree(def({ kind: 'field', attr: {}, subject: { kind: 'variable', attr: {}, name: ['p'] }, name: ['age'] }), ctx())
    expect(fa).toEqual({ kind: 'v-field-access', subject: { kind: 'v-variable', name: 'p' }, field: 'age' })
  })

  test('lambda and let-group', () => {
    const lam = toViewTree(def({ kind: 'lambda', attr: {}, pattern: { kind: 'as', inner: { kind: 'wildcard' }, name: ['y'] }, body: lit(1) }), ctx())
    expect(lam).toEqual({ kind: 'v-lambda', pattern: 'y', body: { kind: 'v-literal', text: '1', literalKind: 'whole-number' } })
    const letNode = toViewTree(def({
      kind: 'let-definition', attr: {}, name: ['doubled'],
      definition: { inputs: [], output: { kind: 'type-unit' }, body: lit(2) },
      inValue: { kind: 'let-definition', attr: {}, name: ['offset'], definition: { inputs: [], output: { kind: 'type-unit' }, body: lit(3) }, inValue: { kind: 'variable', attr: {}, name: ['offset'] } }
    }), ctx())
    // consecutive let-definitions flatten into ONE v-let-group
    expect(letNode).toEqual({
      kind: 'v-let-group',
      bindings: [
        { name: 'doubled', value: { kind: 'v-literal', text: '2', literalKind: 'whole-number' } },
        { name: 'offset', value: { kind: 'v-literal', text: '3', literalKind: 'whole-number' } }
      ],
      body: { kind: 'v-variable', name: 'offset' }
    })
  })

  // Drill-down (see drill-down.test.ts) narrows "expandable" to found-in-library && !SDK; an
  // unresolvable non-SDK reference (this context's library has no modules) is collapsed and
  // not expandable, same as an SDK reference.
  test('non-SDK reference not found in the library is not expandable; SDK plain reference is not expandable', () => {
    const userRef = toViewTree(def({ kind: 'value-reference', attr: {}, fqn: { pkg: [['my'], ['pkg']], module: [['mod']], local: ['helper'] } }), ctx())
    expect(userRef).toEqual({ kind: 'v-reference', fqn: { pkg: [['my'], ['pkg']], module: [['mod']], local: ['helper'] }, display: 'helper', expandable: false, args: [] })
    const sdkRef = toViewTree(def({ kind: 'value-reference', attr: {}, fqn: { pkg: [['morphir'], ['s', 'd', 'k']], module: [['string']], local: ['to', 'upper'] } }), ctx())
    expect(sdkRef.kind).toBe('v-reference')
    if (sdkRef.kind === 'v-reference') expect(sdkRef.expandable).toBe(false)
  })

  test('generic apply becomes a reference call with args', () => {
    const call: ValueExpr = {
      kind: 'apply', attr: {},
      fn: { kind: 'value-reference', attr: {}, fqn: { pkg: [['my']], module: [['m']], local: ['f'] } },
      arg: lit(1)
    }
    const node = toViewTree(def(call), ctx())
    expect(node.kind).toBe('v-reference')
    if (node.kind === 'v-reference') { expect(node.display).toBe('f'); expect(node.args).toHaveLength(1) }
  })

  test('unknown and unit degrade gracefully', () => {
    expect(toViewTree(def({ kind: 'unknown', tag: 'Mystery', raw: null }), ctx())).toEqual({ kind: 'v-unknown', tag: 'Mystery' })
    expect(toViewTree(def({ kind: 'value-unit', attr: {} }), ctx())).toEqual({ kind: 'v-unit' })
  })
})

describe('patternToText', () => {
  test('formats the pattern zoo', () => {
    expect(patternToText({ kind: 'wildcard' })).toBe('_')
    expect(patternToText({ kind: 'as', inner: { kind: 'wildcard' }, name: ['user', 'id'] })).toBe('userId')
    expect(patternToText({ kind: 'literal-pattern', literal: { kind: 'whole-number', value: 0 } })).toBe('0')
    expect(patternToText({
      kind: 'constructor-pattern',
      fqn: { pkg: [['p']], module: [['m']], local: ['just'] },
      args: [{ kind: 'wildcard' }]
    })).toBe('Just(_)')
    expect(patternToText({ kind: 'pattern-tuple', elements: [{ kind: 'wildcard' }, { kind: 'empty-list' }] })).toBe('(_, [])')
    expect(patternToText({ kind: 'head-tail', head: { kind: 'wildcard' }, tail: { kind: 'wildcard' } })).toBe('_ :: _')
    expect(patternToText({ kind: 'pattern-unit' })).toBe('()')
  })
})
