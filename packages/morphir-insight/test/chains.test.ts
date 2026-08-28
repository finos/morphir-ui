import { describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import { decodeMorphirIr, decodeEntryValueDef, nameToCamel, type MorphirLibrary, type RawDefEntry } from '@morphir/ir'
import { makeContext, toViewTree, type ViewNode } from '../src/index.ts'

let lib: MorphirLibrary
const defs = new Map<string, RawDefEntry>()
const setup = async () => {
  if (defs.size) return
  const text = await Bun.file(new URL('../../morphir-ir/test/fixtures/insight-ir.json', import.meta.url)).text()
  lib = await Effect.runPromise(decodeMorphirIr(text))
  for (const e of lib.modules[0]!.values) defs.set(nameToCamel(e.name), e)
}
const tree = async (name: string): Promise<ViewNode> => {
  await setup()
  return toViewTree(decodeEntryValueDef(defs.get(name)!)!, makeContext(lib))
}

describe('arithmetic chains', () => {
  test('a + b + c flattens to one 3-item chain', async () => {
    const node = await tree('chainedArithmetic')
    expect(node.kind).toBe('v-arith-chain')
    if (node.kind === 'v-arith-chain') {
      expect(node.op).toBe('+')
      expect(node.items).toHaveLength(3)
      expect(node.items.every((i) => !i.grouped)).toBe(true)
    }
  })

  test('(a + b) * c groups the lower-precedence child', async () => {
    const node = await tree('mixedPrecedence')
    expect(node.kind).toBe('v-arith-chain')
    if (node.kind === 'v-arith-chain') {
      expect(node.op).toBe('*')
      const chainChild = node.items.find((i) => i.node.kind === 'v-arith-chain')!
      expect(chainChild.grouped).toBe(true)
    }
  })

  test('division renders as a fraction with a recursed denominator', async () => {
    const node = await tree('safeDivide')
    expect(node.kind).toBe('v-fraction')
    if (node.kind === 'v-fraction') expect(node.denominator.kind).toBe('v-arith-chain')
  })

  test('a - b - c (left-associated) flattens to one 3-item chain', async () => {
    const node = await tree('leftSubtraction')
    expect(node.kind).toBe('v-arith-chain')
    if (node.kind === 'v-arith-chain') {
      expect(node.op).toBe('-')
      expect(node.items).toHaveLength(3)
      expect(node.items.every((i) => !i.grouped)).toBe(true)
    }
  })

  test('a - (b - c) keeps the right-hand subtraction grouped, not flattened', async () => {
    const node = await tree('rightSubtraction')
    expect(node.kind).toBe('v-arith-chain')
    if (node.kind === 'v-arith-chain') {
      expect(node.op).toBe('-')
      expect(node.items).toHaveLength(2)
      expect(node.items[1]!.node.kind).toBe('v-arith-chain')
      expect(node.items[1]!.grouped).toBe(true)
    }
  })
})

describe('logic chains and comparisons', () => {
  test('p && q && r || not p produces OR of [AND-chain, prefix-not]', async () => {
    const node = await tree('boolChain')
    expect(node.kind).toBe('v-logic-chain')
    if (node.kind === 'v-logic-chain') {
      expect(node.op).toBe('OR')
      expect(node.items[0]!.kind).toBe('v-logic-chain')
      expect(node.items[1]!.kind).toBe('v-prefix-call')
    }
  })

  test('a <= b renders as an inline binary op', async () => {
    const node = await tree('comparison')
    expect(node).toMatchObject({ kind: 'v-binary-op', symbol: '<=' })
  })
})

describe('apply specials', () => {
  test('negate renders as prefix minus', async () => {
    expect(await tree('negated')).toMatchObject({ kind: 'v-prefix-call', label: '-' })
  })
  test('power renders as superscript node', async () => {
    expect((await tree('powered')).kind).toBe('v-power')
  })
  test('List.member with a literal list renders as member-of', async () => {
    const node = await tree('memberOf')
    expect(node.kind).toBe('v-member-of')
    if (node.kind === 'v-member-of') expect(node.options).toHaveLength(2)
  })
  test('map over filter builds an ordered pipeline', async () => {
    const node = await tree('applyPipeline')
    expect(node.kind).toBe('v-pipeline')
    if (node.kind === 'v-pipeline') expect(node.stages.map((s) => s.label)).toEqual(['filter', 'map'])
  })
})
