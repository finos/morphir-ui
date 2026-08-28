import { nameToCamel, nameToTitle, type Literal, type Pattern, type TypeExpr } from '@morphir/ir'

export const literalText = (l: Literal): string => {
  switch (l.kind) {
    case 'bool': return l.value ? 'True' : 'False'
    case 'char': return `'${l.value}'`
    case 'string': return `"${l.value}"`
    case 'whole-number': return String(l.value)
    case 'float': return String(l.value)
    case 'decimal': return l.value
    case 'unknown': return `?${l.tag}`
  }
}

/** Compact type formatter for signature lines: references → local Title name with args in
 * angle brackets, functions → `a → b`, tuples/records structurally. */
export const typeText = (t: TypeExpr): string => {
  switch (t.kind) {
    case 'type-variable': return nameToCamel(t.name)
    case 'type-reference':
      return t.args.length === 0 ? nameToTitle(t.fqn.local) : `${nameToTitle(t.fqn.local)}<${t.args.map(typeText).join(', ')}>`
    case 'type-tuple': return `(${t.elements.map(typeText).join(', ')})`
    case 'type-record': return `{ ${t.fields.map((f) => `${nameToCamel(f.name)} : ${typeText(f.tpe)}`).join(', ')} }`
    case 'type-extensible-record':
      return `{ ${nameToCamel(t.variable)} | ${t.fields.map((f) => `${nameToCamel(f.name)} : ${typeText(f.tpe)}`).join(', ')} }`
    case 'type-function': return `${typeText(t.argument)} → ${typeText(t.result)}`
    case 'type-unit': return '()'
    case 'unknown': return `?${t.tag}`
  }
}

export const patternToText = (p: Pattern): string => {
  switch (p.kind) {
    case 'wildcard': return '_'
    case 'as': return p.inner.kind === 'wildcard' ? nameToCamel(p.name) : `${patternToText(p.inner)} as ${nameToCamel(p.name)}`
    case 'pattern-tuple': return `(${p.elements.map(patternToText).join(', ')})`
    case 'constructor-pattern':
      return p.args.length === 0 ? nameToTitle(p.fqn.local) : `${nameToTitle(p.fqn.local)}(${p.args.map(patternToText).join(', ')})`
    case 'empty-list': return '[]'
    case 'head-tail': return `${patternToText(p.head)} :: ${patternToText(p.tail)}`
    case 'literal-pattern': return literalText(p.literal)
    case 'pattern-unit': return '()'
    case 'unknown': return `?${p.tag}`
  }
}
