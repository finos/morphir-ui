import {
  nameToCamel, nameToTitle, uncurryApply,
  type ValueDef, type ValueExpr
} from '@morphir/ir'
import type { InsightContext } from './context.ts'
import { isSdkFqn } from './context.ts'
import { literalText, patternToText } from './pattern-text.ts'
import type { ViewNode } from './view-node.ts'

export const toViewTree = (def: ValueDef, ctx: InsightContext): ViewNode => viewExpr(def.body, ctx)

export const viewExpr = (e: ValueExpr, ctx: InsightContext): ViewNode => {
  // Task 6 splice point: chain/operator routing runs BEFORE the structural switch.
  const special = viewSpecial(e, ctx)
  if (special) return special

  switch (e.kind) {
    case 'literal': return { kind: 'v-literal', text: literalText(e.literal), literalKind: e.literal.kind }
    case 'variable': return { kind: 'v-variable', name: nameToCamel(e.name) }
    case 'value-record': return { kind: 'v-record', fields: e.fields.map((f) => ({ name: nameToCamel(f.name), value: viewExpr(f.value, ctx) })) }
    case 'update-record': return { kind: 'v-update-record', subject: viewExpr(e.subject, ctx), fields: e.fields.map((f) => ({ name: nameToCamel(f.name), value: viewExpr(f.value, ctx) })) }
    case 'value-list': return { kind: 'v-list', items: e.items.map((i) => viewExpr(i, ctx)) }
    case 'value-tuple': return { kind: 'v-tuple', elements: e.elements.map((x) => viewExpr(x, ctx)) }
    case 'field': return { kind: 'v-field-access', subject: viewExpr(e.subject, ctx), field: nameToCamel(e.name) }
    case 'field-function': return { kind: 'v-field-access', subject: { kind: 'v-variable', name: '·' }, field: nameToCamel(e.name) }
    case 'constructor': return { kind: 'v-constructor', name: nameToTitle(e.fqn.local), args: [] }
    case 'lambda': return { kind: 'v-lambda', pattern: patternToText(e.pattern), body: viewExpr(e.body, ctx) }
    case 'let-definition': return viewLetGroup(e, ctx)
    case 'let-recursion': return {
      kind: 'v-let-group',
      bindings: e.definitions.map((d) => ({ name: nameToCamel(d.name), value: viewExpr(d.definition.body, ctx) })),
      body: viewExpr(e.inValue, ctx)
    }
    case 'destructure': return {
      kind: 'v-let-group',
      bindings: [{ name: patternToText(e.pattern), value: viewExpr(e.value, ctx) }],
      body: viewExpr(e.inValue, ctx)
    }
    case 'value-reference': return referenceNode(e.fqn, [], ctx)
    case 'apply': {
      const { fn, args } = uncurryApply(e)
      const viewArgs = args.map((a) => viewExpr(a, ctx))
      if (fn.kind === 'value-reference') return referenceNode(fn.fqn, viewArgs, ctx)
      if (fn.kind === 'constructor') return { kind: 'v-constructor', name: nameToTitle(fn.fqn.local), args: viewArgs }
      if (fn.kind === 'lambda') return { kind: 'v-prefix-call', label: `(${patternToText(fn.pattern)} → …)`, args: viewArgs }
      return { kind: 'v-prefix-call', label: '…', args: viewArgs }
    }
    case 'if-then-else': return viewBranching(e, ctx)     // Task 7 replaces this stub
    case 'pattern-match': return viewBranching(e, ctx)    // Task 7 replaces this stub
    case 'value-unit': return { kind: 'v-unit' }
    case 'unknown': return { kind: 'v-unknown', tag: e.tag }
  }
}

const viewLetGroup = (e: Extract<ValueExpr, { kind: 'let-definition' }>, ctx: InsightContext): ViewNode => {
  const bindings: { name: string; value: ViewNode }[] = []
  let current: ValueExpr = e
  while (current.kind === 'let-definition') {
    bindings.push({ name: nameToCamel(current.name), value: viewExpr(current.definition.body, ctx) })
    current = current.inValue
  }
  return { kind: 'v-let-group', bindings, body: viewExpr(current, ctx) }
}

// Task 8 replaces this with drill-down resolution; until then references stay collapsed.
export const referenceNode = (fqn: Parameters<typeof isSdkFqn>[0], args: ViewNode[], _ctx: InsightContext): ViewNode => ({
  kind: 'v-reference',
  fqn,
  display: nameToCamel(fqn.local),
  expandable: !isSdkFqn(fqn),
  args
})

// Task 6 implements operator/chain routing here; structurally it returns null (no special handling).
export const viewSpecial = (_e: ValueExpr, _ctx: InsightContext): ViewNode | null => null

// Task 7 implements if-trees and decision tables; interim: readable fallbacks.
export const viewBranching = (e: ValueExpr, ctx: InsightContext): ViewNode => {
  if (e.kind === 'if-then-else') {
    return {
      kind: 'v-if-tree',
      branches: [{ condition: viewExpr(e.condition, ctx), thenLabel: 'Yes', elseLabel: 'No', result: viewExpr(e.thenBranch, ctx) }],
      fallback: viewExpr(e.elseBranch, ctx)
    }
  }
  if (e.kind === 'pattern-match') {
    return {
      kind: 'v-decision-table',
      columns: [viewExpr(e.subject, ctx)],
      rows: e.cases.map((c) => ({ cells: [{ kind: 'cell-pattern' as const, text: patternToText(c.pattern) }], result: viewExpr(c.body, ctx) }))
    }
  }
  return { kind: 'v-unknown', tag: e.kind }
}
