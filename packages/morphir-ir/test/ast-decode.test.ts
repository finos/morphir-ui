import { describe, expect, test } from 'bun:test'
import { decodeLiteral, decodePattern, decodeTypeExpr, fqNameFromRaw } from '../src/index.ts'

const intRef = ['Reference', {}, [[['morphir'], ['s', 'd', 'k']], [['basics']], ['int']], []]

describe('decodeLiteral', () => {
  test('decodes all six v3 literal tags', () => {
    expect(decodeLiteral(['BoolLiteral', true])).toEqual({ kind: 'bool', value: true })
    expect(decodeLiteral(['CharLiteral', 'x'])).toEqual({ kind: 'char', value: 'x' })
    expect(decodeLiteral(['StringLiteral', 'hi'])).toEqual({ kind: 'string', value: 'hi' })
    expect(decodeLiteral(['WholeNumberLiteral', 42])).toEqual({ kind: 'whole-number', value: 42 })
    expect(decodeLiteral(['FloatLiteral', 2.5])).toEqual({ kind: 'float', value: 2.5 })
    expect(decodeLiteral(['DecimalLiteral', '10.01'])).toEqual({ kind: 'decimal', value: '10.01' })
  })
  test('unknown tag degrades to UnknownNode', () => {
    expect(decodeLiteral(['UuidLiteral', 'x'])).toEqual({ kind: 'unknown', tag: 'UuidLiteral', raw: ['UuidLiteral', 'x'] })
    expect(decodeLiteral(42)).toEqual({ kind: 'unknown', tag: '<malformed>', raw: 42 })
  })
})

describe('decodeTypeExpr', () => {
  test('decodes references with type arguments', () => {
    const listOfInt = ['Reference', {}, [[['morphir'], ['s', 'd', 'k']], [['list']], ['list']], [intRef]]
    const decoded = decodeTypeExpr(listOfInt)
    expect(decoded).toEqual({
      kind: 'type-reference',
      fqn: { pkg: [['morphir'], ['s', 'd', 'k']], module: [['list']], local: ['list'] },
      args: [{ kind: 'type-reference', fqn: { pkg: [['morphir'], ['s', 'd', 'k']], module: [['basics']], local: ['int'] }, args: [] }]
    })
  })
  test('decodes record fields (object form) and functions', () => {
    const rec = ['Record', {}, [{ name: ['age'], tpe: intRef }]]
    expect(decodeTypeExpr(rec)).toEqual({
      kind: 'type-record',
      fields: [{ name: ['age'], tpe: { kind: 'type-reference', fqn: { pkg: [['morphir'], ['s', 'd', 'k']], module: [['basics']], local: ['int'] }, args: [] } }]
    })
    const fn = ['Function', {}, intRef, intRef]
    const dfn = decodeTypeExpr(fn)
    expect(dfn.kind).toBe('type-function')
  })
  test('unit, tuple, variable, extensible record', () => {
    expect(decodeTypeExpr(['Unit', {}])).toEqual({ kind: 'type-unit' })
    expect(decodeTypeExpr(['Variable', {}, ['a']])).toEqual({ kind: 'type-variable', name: ['a'] })
    expect(decodeTypeExpr(['Tuple', {}, [intRef]]).kind).toBe('type-tuple')
    expect(decodeTypeExpr(['ExtensibleRecord', {}, ['r'], []]).kind).toBe('type-extensible-record')
  })
  test('unknown tag degrades', () => {
    expect(decodeTypeExpr(['Weird', {}, 1])).toEqual({ kind: 'unknown', tag: 'Weird', raw: ['Weird', {}, 1] })
  })
})

describe('decodePattern', () => {
  test('decodes all eight v3 pattern tags', () => {
    expect(decodePattern(['WildcardPattern', {}])).toEqual({ kind: 'wildcard' })
    expect(decodePattern(['AsPattern', {}, ['WildcardPattern', {}], ['x']])).toEqual({
      kind: 'as', inner: { kind: 'wildcard' }, name: ['x']
    })
    expect(decodePattern(['TuplePattern', {}, [['WildcardPattern', {}]]]).kind).toBe('pattern-tuple')
    const ctor = decodePattern(['ConstructorPattern', {}, [[['p']], [['m']], ['just']], [['WildcardPattern', {}]]])
    expect(ctor).toEqual({
      kind: 'constructor-pattern',
      fqn: { pkg: [['p']], module: [['m']], local: ['just'] },
      args: [{ kind: 'wildcard' }]
    })
    expect(decodePattern(['EmptyListPattern', {}])).toEqual({ kind: 'empty-list' })
    expect(decodePattern(['HeadTailPattern', {}, ['WildcardPattern', {}], ['EmptyListPattern', {}]]).kind).toBe('head-tail')
    expect(decodePattern(['LiteralPattern', {}, ['WholeNumberLiteral', 0]])).toEqual({
      kind: 'literal-pattern', literal: { kind: 'whole-number', value: 0 }
    })
    expect(decodePattern(['UnitPattern', {}])).toEqual({ kind: 'pattern-unit' })
  })
})

describe('fqNameFromRaw', () => {
  test('parses the 3-tuple and rejects malformed input', () => {
    expect(fqNameFromRaw([[['a']], [['b']], ['c']])).toEqual({ pkg: [['a']], module: [['b']], local: ['c'] })
    expect(fqNameFromRaw(['nope'])).toBeNull()
  })
})
