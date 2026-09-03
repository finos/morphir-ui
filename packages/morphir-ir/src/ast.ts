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

export interface ValueDefInput { readonly name: Name; readonly attr: unknown; readonly tpe: TypeExpr }
export interface ValueDef {
  readonly inputs: readonly ValueDefInput[]
  readonly output: TypeExpr
  readonly body: ValueExpr
}

export type ValueExpr =
  | { readonly kind: 'literal'; readonly attr: unknown; readonly literal: Literal }
  | { readonly kind: 'constructor'; readonly attr: unknown; readonly fqn: FQName }
  | { readonly kind: 'value-tuple'; readonly attr: unknown; readonly elements: readonly ValueExpr[] }
  | { readonly kind: 'value-list'; readonly attr: unknown; readonly items: readonly ValueExpr[] }
  | { readonly kind: 'value-record'; readonly attr: unknown; readonly fields: readonly { readonly name: Name; readonly value: ValueExpr }[] }
  | { readonly kind: 'variable'; readonly attr: unknown; readonly name: Name }
  | { readonly kind: 'value-reference'; readonly attr: unknown; readonly fqn: FQName }
  | { readonly kind: 'field'; readonly attr: unknown; readonly subject: ValueExpr; readonly name: Name }
  | { readonly kind: 'field-function'; readonly attr: unknown; readonly name: Name }
  | { readonly kind: 'apply'; readonly attr: unknown; readonly fn: ValueExpr; readonly arg: ValueExpr }
  | { readonly kind: 'lambda'; readonly attr: unknown; readonly pattern: Pattern; readonly body: ValueExpr }
  | { readonly kind: 'let-definition'; readonly attr: unknown; readonly name: Name; readonly definition: ValueDef; readonly inValue: ValueExpr }
  | { readonly kind: 'let-recursion'; readonly attr: unknown; readonly definitions: readonly { readonly name: Name; readonly definition: ValueDef }[]; readonly inValue: ValueExpr }
  | { readonly kind: 'destructure'; readonly attr: unknown; readonly pattern: Pattern; readonly value: ValueExpr; readonly inValue: ValueExpr }
  | { readonly kind: 'if-then-else'; readonly attr: unknown; readonly condition: ValueExpr; readonly thenBranch: ValueExpr; readonly elseBranch: ValueExpr }
  | { readonly kind: 'pattern-match'; readonly attr: unknown; readonly subject: ValueExpr; readonly cases: readonly { readonly pattern: Pattern; readonly body: ValueExpr }[] }
  | { readonly kind: 'update-record'; readonly attr: unknown; readonly subject: ValueExpr; readonly fields: readonly { readonly name: Name; readonly value: ValueExpr }[] }
  | { readonly kind: 'value-unit'; readonly attr: unknown }
  | UnknownNode

/** Every normalized discriminator that can appear in the decoded Morphir AST. */
export type DecodedNodeKind =
  | ValueExpr['kind']
  | Pattern['kind']
  | TypeExpr['kind']
  | Literal['kind']
