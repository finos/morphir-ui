import type { Name } from './decode.ts'
import type {
  FQName,
  Literal,
  Pattern,
  TypeExpr,
  UnknownNode,
  ValueDef,
  ValueDefInput,
  ValueExpr,
} from './ast.ts'
import { nameFromCanonical, pathFromCanonical } from './names.ts'

export const unknown = (raw: unknown): UnknownNode => ({
  kind: 'unknown',
  tag:
    Array.isArray(raw) && typeof raw[0] === 'string'
      ? raw[0]
      : typeof raw === 'object' && raw !== null && Object.keys(raw).length === 1
        ? Object.keys(raw)[0]!
        : '<malformed>',
  raw,
})

const isRecord = (u: unknown): u is Record<string, unknown> => typeof u === 'object' && u !== null

const fqNameFromCanonical = (u: unknown): FQName | null => {
  if (typeof u !== 'string') return null
  const colon = u.indexOf(':')
  const hash = u.indexOf('#', colon + 1)
  if (colon <= 0 || hash <= colon + 1 || hash === u.length - 1) return null
  const pkg = pathFromCanonical(u.slice(0, colon))
  const module = pathFromCanonical(u.slice(colon + 1, hash))
  const local = nameFromCanonical(u.slice(hash + 1))
  return pkg && module && local ? { pkg, module, local } : null
}

const isName = (u: unknown): u is Name => Array.isArray(u) && u.every((p) => typeof p === 'string')
const isPath = (u: unknown): u is Name[] => Array.isArray(u) && u.every(isName)

export const fqNameFromRaw = (u: unknown): FQName | null => {
  if (!Array.isArray(u) || u.length !== 3) return null
  const [pkg, module, local] = u
  if (!isPath(pkg) || !isPath(module) || !isName(local)) return null
  return { pkg, module, local }
}

