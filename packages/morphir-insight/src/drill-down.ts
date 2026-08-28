import { decodeEntryValueDef, nameToCamel, pathToTitle, type FQName, type ValueDef } from '@morphir/ir'
import type { InsightContext } from './context.ts'
import { fqnKey, isSdkFqn } from './context.ts'
import type { ViewNode } from './view-node.ts'
import { toViewTree } from './transform.ts'

const lookup = (fqn: FQName, ctx: InsightContext): ValueDef | null => {
  if (pathToTitle(fqn.pkg) !== pathToTitle(ctx.library.packageName)) return null
  for (const m of ctx.library.modules) {
    if (pathToTitle(m.path) !== pathToTitle(fqn.module)) continue
    for (const e of m.values) {
      if (nameToCamel(e.name) === nameToCamel(fqn.local)) return decodeEntryValueDef(e)
    }
  }
  return null
}

export const resolveReference = (fqn: FQName, args: readonly ViewNode[], ctx: InsightContext): ViewNode => {
  const display = nameToCamel(fqn.local)
  if (isSdkFqn(fqn)) return { kind: 'v-reference', fqn, display, expandable: false, args }
  const def = lookup(fqn, ctx)
  const base = { kind: 'v-reference' as const, fqn, display, expandable: def !== null, args }
  const key = fqnKey(fqn)
  if (!def || !ctx.expanded.has(key)) return base
  if (ctx.path.includes(key)) return { ...base, cycle: true }
  return { ...base, expanded: toViewTree(def, { ...ctx, path: [...ctx.path, key] }) }
}
