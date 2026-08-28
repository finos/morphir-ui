import type { Name, Path } from './decode.ts'

export interface UnknownNode { readonly kind: 'unknown'; readonly tag: string; readonly raw: unknown }

export interface FQName { readonly pkg: Path; readonly module: Path; readonly local: Name }

export type Literal =
  | { readonly kind: 'bool'; readonly value: boolean }
  | { readonly kind: 'char'; readonly value: string }
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'whole-number'; readonly value: number }
  | { readonly kind: 'float'; readonly value: number }
  | { readonly kind: 'decimal'; readonly value: string }
  | UnknownNode

export type TypeExpr =
  | { readonly kind: 'type-variable'; readonly name: Name }
  | { readonly kind: 'type-reference'; readonly fqn: FQName; readonly args: readonly TypeExpr[] }
  | { readonly kind: 'type-tuple'; readonly elements: readonly TypeExpr[] }
  | { readonly kind: 'type-record'; readonly fields: readonly { readonly name: Name; readonly tpe: TypeExpr }[] }
  | { readonly kind: 'type-extensible-record'; readonly variable: Name; readonly fields: readonly { readonly name: Name; readonly tpe: TypeExpr }[] }
  | { readonly kind: 'type-function'; readonly argument: TypeExpr; readonly result: TypeExpr }
  | { readonly kind: 'type-unit' }
  | UnknownNode

export type Pattern =
  | { readonly kind: 'wildcard' }
  | { readonly kind: 'as'; readonly inner: Pattern; readonly name: Name }
  | { readonly kind: 'pattern-tuple'; readonly elements: readonly Pattern[] }
  | { readonly kind: 'constructor-pattern'; readonly fqn: FQName; readonly args: readonly Pattern[] }
  | { readonly kind: 'empty-list' }
  | { readonly kind: 'head-tail'; readonly head: Pattern; readonly tail: Pattern }
  | { readonly kind: 'literal-pattern'; readonly literal: Literal }
  | { readonly kind: 'pattern-unit' }
  | UnknownNode
