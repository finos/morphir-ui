import { nameToTitle, uncurryApply, type ValueExpr } from '@morphir/ir'
import type { InsightContext } from './context.ts'
import { isSdkFqn } from './context.ts'
import { ARITH_OPS, ARITH_PRECEDENCE, INLINE_BINARY_OPERATORS, LOGIC_OPS, PIPELINE_LABELS, sdkCallName } from './operators.ts'
import type { ViewNode } from './view-node.ts'
import { viewExpr } from './transform.ts'

interface SdkApply { readonly call: string; readonly local: string; readonly args: readonly ValueExpr[] }

const asSdkApply = (e: ValueExpr): SdkApply | null => {
  if (e.kind !== 'apply') return null
  const { fn, args } = uncurryApply(e)
  if (fn.kind !== 'value-reference' || !isSdkFqn(fn.fqn)) return null
  return { call: sdkCallName(fn.fqn), local: fn.fqn.local.join('-'), args }
}

const flattenArith = (e: ValueExpr, op: '+' | '-' | '*', ctx: InsightContext): { node: ViewNode; grouped: boolean }[] => {
  const sdk = asSdkApply(e)
  if (sdk && sdk.args.length === 2 && ARITH_OPS[sdk.call] === op) {
    return [...flattenArith(sdk.args[0]!, op, ctx), ...flattenArith(sdk.args[1]!, op, ctx)]
  }
  const node = viewExpr(e, ctx)
  const childPrecedence =
    node.kind === 'v-arith-chain' ? ARITH_PRECEDENCE[node.op]! : node.kind === 'v-fraction' ? 2 : null
  const grouped = childPrecedence !== null && childPrecedence < ARITH_PRECEDENCE[op]!
  return [{ node, grouped }]
}

const flattenLogic = (e: ValueExpr, op: 'AND' | 'OR', ctx: InsightContext): ViewNode[] => {
  const sdk = asSdkApply(e)
  if (sdk && sdk.args.length === 2 && LOGIC_OPS[sdk.call] === op) {
    return [...flattenLogic(sdk.args[0]!, op, ctx), ...flattenLogic(sdk.args[1]!, op, ctx)]
  }
  return [viewExpr(e, ctx)]
}

const pipeline = (e: ValueExpr, ctx: InsightContext): ViewNode | null => {
  const stages: { label: string; arg: ViewNode }[] = []
  let current = e
  for (;;) {
    const sdk = asSdkApply(current)
    if (!sdk || sdk.args.length !== 2) break
    const label = PIPELINE_LABELS[sdk.local]
    if (!label) break
    stages.unshift({ label, arg: viewExpr(sdk.args[0]!, ctx) })
    current = sdk.args[1]!
  }
  if (stages.length === 0) return null
  return { kind: 'v-pipeline', input: viewExpr(current, ctx), stages }
}

/** The real special-form router — replaces Task 5's null stub. */
export const routeSpecial = (e: ValueExpr, ctx: InsightContext): ViewNode | null => {
  if (e.kind !== 'apply') return null
  const sdk = asSdkApply(e)

  if (sdk) {
    const { call, local, args } = sdk
    if (args.length === 2) {
      if (ARITH_OPS[call]) return { kind: 'v-arith-chain', op: ARITH_OPS[call]!, items: flattenArith(e, ARITH_OPS[call]!, ctx) }
      if (call === 'Basics.divide') return { kind: 'v-fraction', numerator: viewExpr(args[0]!, ctx), denominator: viewExpr(args[1]!, ctx) }
      if (LOGIC_OPS[call]) return { kind: 'v-logic-chain', op: LOGIC_OPS[call]!, items: flattenLogic(e, LOGIC_OPS[call]!, ctx) }
      if (call === 'Basics.power') return { kind: 'v-power', base: viewExpr(args[0]!, ctx), exponent: viewExpr(args[1]!, ctx) }
      // Fix vs. brief draft: deriving the label from `local` via split/join fought the typechecker;
      // `call` already carries the camelCased local name (sdkCallName = "Title.camelLocal"), so slicing
      // off the "Basics." prefix yields exactly 'min'/'max' with no extra name-array gymnastics.
      if (call === 'Basics.min' || call === 'Basics.max')
        return { kind: 'v-prefix-call', label: call.slice('Basics.'.length), args: args.map((a) => viewExpr(a, ctx)) }
      if (call === 'List.member' && args[1]!.kind === 'value-list')
        return { kind: 'v-member-of', item: viewExpr(args[0]!, ctx), options: (args[1] as Extract<ValueExpr, { kind: 'value-list' }>).items.map((i) => viewExpr(i, ctx)) }
      const piped = PIPELINE_LABELS[local] ? pipeline(e, ctx) : null
      if (piped) return piped
      const symbol = INLINE_BINARY_OPERATORS[call]
      if (symbol) return { kind: 'v-binary-op', symbol, left: viewExpr(args[0]!, ctx), right: viewExpr(args[1]!, ctx) }
    }
    if (args.length === 1) {
      if (call === 'Basics.negate') return { kind: 'v-prefix-call', label: '-', args: [viewExpr(args[0]!, ctx)] }
      if (call.startsWith('Basics.')) return { kind: 'v-prefix-call', label: call.slice('Basics.'.length), args: [viewExpr(args[0]!, ctx)] }
    }
  }

  // isFoo x → x is Foo (any package, 1 arg, local name starts with word 'is')
  const { fn, args } = uncurryApply(e)
  if (fn.kind === 'value-reference' && args.length === 1 && fn.fqn.local[0] === 'is' && fn.fqn.local.length > 1) {
    return {
      kind: 'v-binary-op', symbol: 'is',
      left: viewExpr(args[0]!, ctx),
      right: { kind: 'v-variable', name: nameToTitle(fn.fqn.local.slice(1)) }
    }
  }
  return null
}
