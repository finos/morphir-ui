import type { FQName, Literal } from '@morphir/ir'

export type ViewCell =
  | { readonly kind: 'cell-pattern'; readonly text: string }
  | { readonly kind: 'cell-wildcard' }
  | { readonly kind: 'cell-missing' }
  | { readonly kind: 'cell-unsupported'; readonly patternKind: string }

export type ViewNode =
  | { readonly kind: 'v-literal'; readonly text: string; readonly literalKind: Literal['kind'] }
  | { readonly kind: 'v-variable'; readonly name: string }
  | { readonly kind: 'v-record'; readonly fields: readonly { readonly name: string; readonly value: ViewNode }[] }
  | { readonly kind: 'v-update-record'; readonly subject: ViewNode; readonly fields: readonly { readonly name: string; readonly value: ViewNode }[] }
  | { readonly kind: 'v-list'; readonly items: readonly ViewNode[] }
  | { readonly kind: 'v-tuple'; readonly elements: readonly ViewNode[] }
  | { readonly kind: 'v-field-access'; readonly subject: ViewNode; readonly field: string }
  | { readonly kind: 'v-constructor'; readonly name: string; readonly args: readonly ViewNode[] }
  | { readonly kind: 'v-arith-chain'; readonly op: '+' | '-' | '*'; readonly items: readonly { readonly node: ViewNode; readonly grouped: boolean }[] }
  | { readonly kind: 'v-fraction'; readonly numerator: ViewNode; readonly denominator: ViewNode }
  | { readonly kind: 'v-logic-chain'; readonly op: 'AND' | 'OR'; readonly items: readonly ViewNode[] }
  | { readonly kind: 'v-binary-op'; readonly symbol: string; readonly left: ViewNode; readonly right: ViewNode }
  | { readonly kind: 'v-prefix-call'; readonly label: string; readonly args: readonly ViewNode[] }
  | { readonly kind: 'v-power'; readonly base: ViewNode; readonly exponent: ViewNode }
  | { readonly kind: 'v-member-of'; readonly item: ViewNode; readonly options: readonly ViewNode[] }
  | { readonly kind: 'v-pipeline'; readonly input: ViewNode; readonly stages: readonly { readonly label: string; readonly arg: ViewNode }[] }
  | { readonly kind: 'v-if-tree'; readonly branches: readonly { readonly condition: ViewNode; readonly thenLabel: string; readonly elseLabel: string; readonly result: ViewNode }[]; readonly fallback: ViewNode }
  | { readonly kind: 'v-decision-table'; readonly columns: readonly ViewNode[]; readonly rows: readonly { readonly cells: readonly ViewCell[]; readonly result: ViewNode }[] }
  | { readonly kind: 'v-lambda'; readonly pattern: string; readonly body: ViewNode }
  | { readonly kind: 'v-let-group'; readonly bindings: readonly { readonly name: string; readonly value: ViewNode }[]; readonly body: ViewNode }
  | { readonly kind: 'v-reference'; readonly fqn: FQName; readonly display: string; readonly expandable: boolean; readonly args: readonly ViewNode[]; readonly expanded?: ViewNode; readonly cycle?: boolean }
  | { readonly kind: 'v-unit' }
  | { readonly kind: 'v-unknown'; readonly tag: string }
