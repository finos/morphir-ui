import { type Pattern, type ValueExpr } from '@morphir/ir'
import type { InsightContext } from './context.ts'
import { isSdkFqn } from './context.ts'
import { patternToText } from './pattern-text.ts'
import type { ViewCell, ViewNode } from './view-node.ts'
import { viewExpr } from './transform.ts'

type IfExpr = Extract<ValueExpr, { kind: 'if-then-else' }>
type MatchExpr = Extract<ValueExpr, { kind: 'pattern-match' }>

export const viewIfTree = (e: IfExpr, ctx: InsightContext): ViewNode => {
  const branches: { condition: ViewNode; thenLabel: string; elseLabel: string; result: ViewNode }[] = []
  let current: ValueExpr = e
  while (current.kind === 'if-then-else') {
    branches.push({
      condition: viewExpr(current.condition, ctx),
      thenLabel: 'Yes',
      elseLabel: 'No',
      result: viewExpr(current.thenBranch, ctx)
    })
    current = current.elseBranch
  }
  return { kind: 'v-if-tree', branches, fallback: viewExpr(current, ctx) }
}

const maybeSpecial = (e: MatchExpr, ctx: InsightContext): ViewNode | null => {
  if (e.cases.length !== 2) return null
  const classify = (p: Pattern): 'just' | 'nothing' | null => {
    if (p.kind === 'constructor-pattern' && isSdkFqn(p.fqn) && p.fqn.module.length === 1 && p.fqn.module[0]!.join('-') === 'maybe') {
      const local = p.fqn.local.join('-')
      return local === 'just' ? 'just' : local === 'nothing' ? 'nothing' : null
    }
    return null
  }
  const kinds = e.cases.map((c) => classify(c.pattern))
  const justIdx = kinds.indexOf('just')
  const nothingIdx = kinds.indexOf('nothing')
  if (justIdx === -1 || nothingIdx === -1) return null
  return {
    kind: 'v-if-tree',
    branches: [{
      condition: viewExpr(e.subject, ctx),
      thenLabel: 'set',
      elseLabel: 'not set',
      result: viewExpr(e.cases[justIdx]!.body, ctx)
    }],
    fallback: viewExpr(e.cases[nothingIdx]!.body, ctx)
  }
}

const patternLeaves = (pattern: Pattern): Pattern[] =>
  pattern.kind === 'pattern-tuple' ? pattern.elements.flatMap(patternLeaves) : [pattern]

const patternArity = (pattern: Pattern): number => patternLeaves(pattern).length

const columnSubjects = (subject: ValueExpr, patterns: readonly Pattern[]): ValueExpr[] => {
  if (subject.kind !== 'value-tuple') {
    const columnCount = patterns.reduce((max, pattern) => Math.max(max, patternArity(pattern)), 1)
    return Array.from({ length: columnCount }, () => subject)
  }

  return subject.elements.flatMap((element, index) => {
    const elementPatterns = patterns.flatMap((pattern): Pattern[] => {
      if (pattern.kind !== 'pattern-tuple') return []
      const elementPattern = pattern.elements[index]
      return elementPattern ? [elementPattern] : []
    })
    return columnSubjects(element, elementPatterns)
  })
}

const rowCells = (pattern: Pattern, columnCount: number): ViewCell[] => {
  const pad = (cells: ViewCell[]): ViewCell[] => {
    while (cells.length < columnCount) cells.push({ kind: 'cell-missing' })
    return cells
  }
  switch (pattern.kind) {
    case 'wildcard': return Array.from({ length: columnCount }, () => ({ kind: 'cell-wildcard' as const }))
    case 'pattern-tuple':
      return pad(
        patternLeaves(pattern).map((p): ViewCell =>
          p.kind === 'wildcard' ? { kind: 'cell-wildcard' } : { kind: 'cell-pattern', text: patternToText(p) }
        )
      )
    case 'literal-pattern':
    case 'constructor-pattern':
    case 'as':
      return pad([{ kind: 'cell-pattern', text: patternToText(pattern) }])
    default:
      // divergence #3: elm silently drops these rows; we render an explicit fallback cell
      return pad([{ kind: 'cell-unsupported', patternKind: pattern.kind }])
  }
}

export const viewDecisionTable = (e: MatchExpr, ctx: InsightContext): ViewNode => {
  const special = maybeSpecial(e, ctx)
  if (special) return special
  const subjects = columnSubjects(e.subject, e.cases.map((c) => c.pattern))
  const columnCount = subjects.length
  return {
    kind: 'v-decision-table',
    columns: subjects.map((subject) => viewExpr(subject, ctx)),
    rows: e.cases.map((c) => ({ cells: rowCells(c.pattern, columnCount), result: viewExpr(c.body, ctx) }))
  }
}
