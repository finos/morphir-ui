import type { DecodedNodeKind } from '@morphir/ir'

export type XRayKindFamily =
  | 'call'
  | 'reference'
  | 'constructor'
  | 'collection'
  | 'binding'
  | 'control'
  | 'pattern'
  | 'type'
  | 'literal'
  | 'unit'
  | 'unknown'

export type XRayPaletteRole =
  'violet' | 'blue' | 'green' | 'amber' | 'magenta' | 'rose' | 'neutral' | 'red'

export interface XRayNodePresentation {
  readonly label: string
  readonly family: XRayKindFamily | 'unrecognized'
  readonly palette: XRayPaletteRole
}

export const XRAY_NODE_PRESENTATIONS = {
  apply: { label: 'apply', family: 'call', palette: 'violet' },
  variable: { label: 'variable', family: 'reference', palette: 'blue' },
  'value-reference': { label: 'value-reference', family: 'reference', palette: 'blue' },
  field: { label: 'field', family: 'reference', palette: 'blue' },
  'field-function': { label: 'field-function', family: 'reference', palette: 'blue' },
  constructor: { label: 'constructor', family: 'constructor', palette: 'green' },
  'value-tuple': { label: 'value-tuple', family: 'collection', palette: 'blue' },
  'value-list': { label: 'value-list', family: 'collection', palette: 'blue' },
  'value-record': { label: 'value-record', family: 'collection', palette: 'blue' },
  'update-record': { label: 'update-record', family: 'collection', palette: 'blue' },
  lambda: { label: 'lambda', family: 'binding', palette: 'amber' },
  'let-definition': { label: 'let-definition', family: 'binding', palette: 'amber' },
  'let-recursion': { label: 'let-recursion', family: 'binding', palette: 'amber' },
  destructure: { label: 'destructure', family: 'binding', palette: 'amber' },
  'if-then-else': { label: 'if-then-else', family: 'control', palette: 'magenta' },
  'pattern-match': { label: 'pattern-match', family: 'control', palette: 'magenta' },
  wildcard: { label: 'wildcard', family: 'pattern', palette: 'rose' },
  as: { label: 'as', family: 'pattern', palette: 'rose' },
  'pattern-tuple': { label: 'pattern-tuple', family: 'pattern', palette: 'rose' },
  'constructor-pattern': { label: 'constructor-pattern', family: 'pattern', palette: 'rose' },
  'empty-list': { label: 'empty-list', family: 'pattern', palette: 'rose' },
  'head-tail': { label: 'head-tail', family: 'pattern', palette: 'rose' },
  'literal-pattern': { label: 'literal-pattern', family: 'pattern', palette: 'rose' },
  'pattern-unit': { label: 'pattern-unit', family: 'pattern', palette: 'rose' },
  'type-variable': { label: 'type-variable', family: 'type', palette: 'amber' },
  'type-reference': { label: 'type-reference', family: 'type', palette: 'amber' },
  'type-tuple': { label: 'type-tuple', family: 'type', palette: 'amber' },
  'type-record': { label: 'type-record', family: 'type', palette: 'amber' },
  'type-extensible-record': {
    label: 'type-extensible-record',
    family: 'type',
    palette: 'amber',
  },
  'type-function': { label: 'type-function', family: 'type', palette: 'amber' },
  'type-unit': { label: 'type-unit', family: 'type', palette: 'amber' },
  literal: { label: 'literal', family: 'literal', palette: 'green' },
  bool: { label: 'bool', family: 'literal', palette: 'green' },
  char: { label: 'char', family: 'literal', palette: 'green' },
  string: { label: 'string', family: 'literal', palette: 'green' },
  'whole-number': { label: 'whole-number', family: 'literal', palette: 'green' },
  float: { label: 'float', family: 'literal', palette: 'green' },
  decimal: { label: 'decimal', family: 'literal', palette: 'green' },
  'value-unit': { label: 'value-unit', family: 'unit', palette: 'neutral' },
  unknown: { label: 'unknown', family: 'unknown', palette: 'red' },
} as const satisfies Record<DecodedNodeKind, XRayNodePresentation>

const isKnownXRayKind = (kind: string): kind is keyof typeof XRAY_NODE_PRESENTATIONS =>
  Object.prototype.hasOwnProperty.call(XRAY_NODE_PRESENTATIONS, kind)

export const xrayKindPresentation = (kind: string): XRayNodePresentation =>
  isKnownXRayKind(kind)
    ? XRAY_NODE_PRESENTATIONS[kind]
    : { label: kind, family: 'unrecognized', palette: 'red' }
