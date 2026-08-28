import type { Name } from './decode.ts'
import type { FQName, Literal, Pattern, TypeExpr, UnknownNode } from './ast.ts'

export const unknown = (raw: unknown): UnknownNode => ({
  kind: 'unknown',
  tag: Array.isArray(raw) && typeof raw[0] === 'string' ? raw[0] : '<malformed>',
  raw
})

const isName = (u: unknown): u is Name => Array.isArray(u) && u.every((p) => typeof p === 'string')
const isPath = (u: unknown): u is Name[] => Array.isArray(u) && u.every(isName)

export const fqNameFromRaw = (u: unknown): FQName | null => {
  if (!Array.isArray(u) || u.length !== 3) return null
  const [pkg, module, local] = u
  if (!isPath(pkg) || !isPath(module) || !isName(local)) return null
  return { pkg, module, local }
}

export const decodeLiteral = (u: unknown): Literal => {
  if (!Array.isArray(u) || typeof u[0] !== 'string') return unknown(u)
  const [tag, value] = u
  switch (tag) {
    case 'BoolLiteral': return typeof value === 'boolean' ? { kind: 'bool', value } : unknown(u)
    case 'CharLiteral': return typeof value === 'string' ? { kind: 'char', value } : unknown(u)
    case 'StringLiteral': return typeof value === 'string' ? { kind: 'string', value } : unknown(u)
    case 'WholeNumberLiteral': return typeof value === 'number' ? { kind: 'whole-number', value } : unknown(u)
    case 'FloatLiteral': return typeof value === 'number' ? { kind: 'float', value } : unknown(u)
    case 'DecimalLiteral': return typeof value === 'string' ? { kind: 'decimal', value } : unknown(u)
    default: return unknown(u)
  }
}

const decodeTypeFields = (u: unknown): { name: Name; tpe: TypeExpr }[] | null => {
  if (!Array.isArray(u)) return null
  const fields: { name: Name; tpe: TypeExpr }[] = []
  for (const f of u) {
    if (typeof f !== 'object' || f === null) return null
    const { name, tpe } = f as { name?: unknown; tpe?: unknown }
    if (!isName(name)) return null
    fields.push({ name, tpe: decodeTypeExpr(tpe) })
  }
  return fields
}

export const decodeTypeExpr = (u: unknown): TypeExpr => {
  if (!Array.isArray(u) || typeof u[0] !== 'string') return unknown(u)
  const tag = u[0]
  switch (tag) {
    case 'Variable': return isName(u[2]) ? { kind: 'type-variable', name: u[2] } : unknown(u)
    case 'Reference': {
      const fqn = fqNameFromRaw(u[2])
      if (!fqn || !Array.isArray(u[3])) return unknown(u)
      return { kind: 'type-reference', fqn, args: u[3].map(decodeTypeExpr) }
    }
    case 'Tuple': return Array.isArray(u[2]) ? { kind: 'type-tuple', elements: u[2].map(decodeTypeExpr) } : unknown(u)
    case 'Record': {
      const fields = decodeTypeFields(u[2])
      return fields ? { kind: 'type-record', fields } : unknown(u)
    }
    case 'ExtensibleRecord': {
      const fields = decodeTypeFields(u[3])
      return isName(u[2]) && fields ? { kind: 'type-extensible-record', variable: u[2], fields } : unknown(u)
    }
    case 'Function': return { kind: 'type-function', argument: decodeTypeExpr(u[2]), result: decodeTypeExpr(u[3]) }
    case 'Unit': return { kind: 'type-unit' }
    default: return unknown(u)
  }
}

export const decodePattern = (u: unknown): Pattern => {
  if (!Array.isArray(u) || typeof u[0] !== 'string') return unknown(u)
  const tag = u[0]
  switch (tag) {
    case 'WildcardPattern': return { kind: 'wildcard' }
    case 'AsPattern': return isName(u[3]) ? { kind: 'as', inner: decodePattern(u[2]), name: u[3] } : unknown(u)
    case 'TuplePattern': return Array.isArray(u[2]) ? { kind: 'pattern-tuple', elements: u[2].map(decodePattern) } : unknown(u)
    case 'ConstructorPattern': {
      const fqn = fqNameFromRaw(u[2])
      if (!fqn || !Array.isArray(u[3])) return unknown(u)
      return { kind: 'constructor-pattern', fqn, args: u[3].map(decodePattern) }
    }
    case 'EmptyListPattern': return { kind: 'empty-list' }
    case 'HeadTailPattern': return { kind: 'head-tail', head: decodePattern(u[2]), tail: decodePattern(u[3]) }
    case 'LiteralPattern': return { kind: 'literal-pattern', literal: decodeLiteral(u[2]) }
    case 'UnitPattern': return { kind: 'pattern-unit' }
    default: return unknown(u)
  }
}
