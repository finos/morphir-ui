import { describe, expect, test } from 'bun:test'
import {
  decodeLiteral,
  decodePattern,
  decodeTypeExpr,
  decodeValueExpr,
  fqNameFromRaw,
  type DecodedNodeKind,
  type Literal,
  type Pattern,
  type TypeExpr,
  type ValueExpr
} from '../src/index.ts'

const decodedKind = <Kind extends DecodedNodeKind>(kind: Kind): Kind => kind
type Equal<Left, Right> = [Left] extends [Right] ? ([Right] extends [Left] ? true : false) : false
const decodedNodeKindIsCanonical: Equal<
  DecodedNodeKind,
  ValueExpr['kind'] | Pattern['kind'] | TypeExpr['kind'] | Literal['kind']
> = true

test('exports the normalized decoded node-kind union', () => {
  expect(decodedNodeKindIsCanonical).toBe(true)
  expect(decodedKind('apply')).toBe('apply')
  expect(decodedKind('constructor-pattern')).toBe('constructor-pattern')
  expect(decodedKind('type-extensible-record')).toBe('type-extensible-record')
  expect(decodedKind('decimal')).toBe('decimal')
  expect(decodedKind('unknown')).toBe('unknown')
})

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

describe('decodeTypeExpr reads the decided member spellings first (types-0007)', () => {
  test('Function reads parameterType/returnType, then argumentType, then arg/result', () => {
    const decided = { Function: { parameterType: 'morphir/sdk:basics#int', returnType: 'morphir/sdk:string#string' } }
    const preDecision = { Function: { argumentType: 'morphir/sdk:basics#int', returnType: 'morphir/sdk:string#string' } }
    const rustEncoder = { Function: { arg: 'morphir/sdk:basics#int', result: 'morphir/sdk:string#string' } }
    const expected = decodeTypeExpr(decided)
    expect(expected.kind).toBe('type-function')
    expect(decodeTypeExpr(preDecision)).toEqual(expected)
    expect(decodeTypeExpr(rustEncoder)).toEqual(expected)
  })
})

describe('decodeValueExpr reads the decided member spellings first', () => {
  test('IfThenElse reads then/else, and thenBranch/elseBranch decodes the same node (values-0005)', () => {
    const decided = {
      IfThenElse: { condition: { Literal: { BoolLiteral: true } }, then: { Literal: { IntegerLiteral: 1 } }, else: { Literal: { IntegerLiteral: 2 } } },
    }
    const legacy = {
      IfThenElse: { condition: { Literal: { BoolLiteral: true } }, thenBranch: { Literal: { IntegerLiteral: 1 } }, elseBranch: { Literal: { IntegerLiteral: 2 } } },
    }
    expect(decodeValueExpr(legacy)).toEqual(decodeValueExpr(decided))
    expect(decodeValueExpr(decided).kind).toBe('if-then-else')
  })

  test('Field reads target/name, and subject/fieldName decodes the same node (values-0006)', () => {
    const decided = { Field: { target: { Variable: 'record' }, name: 'field-name' } }
    const legacy = { Field: { subject: { Variable: 'record' }, fieldName: 'field-name' } }
    expect(decodeValueExpr(legacy)).toEqual(decodeValueExpr(decided))
    expect(decodeValueExpr(decided).kind).toBe('field')
  })

  test('LetDefinition reads name/definition/in, and valueName/valueDefinition/inValue decodes the same node (values-0017)', () => {
    const definitionBody = {
      ExpressionBody: {
        inputTypes: {},
        outputType: 'morphir/sdk:basics#int',
        body: { Literal: { IntegerLiteral: 1 } },
      },
    }
    const decided = { LetDefinition: { name: 'x', definition: definitionBody, in: { Variable: 'x' } } }
    const legacy = { LetDefinition: { valueName: 'x', valueDefinition: definitionBody, inValue: { Variable: 'x' } } }
    expect(decodeValueExpr(legacy)).toEqual(decodeValueExpr(decided))
    expect(decodeValueExpr(decided).kind).toBe('let-definition')
  })

  test('attributes/attrs decode to the same attr (decision 0006 window, drops in 0.4.0-alpha.8)', () => {
    const decided = { Variable: { attributes: { source: 1 }, name: 'x' } }
    const legacy = { Variable: { attrs: { source: 1 }, name: 'x' } }
    expect(decodeValueExpr(legacy)).toEqual(decodeValueExpr(decided))
  })
})

describe('fqNameFromRaw', () => {
  test('parses the 3-tuple and rejects malformed input', () => {
    expect(fqNameFromRaw([[['a']], [['b']], ['c']])).toEqual({ pkg: [['a']], module: [['b']], local: ['c'] })
    expect(fqNameFromRaw(['nope'])).toBeNull()
  })
})
