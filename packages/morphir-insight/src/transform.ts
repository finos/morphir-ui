import {
  nameToCamel, nameToTitle, uncurryApply,
  type ValueDef, type ValueExpr
} from '@morphir/ir'
import type { InsightContext } from './context.ts'
import { isSdkFqn } from './context.ts'
import { literalText, patternToText } from './pattern-text.ts'
import type { ViewNode } from './view-node.ts'
import { routeSpecial } from './chains.ts'
import { viewDecisionTable, viewIfTree } from './branching.ts'

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
    case 'if-then-else': return viewIfTree(e, ctx)
    case 'pattern-match': return viewDecisionTable(e, ctx)
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

// Task 6 implements the real router in chains.ts; this delegates to it. The transform↔chains
// import cycle is intentional and safe: each module only calls the other's functions at
// runtime (inside function bodies), never at module-init time.
export const viewSpecial = (e: ValueExpr, ctx: InsightContext): ViewNode | null => routeSpecial(e, ctx)
