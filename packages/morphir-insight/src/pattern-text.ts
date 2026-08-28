import { nameToCamel, nameToTitle, type Literal, type Pattern } from '@morphir/ir'

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
