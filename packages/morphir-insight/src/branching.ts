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

type ColumnLayout =
  | { readonly kind: 'column'; readonly subject: ValueExpr }
  | { readonly kind: 'tuple-columns'; readonly children: readonly ColumnLayout[] }

// Lenient malformed tuples retain extra pattern positions as visible unknown headers.
const missingTupleSubject: ValueExpr = { kind: 'unknown', tag: 'Missing tuple subject', raw: null }

const columnLayout = (subject: ValueExpr, patterns: readonly Pattern[]): ColumnLayout => {
  const tuplePatterns = patterns.filter(
    (pattern): pattern is Extract<Pattern, { kind: 'pattern-tuple' }> => pattern.kind === 'pattern-tuple'
  )
  if (subject.kind !== 'value-tuple' && tuplePatterns.length === 0) return { kind: 'column', subject }

  const subjectElements = subject.kind === 'value-tuple' ? subject.elements : []
  const arity = tuplePatterns.reduce(
    (max, pattern) => Math.max(max, pattern.elements.length),
    Math.max(subjectElements.length, 1)
  )
  return {
    kind: 'tuple-columns',
    children: Array.from({ length: arity }, (_, index) => {
      const childSubject = subject.kind === 'value-tuple'
        ? subject.elements[index] ?? missingTupleSubject
        : subject
      const childPatterns = tuplePatterns.flatMap((pattern): Pattern[] => {
        const childPattern = pattern.elements[index]
        return childPattern ? [childPattern] : []
      })
      return columnLayout(childSubject, childPatterns)
    })
  }
}

const layoutSubjects = (layout: ColumnLayout): ValueExpr[] =>
  layout.kind === 'column' ? [layout.subject] : layout.children.flatMap(layoutSubjects)

const layoutWidth = (layout: ColumnLayout): number =>
  layout.kind === 'column' ? 1 : layout.children.reduce((width, child) => width + layoutWidth(child), 0)

const missingCells = (layout: ColumnLayout): ViewCell[] =>
  Array.from({ length: layoutWidth(layout) }, () => ({ kind: 'cell-missing' as const }))

const patternCell = (pattern: Pattern, nested: boolean): ViewCell => {
  if (pattern.kind === 'wildcard') return { kind: 'cell-wildcard' }
  if (nested) return { kind: 'cell-pattern', text: patternToText(pattern) }
  switch (pattern.kind) {
    case 'literal-pattern':
    case 'constructor-pattern':
    case 'as':
      return { kind: 'cell-pattern', text: patternToText(pattern) }
    default:
      // divergence #3: elm silently drops these rows; we render an explicit fallback cell
      return { kind: 'cell-unsupported', patternKind: pattern.kind }
  }
}

const rowCells = (pattern: Pattern, layout: ColumnLayout, nested = false): ViewCell[] => {
  if (!nested && pattern.kind === 'wildcard') {
    return Array.from({ length: layoutWidth(layout) }, () => ({ kind: 'cell-wildcard' as const }))
  }
  if (layout.kind === 'tuple-columns' && pattern.kind === 'pattern-tuple') {
    return layout.children.flatMap((child, index) => {
      const childPattern = pattern.elements[index]
      return childPattern ? rowCells(childPattern, child, true) : missingCells(child)
    })
  }
  return [patternCell(pattern, nested), ...missingCells(layout).slice(1)]
}

export const viewDecisionTable = (e: MatchExpr, ctx: InsightContext): ViewNode => {
  const special = maybeSpecial(e, ctx)
  if (special) return special
  const layout = columnLayout(e.subject, e.cases.map((c) => c.pattern))
  return {
    kind: 'v-decision-table',
    columns: layoutSubjects(layout).map((subject) => viewExpr(subject, ctx)),
    rows: e.cases.map((c) => ({ cells: rowCells(c.pattern, layout), result: viewExpr(c.body, ctx) }))
  }
}
