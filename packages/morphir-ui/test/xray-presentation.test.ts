import { describe, expect, test } from 'vitest'
import type { DecodedNodeKind } from '@morphir/ir'
import { expectedDecodedNodeKinds } from '../../morphir-ir/test/support/xray-all-kinds-v3.ts'
import {
  XRAY_NODE_PRESENTATIONS,
  xrayKindPresentation,
  type XRayKindFamily,
  type XRayPaletteRole,
} from '../src/views/insight/xray-presentation.ts'

const expectedFamilyByKind = {
  apply: 'call',
  variable: 'reference',
  'value-reference': 'reference',
  field: 'reference',
  'field-function': 'reference',
  constructor: 'constructor',
  'value-tuple': 'collection',
  'value-list': 'collection',
  'value-record': 'collection',
  'update-record': 'collection',
  lambda: 'binding',
  'let-definition': 'binding',
  'let-recursion': 'binding',
  destructure: 'binding',
  'if-then-else': 'control',
  'pattern-match': 'control',
  wildcard: 'pattern',
  as: 'pattern',
  'pattern-tuple': 'pattern',
  'constructor-pattern': 'pattern',
  'empty-list': 'pattern',
  'head-tail': 'pattern',
  'literal-pattern': 'pattern',
  'pattern-unit': 'pattern',
  'type-variable': 'type',
  'type-reference': 'type',
  'type-tuple': 'type',
  'type-record': 'type',
  'type-extensible-record': 'type',
  'type-function': 'type',
  'type-unit': 'type',
  literal: 'literal',
  bool: 'literal',
  char: 'literal',
  string: 'literal',
  'whole-number': 'literal',
  float: 'literal',
  decimal: 'literal',
  'value-unit': 'unit',
  unknown: 'unknown',
} satisfies Record<DecodedNodeKind, XRayKindFamily>

const palettesByFamily = {
  call: 'violet',
  reference: 'blue',
  constructor: 'green',
  collection: 'blue',
  binding: 'amber',
  control: 'magenta',
  pattern: 'rose',
  type: 'amber',
  literal: 'green',
  unit: 'neutral',
  unknown: 'red',
} as const satisfies Record<XRayKindFamily, XRayPaletteRole>

type Equal<Actual, Expected> =
  (<Value>() => Value extends Actual ? 1 : 2) extends <Value>() => Value extends Expected ? 1 : 2
    ? true
    : false
type Assert<Value extends true> = Value
type ApplyPresentationIsReadonly = Assert<
  Equal<
    (typeof XRAY_NODE_PRESENTATIONS)['apply'],
    Readonly<{ label: 'apply'; family: 'call'; palette: 'violet' }>
  >
>

const _readonlyCatalogEntry: ApplyPresentationIsReadonly | undefined = undefined
void _readonlyCatalogEntry

describe('XRay node presentations', () => {
  test('catalogs every decoded fixture kind', () => {
    expect(Object.keys(XRAY_NODE_PRESENTATIONS).sort()).toEqual(
      [...expectedDecodedNodeKinds].sort(),
    )
  })

  test('assigns every decoded kind its raw label, approved family, and palette', () => {
    for (const kind of expectedDecodedNodeKinds) {
      const family = expectedFamilyByKind[kind]
      expect(XRAY_NODE_PRESENTATIONS[kind]).toEqual({
        label: kind,
        family,
        palette: palettesByFamily[family],
      })
    }
  })

  test('presents unfamiliar kinds as red unrecognized nodes', () => {
    expect(xrayKindPresentation('future-node')).toEqual({
      label: 'future-node',
      family: 'unrecognized',
      palette: 'red',
    })
  })
})
