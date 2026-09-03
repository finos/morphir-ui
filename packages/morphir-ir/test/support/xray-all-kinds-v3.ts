import type { DecodedNodeKind } from '../../src/index.ts'

export const expectedDecodedNodeKinds = [
  'literal',
  'constructor',
  'value-tuple',
  'value-list',
  'value-record',
  'variable',
  'value-reference',
  'field',
  'field-function',
  'apply',
  'lambda',
  'let-definition',
  'let-recursion',
  'destructure',
  'if-then-else',
  'pattern-match',
  'update-record',
  'value-unit',
  'wildcard',
  'as',
  'pattern-tuple',
  'constructor-pattern',
  'empty-list',
  'head-tail',
  'literal-pattern',
  'pattern-unit',
  'type-variable',
  'type-reference',
  'type-tuple',
  'type-record',
  'type-extensible-record',
  'type-function',
  'type-unit',
  'bool',
  'char',
  'string',
  'whole-number',
  'float',
  'decimal',
  'unknown',
] as const satisfies readonly DecodedNodeKind[]

type AssertNever<T extends never> = T
export type ExpectedDecodedKindsIncludeEveryDecodedKind = AssertNever<
  Exclude<DecodedNodeKind, (typeof expectedDecodedNodeKinds)[number]>
>
export type EveryExpectedDecodedKindIsDecoded = AssertNever<
  Exclude<(typeof expectedDecodedNodeKinds)[number], DecodedNodeKind>
>

const fqn = (local: string) => [[['morphir'], ['s', 'd', 'k']], [['basics']], [local]]
const attr = {}
const unitType = ['Unit', attr]
const typeSamples = [
  ['variable', ['Variable', attr, ['a']]],
  ['reference', ['Reference', attr, fqn('int'), []]],
  [
    'tuple',
    [
      'Tuple',
      attr,
      [
        ['Variable', attr, ['a']],
        ['Reference', attr, fqn('string'), []],
      ],
    ],
  ],
  ['record', ['Record', attr, [{ name: ['field'], tpe: ['Reference', attr, fqn('int'), []] }]]],
  [
    'extensibleRecord',
    [
      'ExtensibleRecord',
      attr,
      ['row'],
      [{ name: ['field'], tpe: ['Reference', attr, fqn('int'), []] }],
    ],
  ],
  ['function', ['Function', attr, ['Variable', attr, ['a']], ['Reference', attr, fqn('int'), []]]],
  ['unit', unitType],
] as const

const literal = (tag: string, value: boolean | number | string) => ['Literal', attr, [tag, value]]
const unit = () => ['Unit', attr]
const valueDefinition = (body: unknown) => ({ inputTypes: [], outputType: unitType, body })

const patternSamples = [
  ['WildcardPattern', attr],
  ['AsPattern', attr, ['WildcardPattern', attr], ['bound']],
  [
    'TuplePattern',
    attr,
    [
      ['WildcardPattern', attr],
      ['UnitPattern', attr],
    ],
  ],
  ['ConstructorPattern', attr, fqn('just'), [['WildcardPattern', attr]]],
  ['EmptyListPattern', attr],
  ['HeadTailPattern', attr, ['WildcardPattern', attr], ['EmptyListPattern', attr]],
  ['LiteralPattern', attr, ['WholeNumberLiteral', 1]],
  ['UnitPattern', attr],
] as const

const allNodesBody = [
  'List',
  attr,
  [
    literal('BoolLiteral', true),
    literal('CharLiteral', 'x'),
    literal('StringLiteral', 'Morphir'),
    literal('WholeNumberLiteral', 42),
    literal('FloatLiteral', 2.5),
    literal('DecimalLiteral', '10.01'),
    ['Constructor', attr, fqn('just')],
    ['Tuple', attr, [literal('StringLiteral', 'tuple')]],
    ['Record', attr, [[['field'], literal('WholeNumberLiteral', 1)]]],
    ['Variable', attr, ['value']],
    ['Reference', attr, fqn('referenced')],
    ['Field', attr, ['Variable', attr, ['record']], ['field']],
    ['FieldFunction', attr, ['field']],
    ['Apply', attr, ['FieldFunction', attr, ['field']], literal('StringLiteral', 'argument')],
    ['Lambda', attr, ['WildcardPattern', attr], unit()],
    ['LetDefinition', attr, ['bound'], valueDefinition(unit()), unit()],
    ['LetRecursion', attr, [[['recursive'], valueDefinition(unit())]], unit()],
    ['Destructure', attr, ['TuplePattern', attr, [['WildcardPattern', attr]]], unit(), unit()],
    ['IfThenElse', attr, literal('BoolLiteral', true), unit(), unit()],
    ['PatternMatch', attr, unit(), patternSamples.map((pattern) => [pattern, unit()])],
    ['UpdateRecord', attr, ['Variable', attr, ['record']], [[['field'], unit()]]],
    unit(),
    ['FutureExpression', attr, { feature: 'unrecognized' }],
  ],
] as const

export const xrayAllKindsV3 = {
  formatVersion: 3,
  distribution: [
    'Library',
    [['morphir'], ['ui'], ['fixtures']],
    [],
    {
      modules: [
        [
          [['x', 'ray'], ['coverage']],
          {
            access: 'Public',
            value: {
              types: [],
              values: [
                [
                  ['all', 'nodes'],
                  {
                    access: 'Public',
                    value: {
                      doc: '',
                      value: {
                        inputTypes: typeSamples.map(([label, type]) => [[label], {}, type]),
                        outputType: unitType,
                        body: allNodesBody,
                      },
                    },
                  },
                ],
              ],
            },
          },
        ],
      ],
    },
  ],
} as const
