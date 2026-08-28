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

const countColumns = (subject: ValueExpr): number =>
  subject.kind === 'value-tuple' ? subject.elements.reduce((n, el) => n + countColumns(el), 0) : 1

const columnSubjects = (subject: ValueExpr): ValueExpr[] =>
  subject.kind === 'value-tuple' ? subject.elements.flatMap(columnSubjects) : [subject]

const rowCells = (pattern: Pattern, columnCount: number): ViewCell[] => {
  const pad = (cells: ViewCell[]): ViewCell[] => {
    while (cells.length < columnCount) cells.push({ kind: 'cell-missing' })
    return cells
  }
  switch (pattern.kind) {
    case 'wildcard': return Array.from({ length: columnCount }, () => ({ kind: 'cell-wildcard' as const }))
    case 'pattern-tuple':
      return pad(pattern.elements.map((p): ViewCell => (p.kind === 'wildcard' ? { kind: 'cell-wildcard' } : { kind: 'cell-pattern', text: patternToText(p) })))
    case 'literal-pattern':
    case 'constructor-pattern':
    case 'as':
      return pad([{ kind: 'cell-pattern', text: patternToText(pattern) }])
    default:
      // divergence #3: elm silently drops these rows; we render an explicit fallback cell
      return pad([{ kind: 'cell-unsupported', patternKind: pattern.kind }])
  }
}

// elm's decomposeInput only splits a literal tuple *expression* into columns. In practice the
// fixture's tupleCase subject is a variable whose *type* is a tuple (`case pair of ...`), so the
// literal expression never decomposes — we instead fall back to the arity of any pattern-tuple
// case to size the table, using the subject's own view repeated per column as the header.
const patternArity = (p: Pattern): number => (p.kind === 'pattern-tuple' ? p.elements.length : 1)

const columnCountFor = (subject: ValueExpr, cases: MatchExpr['cases']): number =>
  subject.kind === 'value-tuple'
    ? countColumns(subject)
    : cases.reduce((max, c) => Math.max(max, patternArity(c.pattern)), 1)

const columnHeaders = (subject: ValueExpr, columnCount: number, ctx: InsightContext): ViewNode[] =>
  subject.kind === 'value-tuple'
    ? columnSubjects(subject).map((s) => viewExpr(s, ctx))
    : Array.from({ length: columnCount }, () => viewExpr(subject, ctx))

export const viewDecisionTable = (e: MatchExpr, ctx: InsightContext): ViewNode => {
  const special = maybeSpecial(e, ctx)
  if (special) return special
  const columnCount = columnCountFor(e.subject, e.cases)
  return {
    kind: 'v-decision-table',
    columns: columnHeaders(e.subject, columnCount, ctx),
    rows: e.cases.map((c) => ({ cells: rowCells(c.pattern, columnCount), result: viewExpr(c.body, ctx) }))
  }
}
