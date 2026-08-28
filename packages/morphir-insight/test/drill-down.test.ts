import { describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import { decodeMorphirIr, decodeEntryValueDef, nameToCamel, type MorphirLibrary, type RawDefEntry } from '@morphir/ir'
import { fqnKey, makeContext, toViewTree, type ViewNode } from '../src/index.ts'

let lib: MorphirLibrary
const defs = new Map<string, RawDefEntry>()
const load = async () => {
  if (defs.size) return
  const text = await Bun.file(new URL('../../morphir-ir/test/fixtures/insight-ir.json', import.meta.url)).text()
  lib = await Effect.runPromise(decodeMorphirIr(text))
  for (const e of lib.modules[0]!.values) defs.set(nameToCamel(e.name), e)
}
const tree = async (name: string, expanded: Set<string> = new Set()): Promise<ViewNode> => {
  await load()
  return toViewTree(decodeEntryValueDef(defs.get(name)!)!, makeContext(lib, expanded))
}
// Descend into children BEFORE matching the current node: a drilled-down reference chip
// nests a same-display v-reference inside its own `expanded` subtree (one unrolled level),
// and self-recursion nests a *second*, cycle-marked occurrence one level deeper still. A
// root-first match would always return the outermost (still-expanding) occurrence and never
// reach the terminal cycle node, so this returns the deepest match instead.
const findRef = (n: ViewNode, display: string): Extract<ViewNode, { kind: 'v-reference' }> | null => {
  for (const v of Object.values(n)) {
    const scan = (x: unknown): ReturnType<typeof findRef> => {
      if (typeof x === 'object' && x !== null && 'kind' in x) return findRef(x as ViewNode, display)
      return null
    }
    if (Array.isArray(v)) { for (const item of v) { const inner = typeof item === 'object' && item !== null && 'node' in (item as object) ? (item as { node: ViewNode }).node : item; const hit = scan(inner); if (hit) return hit } }
    else { const hit = scan(v); if (hit) return hit }
  }
  if (n.kind === 'v-reference' && n.display === display) return n
  return null
}

describe('drill-down', () => {
  test('collapsed by default; user references are expandable', async () => {
    const node = await tree('usesHelper')
    const ref = findRef(node, 'helperFn')!
    expect(ref.expandable).toBe(true)
    expect(ref.expanded).toBeUndefined()
  })

  test('expansion embeds the referenced definition tree', async () => {
    await load()
    const key = fqnKey({ pkg: lib.packageName as never, module: lib.modules[0]!.path as never, local: ['helper', 'fn'] })
    const node = await tree('usesHelper', new Set([key]))
    const ref = findRef(node, 'helperFn')!
    expect(ref.expanded).toBeDefined()
    expect(ref.expanded!.kind).toBe('v-arith-chain')
  })

  test('self-recursion under expansion renders a cycle marker instead of recursing forever', async () => {
    await load()
    const key = fqnKey({ pkg: lib.packageName as never, module: lib.modules[0]!.path as never, local: ['self', 'recursive'] })
    const node = await tree('selfRecursive', new Set([key]))
    const ref = findRef(node, 'selfRecursive')!
    expect(ref.cycle).toBe(true)
    expect(ref.expanded).toBeUndefined()
  })
})