export const decodeLiteral = (u: unknown): Literal => {
  if (isRecord(u) && Object.keys(u).length === 1) {
    const [tag, rawContent] = Object.entries(u)[0]!
    const content = isRecord(rawContent) && 'value' in rawContent ? rawContent['value'] : rawContent
    switch (tag) {
      case 'BoolLiteral':
        return typeof content === 'boolean' ? { kind: 'bool', value: content } : unknown(u)
      case 'CharLiteral':
        return typeof content === 'string' ? { kind: 'char', value: content } : unknown(u)
      case 'StringLiteral':
        return typeof content === 'string' ? { kind: 'string', value: content } : unknown(u)
      case 'IntegerLiteral':
      case 'WholeNumberLiteral':
        return typeof content === 'number' ? { kind: 'whole-number', value: content } : unknown(u)
      case 'FloatLiteral':
        return typeof content === 'number' ? { kind: 'float', value: content } : unknown(u)
      case 'DecimalLiteral':
        return typeof content === 'string' ? { kind: 'decimal', value: content } : unknown(u)
      default:
        return unknown(u)
    }
  }
  if (!Array.isArray(u) || typeof u[0] !== 'string') return unknown(u)
  const [tag, value] = u
  switch (tag) {
    case 'BoolLiteral':
      return typeof value === 'boolean' ? { kind: 'bool', value } : unknown(u)
    case 'CharLiteral':
      return typeof value === 'string' ? { kind: 'char', value } : unknown(u)
    case 'StringLiteral':
      return typeof value === 'string' ? { kind: 'string', value } : unknown(u)
    case 'WholeNumberLiteral':
      return typeof value === 'number' ? { kind: 'whole-number', value } : unknown(u)
    case 'FloatLiteral':
      return typeof value === 'number' ? { kind: 'float', value } : unknown(u)
    case 'DecimalLiteral':
      return typeof value === 'string' ? { kind: 'decimal', value } : unknown(u)
    default:
      return unknown(u)
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
  if (typeof u === 'string') {
    const fqn = fqNameFromCanonical(u)
    if (fqn) return { kind: 'type-reference', fqn, args: [] }
    const name = nameFromCanonical(u)
    return name ? { kind: 'type-variable', name } : unknown(u)
  }
  if (isRecord(u) && Object.keys(u).length === 1) {
    const [tag, content] = Object.entries(u)[0]!
    switch (tag) {
      case 'Variable': {
        const name = nameFromCanonical(isRecord(content) ? content['name'] : content)
        return name ? { kind: 'type-variable', name } : unknown(u)
      }
      case 'Reference': {
        const fqname = Array.isArray(content)
          ? content[0]
          : isRecord(content)
            ? content['fqname']
            : content
        const args = Array.isArray(content)
          ? content.slice(1)
          : isRecord(content) && Array.isArray(content['args'])
            ? content['args']
            : []
        const fqn = fqNameFromCanonical(fqname)
        return fqn ? { kind: 'type-reference', fqn, args: args.map(decodeTypeExpr) } : unknown(u)
      }
      case 'Tuple': {
        const elements = Array.isArray(content)
          ? content
          : isRecord(content) && Array.isArray(content['elements'])
            ? content['elements']
            : null
        return elements
          ? { kind: 'type-tuple', elements: elements.map(decodeTypeExpr) }
          : unknown(u)
      }
      case 'Function':
        return isRecord(content)
          ? {
              kind: 'type-function',
              argument: decodeTypeExpr(content['argumentType']),
              result: decodeTypeExpr(content['returnType']),
            }
          : unknown(u)
      case 'Unit':
        return { kind: 'type-unit' }
      default:
        return unknown(u)
    }
  }
  if (!Array.isArray(u) || typeof u[0] !== 'string') return unknown(u)
  const tag = u[0]
  switch (tag) {
    case 'Variable':
      return isName(u[2]) ? { kind: 'type-variable', name: u[2] } : unknown(u)
    case 'Reference': {
      const fqn = fqNameFromRaw(u[2])
      if (!fqn || !Array.isArray(u[3])) return unknown(u)
      return { kind: 'type-reference', fqn, args: u[3].map(decodeTypeExpr) }
    }
    case 'Tuple':
      return Array.isArray(u[2])
        ? { kind: 'type-tuple', elements: u[2].map(decodeTypeExpr) }
        : unknown(u)
    case 'Record': {
      const fields = decodeTypeFields(u[2])
      return fields ? { kind: 'type-record', fields } : unknown(u)
    }
    case 'ExtensibleRecord': {
      const fields = decodeTypeFields(u[3])
      return isName(u[2]) && fields
        ? { kind: 'type-extensible-record', variable: u[2], fields }
        : unknown(u)
    }
    case 'Function':
      return { kind: 'type-function', argument: decodeTypeExpr(u[2]), result: decodeTypeExpr(u[3]) }
    case 'Unit':
      return { kind: 'type-unit' }
    default:
      return unknown(u)
  }
}

export const decodePattern = (u: unknown): Pattern => {
  if (!Array.isArray(u) || typeof u[0] !== 'string') return unknown(u)
  const tag = u[0]
  switch (tag) {
    case 'WildcardPattern':
      return { kind: 'wildcard' }
    case 'AsPattern':
      return isName(u[3]) ? { kind: 'as', inner: decodePattern(u[2]), name: u[3] } : unknown(u)
    case 'TuplePattern':
      return Array.isArray(u[2])
        ? { kind: 'pattern-tuple', elements: u[2].map(decodePattern) }
        : unknown(u)
    case 'ConstructorPattern': {
      const fqn = fqNameFromRaw(u[2])
      if (!fqn || !Array.isArray(u[3])) return unknown(u)
      return { kind: 'constructor-pattern', fqn, args: u[3].map(decodePattern) }
    }
    case 'EmptyListPattern':
      return { kind: 'empty-list' }
    case 'HeadTailPattern':
      return { kind: 'head-tail', head: decodePattern(u[2]), tail: decodePattern(u[3]) }
    case 'LiteralPattern':
      return { kind: 'literal-pattern', literal: decodeLiteral(u[2]) }
    case 'UnitPattern':
      return { kind: 'pattern-unit' }
    default:
      return unknown(u)
  }
}

const namedPairs = <T>(
  u: unknown,
  decodeSecond: (x: unknown) => T,
): { name: Name; value: T }[] | null => {
  if (!Array.isArray(u)) return null
  const out: { name: Name; value: T }[] = []
  for (const p of u) {
    if (!Array.isArray(p) || p.length !== 2 || !isName(p[0])) return null
    out.push({ name: p[0], value: decodeSecond(p[1]) })
  }
  return out
}

export const decodeValueDef = (u: unknown): ValueDef | null => {
  if (typeof u !== 'object' || u === null) return null
  if (isRecord(u) && isRecord(u['ExpressionBody'])) {
    const expression = u['ExpressionBody']
    const inputTypes = expression['inputTypes']
    if (!isRecord(inputTypes)) return null
    const inputs: ValueDefInput[] = []
    for (const [canonicalName, rawEntry] of Object.entries(inputTypes)) {
      const name = nameFromCanonical(canonicalName)
      if (!name) return null
      const entry = isRecord(rawEntry) && 'type' in rawEntry ? rawEntry : null
      inputs.push({
        name,
        attr: entry?.['typeAttributes'] ?? {},
        tpe: decodeTypeExpr(entry?.['type'] ?? rawEntry),
      })
    }
    return {
      inputs,
      output: decodeTypeExpr(expression['outputType']),
      body: decodeValueExpr(expression['body']),
    }
  }
  const { inputTypes, outputType, body } = u as {
    inputTypes?: unknown
    outputType?: unknown
    body?: unknown
  }
  if (!Array.isArray(inputTypes)) return null
  const inputs: ValueDefInput[] = []
  for (const row of inputTypes) {
    if (!Array.isArray(row) || row.length !== 3 || !isName(row[0])) return null
    inputs.push({ name: row[0], attr: row[1], tpe: decodeTypeExpr(row[2]) })
  }
  return { inputs, output: decodeTypeExpr(outputType), body: decodeValueExpr(body) }
}

export const decodeValueExpr = (u: unknown): ValueExpr => {
  if (isRecord(u) && Object.keys(u).length === 1) {
    const [tag, content] = Object.entries(u)[0]!
    if (!isRecord(content)) return unknown(u)
    const attr = content['attrs'] ?? {}
    switch (tag) {
      case 'Literal':
        return { kind: 'literal', attr, literal: decodeLiteral(content['literal']) }
      case 'Constructor': {
        const fqn = fqNameFromCanonical(content['fqname'])
        return fqn ? { kind: 'constructor', attr, fqn } : unknown(u)
      }
      case 'Apply':
        return {
          kind: 'apply',
          attr,
          fn: decodeValueExpr(content['function']),
          arg: decodeValueExpr(content['argument']),
        }
      case 'Tuple':
        return Array.isArray(content['elements'])
          ? { kind: 'value-tuple', attr, elements: content['elements'].map(decodeValueExpr) }
          : unknown(u)
      case 'List':
        return Array.isArray(content['items'])
          ? { kind: 'value-list', attr, items: content['items'].map(decodeValueExpr) }
          : unknown(u)
      case 'Variable': {
        const name = nameFromCanonical(content['name'])
        return name ? { kind: 'variable', attr, name } : unknown(u)
      }
      case 'Reference': {
        const fqn = fqNameFromCanonical(content['fqname'])
        return fqn ? { kind: 'value-reference', attr, fqn } : unknown(u)
      }
      case 'Unit':
        return { kind: 'value-unit', attr }
      default:
        return unknown(u)
    }
  }
  if (!Array.isArray(u) || typeof u[0] !== 'string') return unknown(u)
  const tag = u[0]
  const attr = u[1]
  switch (tag) {
    case 'Literal':
      return { kind: 'literal', attr, literal: decodeLiteral(u[2]) }
    case 'Constructor': {
      const fqn = fqNameFromRaw(u[2])
      return fqn ? { kind: 'constructor', attr, fqn } : unknown(u)
    }
    case 'Tuple':
      return Array.isArray(u[2])
        ? { kind: 'value-tuple', attr, elements: u[2].map(decodeValueExpr) }
        : unknown(u)
    case 'List':
      return Array.isArray(u[2])
        ? { kind: 'value-list', attr, items: u[2].map(decodeValueExpr) }
        : unknown(u)
    case 'Record': {
      const fields = namedPairs(u[2], decodeValueExpr)
      return fields ? { kind: 'value-record', attr, fields } : unknown(u)
    }
    case 'Variable':
      return isName(u[2]) ? { kind: 'variable', attr, name: u[2] } : unknown(u)
    case 'Reference': {
      const fqn = fqNameFromRaw(u[2])
      return fqn ? { kind: 'value-reference', attr, fqn } : unknown(u)
    }
    case 'Field':
      return isName(u[3])
        ? { kind: 'field', attr, subject: decodeValueExpr(u[2]), name: u[3] }
        : unknown(u)
    case 'FieldFunction':
      return isName(u[2]) ? { kind: 'field-function', attr, name: u[2] } : unknown(u)
    case 'Apply':
      return { kind: 'apply', attr, fn: decodeValueExpr(u[2]), arg: decodeValueExpr(u[3]) }
    case 'Lambda':
      return { kind: 'lambda', attr, pattern: decodePattern(u[2]), body: decodeValueExpr(u[3]) }
    case 'LetDefinition': {
      const definition = decodeValueDef(u[3])
      return isName(u[2]) && definition
        ? { kind: 'let-definition', attr, name: u[2], definition, inValue: decodeValueExpr(u[4]) }
        : unknown(u)
    }
    case 'LetRecursion': {
      if (!Array.isArray(u[2])) return unknown(u)
      const definitions: { name: Name; definition: ValueDef }[] = []
      for (const p of u[2]) {
        if (!Array.isArray(p) || !isName(p[0])) return unknown(u)
        const definition = decodeValueDef(p[1])
        if (!definition) return unknown(u)
        definitions.push({ name: p[0], definition })
      }
      return { kind: 'let-recursion', attr, definitions, inValue: decodeValueExpr(u[3]) }
    }
    case 'Destructure':
      return {
        kind: 'destructure',
        attr,
        pattern: decodePattern(u[2]),
        value: decodeValueExpr(u[3]),
        inValue: decodeValueExpr(u[4]),
      }
    case 'IfThenElse':
      return {
        kind: 'if-then-else',
        attr,
        condition: decodeValueExpr(u[2]),
        thenBranch: decodeValueExpr(u[3]),
        elseBranch: decodeValueExpr(u[4]),
      }
    case 'PatternMatch': {
      if (!Array.isArray(u[3])) return unknown(u)
      const cases = u[3].map((p: unknown) =>
        Array.isArray(p) && p.length === 2
          ? { pattern: decodePattern(p[0]), body: decodeValueExpr(p[1]) }
          : { pattern: decodePattern(undefined), body: decodeValueExpr(p) },
      )
      return { kind: 'pattern-match', attr, subject: decodeValueExpr(u[2]), cases }
    }
    case 'UpdateRecord': {
      const fields = namedPairs(u[3], decodeValueExpr)
      return fields
        ? { kind: 'update-record', attr, subject: decodeValueExpr(u[2]), fields }
        : unknown(u)
    }
    case 'Unit':
      return { kind: 'value-unit', attr }
    default:
      return unknown(u)
  }
}

export const uncurryApply = (expr: ValueExpr): { fn: ValueExpr; args: ValueExpr[] } => {
  const args: ValueExpr[] = []
  let current = expr
  while (current.kind === 'apply') {
    args.unshift(current.arg)
    current = current.fn
  }
  return { fn: current, args }
}

export const decodeEntryValueDef = (entry: { rawDefinition: unknown }): ValueDef | null =>
  decodeValueDef(entry.rawDefinition)
