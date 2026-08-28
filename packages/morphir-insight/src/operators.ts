import { nameToCamel, pathToTitle, type FQName } from '@morphir/ir'

export const sdkCallName = (fqn: FQName): string => `${pathToTitle(fqn.module)}.${nameToCamel(fqn.local)}`

export const INLINE_BINARY_OPERATORS: Record<string, string> = {
  'Basics.equal': '=',
  'Basics.notEqual': '≠',
  'Basics.lessThan': '<',
  'Basics.lessThanOrEqual': '<=',
  'Basics.greaterThan': '>',
  'Basics.greaterThanOrEqual': '>=',
  'Basics.add': '+',
  'Basics.subtract': '-',
  'Basics.multiply': '*',
  'Basics.divide': '/',
  'List.append': '+',
  'Basics.power': '^'
}

export const ARITH_OPS: Record<string, '+' | '-' | '*'> = {
  'Basics.add': '+',
  'Basics.subtract': '-',
  'Basics.multiply': '*'
}

export const ARITH_PRECEDENCE: Record<string, number> = { '+': 1, '-': 1, '*': 2 }

export const LOGIC_OPS: Record<string, 'AND' | 'OR'> = { 'Basics.and': 'AND', 'Basics.or': 'OR' }

export const PIPELINE_LABELS: Record<string, string> = { map: 'map', filter: 'filter', 'filter-map': 'filter & map' }
