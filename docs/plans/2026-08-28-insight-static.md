# Insight Visualization (Static) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render morphir-elm's static insight experience natively in morphir-ui — full AST decoding, a pure display-tree transform with drill-down, decision tables/trees, and an XRay view — as Insight|XRay tabs inside the IR Explorer.

**Architecture:** Three layers with hard boundaries (spec Approach A): `@morphir/ir` decodes the complete v3 Value/Type/Pattern/Literal AST; the new pure package `@morphir/insight` transforms decoded definitions into a presentation-shaped `ViewNode` tree (chains, tables, branches, drill-down as cycle-guarded substitution); `@morphir/ui` renders `ViewNode`s with thin recursive Svelte components. XRay ships before the transform to visually verify the decoder.

**Tech Stack:** TypeScript (TS 7 for pure packages via local pins, TS 5 tooling), Effect 3.22, Svelte 5 runes, bun test (pure packages) / vitest + testing-library (components), morphir-elm CLI (one-time fixture generation).

**Spec:** `docs/specs/2026-08-28-insight-visualization-design.md` (this repo). The plan argues from the spec; executors read both.

**Working directory:** ALL tasks run in the morphir-ui checkout at
`/home/damre/.t3/worktrees/morphir/t3code-d18fb25c/ecosystem/morphir-ui` on branch `feat/insight-static`.
Fixture generation (Task 1 only) additionally runs commands inside
`/home/damre/.t3/worktrees/morphir/t3code-d18fb25c/ecosystem/morphir-elm` — read-only apart from build outputs; NOTHING is committed there.

## Global Constraints

- **Repo guardrail:** shell cwd resets between commands — prefix every command with the cd. Verify `git rev-parse --show-toplevel` = the morphir-ui checkout and branch = `feat/insight-static` before ANY git command. Never run git in the parent repo or sibling submodules.
- **Every commit:** DCO sign-off (`git commit -s`, author Damian Reeves), conventional message, NO AI attribution (EasyCLA).
- **TDD:** failing test first, RED evidence, then implement, GREEN evidence, then commit.
- **Purity boundaries:** `@morphir/insight` imports only `@morphir/ir` and `effect` — zero Svelte/DOM. `@morphir/ir` gains no new dependencies.
- **Leniency contract:** unknown tags decode to `UnknownNode { tag, raw }` and render as fallbacks — no crash on any input that parses as JSON.
- **Styling:** NO inline `style=` attributes; scoped `<style>` blocks; tokens only (`--code-bg`, `--mono`, `--accent`, `--accent2`, `--row-edge`, `--panel-edge`, `--muted`, `--text-strong`).
- **Deliberate divergences from morphir-elm (document in the final PR body; do NOT "fix" back):**
  1. Arithmetic chains flatten n-ary ONLY across the same operator (elm's builder nests unconditionally because its same-op guard is unused — accidental, not semantic).
  2. Parenthesize a child exactly when its operator precedence is strictly lower than its parent's (elm intends this; its index bookkeeping is buggy — we implement the intent).
  3. Decision-table rows whose pattern the decomposer cannot widen (EmptyList/HeadTail/Unit patterns) render as a fallback row labeled with the pattern kind — elm silently drops them.
  4. No z-index/highlight/evaluation machinery — that is the evaluation cycle.
  5. `Basics.power` renders as superscript (elm's `^` dict entry is dead code; superscript is the live path).
- **Versions:** no new runtime dependencies anywhere. Fixture generation uses morphir-elm's own toolchain (npm/elm) inside that submodule only.
- **Task contract:** every package keeps `lint`/`typecheck`/`test`/`build` scripts green; root `mise exec -- moon run :lint :typecheck :test :build` must pass at every task's end.

## File Structure (end state)

```
packages/
├── morphir-ir/
│   ├── src/ast.ts                 # TypeExpr/ValueExpr/Pattern/Literal unions + UnknownNode (Task 2/3)
│   ├── src/ast-decode.ts          # decodeTypeExpr/decodePattern/decodeLiteral (Task 2), decodeValueExpr/decodeValueDef (Task 3)
│   └── test/ast-decode.test.ts, test/value-decode.test.ts
│   └── test/fixtures/insight-ir.json          # generated fixture (Task 1)
├── morphir-insight/               # NEW package (Task 5)
│   ├── package.json  moon.yml  tsconfig.json
│   ├── src/index.ts
│   ├── src/view-node.ts           # ViewNode vocabulary (Task 5)
│   ├── src/context.ts             # InsightContext + definition index (Task 5)
│   ├── src/transform.ts           # toViewTree dispatch + structural nodes (Task 5)
│   ├── src/operators.ts           # SDK operator tables (Task 6)
│   ├── src/chains.ts              # arithmetic/logic/comparison/apply-specials (Task 6)
│   ├── src/branching.ts           # if-else trees + decision tables (Task 7)
│   ├── src/drill-down.ts          # expansion resolution + cycle guard (Task 8)
│   └── test/*.test.ts + test/goldens/*.json
├── morphir-ui/
│   └── src/views/insight/
│       ├── DetailTabs.svelte      # tab chrome (Task 4)
│       ├── DefinitionDetail.svelte# tab host replacing the inline def card (Task 4)
│       ├── XRayView.svelte + XRayNode.svelte (Task 4)
│       ├── InsightView.svelte + InsightNode.svelte + nodes/*.svelte (Task 8)
│       └── insight-state.svelte.ts (Task 8)
fixtures-src/insight/              # Elm sources for the generated fixture + provenance README (Task 1)
```

Task list: 1 Fixtures · 2 Literal/Pattern/Type decoders · 3 Value decoder · 4 XRay + detail tabs · 5 @morphir/insight scaffold + structural transform + golden harness · 6 Operators & chains · 7 Branching (trees + tables) · 8 Drill-down + Insight renderers · 9 Final verification + PR.

---

### Task 1: Generated insight fixture

**Files:**
- Create: `fixtures-src/insight/morphir.json`, `fixtures-src/insight/elm.json`, `fixtures-src/insight/src/Morphir/Ui/Fixtures/Insight.elm`, `fixtures-src/insight/README.md`
- Create (generated): `packages/morphir-ir/test/fixtures/insight-ir.json`

**Interfaces:**
- Produces: `insight-ir.json` — a formatVersion-3 IR containing module `Morphir.Ui.Fixtures.Insight` with definitions named exactly: `chainedArithmetic`, `mixedPrecedence`, `safeDivide`, `boolChain`, `comparison`, `gradeIf`, `maybeCase`, `colorCase`, `tupleCase`, `nestedCase`, `letBound`, `applyPipeline`, `personRecord`, `updatedPerson`, `applyLambda`, `negated`, `powered`, `memberOf`, `helperFn`, `usesHelper`, `selfRecursive` (21 total) — later tasks' tests reference these names verbatim; the last three exist specifically for drill-down and cycle-guard tests.

- [ ] **Step 1: Author the fixture Elm project**

`fixtures-src/insight/morphir.json`:
```json
{ "name": "Morphir.Ui.Fixtures", "sourceDirectory": "src", "exposedModules": ["Insight"] }
```

`fixtures-src/insight/elm.json`:
```json
{
  "type": "application",
  "source-directories": ["src", "../../../morphir-elm/src"],
  "elm-version": "0.19.1",
  "dependencies": {
    "direct": { "elm/core": "1.0.5" },
    "indirect": {}
  },
  "test-dependencies": { "direct": {}, "indirect": {} }
}
```
(Note: the `../../../morphir-elm/src` source directory points at the sibling submodule checkout so `Morphir.SDK` resolves, mirroring how morphir-elm's own reference-model does it via relative paths. If `elm make` demands more packages than `elm/core` (the SDK sources import others), copy the `dependencies` block verbatim from `morphir-elm/tests-integration/reference-model/elm.json` and note it in the README. If `elm make` inside the morphir-elm CLI resolves SDK sources implicitly and this entry causes duplicate-module errors, drop it and re-run — record which variant worked in the README.)

`fixtures-src/insight/src/Morphir/Ui/Fixtures/Insight.elm`:
```elm
module Morphir.Ui.Fixtures.Insight exposing (..)

{-| Purpose-built fixture for morphir-ui's insight visualization tests.
Each definition targets one transform behavior; names are load-bearing
(referenced verbatim from tests in @morphir/ir and @morphir/insight).
-}


type Color
    = Red
    | Green
    | Blue


type alias Person =
    { name : String
    , age : Int
    }


chainedArithmetic : Int -> Int -> Int -> Int
chainedArithmetic a b c =
    a + b + c


mixedPrecedence : Int -> Int -> Int -> Int
mixedPrecedence a b c =
    (a + b) * c


safeDivide : Float -> Float -> Float
safeDivide n d =
    n / (d + 1)


boolChain : Bool -> Bool -> Bool -> Bool
boolChain p q r =
    p && q && r || not p


comparison : Int -> Int -> Bool
comparison a b =
    a <= b


gradeIf : Int -> String
gradeIf score =
    if score >= 90 then
        "A"

    else if score >= 80 then
        "B"

    else if score >= 70 then
        "C"

    else
        "F"


maybeCase : Maybe Int -> Int
maybeCase m =
    case m of
        Just x ->
            x

        Nothing ->
            0


colorCase : Color -> String
colorCase color =
    case color of
        Red ->
            "warm"

        Green ->
            "natural"

        Blue ->
            "cool"


tupleCase : ( Int, Bool ) -> String
tupleCase pair =
    case pair of
        ( 0, True ) ->
            "zero-true"

        ( _, False ) ->
            "any-false"

        _ ->
            "other"


nestedCase : Color -> Maybe Int -> String
nestedCase color m =
    case color of
        Red ->
            case m of
                Just _ ->
                    "red-some"

                Nothing ->
                    "red-none"

        _ ->
            "not-red"


letBound : Int -> Int
letBound x =
    let
        doubled =
            x * 2

        offset =
            doubled + 1
    in
    offset


applyPipeline : List Int -> List Int
applyPipeline xs =
    List.map (\x -> x + 1) (List.filter (\x -> x > 0) xs)


personRecord : Person
personRecord =
    { name = "Ada", age = 36 }


updatedPerson : Person -> Person
updatedPerson p =
    { p | age = p.age + 1 }


applyLambda : Int -> Int
applyLambda x =
    (\y -> y * y) x


negated : Int -> Int
negated x =
    negate x


powered : Float -> Float
powered x =
    x ^ 2


memberOf : Color -> Bool
memberOf c =
    List.member c [ Red, Blue ]


helperFn : Int -> Int
helperFn x =
    x + 1


usesHelper : Int -> Int
usesHelper x =
    helperFn (x * 2)


selfRecursive : Int -> Int
selfRecursive n =
    if n <= 0 then
        0

    else
        selfRecursive (n - 1)
```

`fixtures-src/insight/README.md`:
```markdown
# Insight fixture sources

Elm sources compiled once with the morphir-elm CLI (sibling submodule) to
produce `packages/morphir-ir/test/fixtures/insight-ir.json` (formatVersion 3).

Provenance: generated from this directory with

    node <morphir-elm>/cli/morphir-elm.js make -f -p . -o <out> -i

using morphir-elm at the commit recorded below. Regenerate only when the
fixture sources change; commit source and output together.

morphir-elm commit: <filled in by the generation step>
```

- [ ] **Step 2: Build the morphir-elm CLI (one-time, in the sibling submodule)**

```bash
cd /home/damre/.t3/worktrees/morphir/t3code-d18fb25c/ecosystem/morphir-elm
npm install          # installs elm via elm-tooling "prepare"
cd cli && ../node_modules/.bin/elm make src/Morphir/Elm/CLI.elm --output=Morphir.Elm.CLI.js && cd ..
```
Expected: `cli/Morphir.Elm.CLI.js` exists. (This is the direct-elm path that bypasses the docs-check gate; the `-f` fallback flag in Step 3 keeps everything on this v1 pipeline so `cli2` never needs building.) Do NOT commit anything in morphir-elm — build outputs there are scratch.

- [ ] **Step 3: Generate the IR**

```bash
cd /home/damre/.t3/worktrees/morphir/t3code-d18fb25c/ecosystem/morphir-ui
node ../morphir-elm/cli/morphir-elm.js make -f \
  -p ./fixtures-src/insight \
  -o ./packages/morphir-ir/test/fixtures/insight-ir.json -i
```
Expected: the file exists, `"formatVersion": 3`, and contains all 21 definition names from the Interfaces block (verify: `grep -c '"chained","arithmetic"' …` etc. — spot-check at least 5 names in their decomposed-Name form, e.g. `["chained","arithmetic"]`, `["safe","divide"]`, `["apply","pipeline"]`). If `elm make` fails on the SDK source-directory, apply the fallback noted in Step 1 and record it. Fill the morphir-elm commit hash into `fixtures-src/insight/README.md` (`git -C ../morphir-elm rev-parse HEAD`).

- [ ] **Step 4: Sanity-check against the existing decoder**

```bash
cd packages/morphir-ir && mise exec -- bun test
```
Expected: existing envelope tests still pass (the new fixture is not yet referenced). Then run a one-off check that the envelope decoder accepts it:
```bash
mise exec -- bun -e 'import {decodeMorphirIr} from "./src/index.ts"; import {Effect} from "effect";
const t = await Bun.file("test/fixtures/insight-ir.json").text();
const lib = await Effect.runPromise(decodeMorphirIr(t));
console.log("modules:", lib.modules.length, "values:", lib.modules[0].values.length);'
```
Expected: 1 module, 21 values.

- [ ] **Step 5: Commit**

```bash
git add fixtures-src packages/morphir-ir/test/fixtures/insight-ir.json
git commit -s -m "test(ir): add generated insight fixture with provenance sources"
```

---

### Task 2: Literal, Pattern, and Type decoders (`@morphir/ir`)

**Files:**
- Create: `packages/morphir-ir/src/ast.ts`, `src/ast-decode.ts`; extend `src/index.ts`
- Test: `packages/morphir-ir/test/ast-decode.test.ts`

**Interfaces:**
- Produces (consumed by Tasks 3–8):
  - `type Literal = { kind: 'bool'; value: boolean } | { kind: 'char'; value: string } | { kind: 'string'; value: string } | { kind: 'whole-number'; value: number } | { kind: 'float'; value: number } | { kind: 'decimal'; value: string } | UnknownNode`
  - `type TypeExpr = { kind: 'type-variable'; name: Name } | { kind: 'type-reference'; fqn: FQName; args: TypeExpr[] } | { kind: 'type-tuple'; elements: TypeExpr[] } | { kind: 'type-record'; fields: { name: Name; tpe: TypeExpr }[] } | { kind: 'type-extensible-record'; variable: Name; fields: { name: Name; tpe: TypeExpr }[] } | { kind: 'type-function'; argument: TypeExpr; result: TypeExpr } | { kind: 'type-unit' } | UnknownNode`
  - `type Pattern = { kind: 'wildcard' } | { kind: 'as'; inner: Pattern; name: Name } | { kind: 'pattern-tuple'; elements: Pattern[] } | { kind: 'constructor-pattern'; fqn: FQName; args: Pattern[] } | { kind: 'empty-list' } | { kind: 'head-tail'; head: Pattern; tail: Pattern } | { kind: 'literal-pattern'; literal: Literal } | { kind: 'pattern-unit' } | UnknownNode`
  - `interface FQName { pkg: Path; module: Path; local: Name }` (structured — unlike the display-string `DefinitionRef`)
  - `interface UnknownNode { kind: 'unknown'; tag: string; raw: unknown }`
  - `decodeLiteral(u: unknown): Literal`, `decodePattern(u: unknown): Pattern`, `decodeTypeExpr(u: unknown): TypeExpr` — total functions; malformed input yields `UnknownNode` (tag `'<malformed>'` when no tag string is present).
  - `fqNameFromRaw(u: unknown): FQName | null` (3-tuple `[pkgPath, modPath, localName]`).

**v3 encodings (verbatim reference — the decoders below implement exactly this):**
```
Literal:  ["BoolLiteral", bool] ["CharLiteral", str] ["StringLiteral", str]
          ["WholeNumberLiteral", int] ["FloatLiteral", num] ["DecimalLiteral", str]
Type:     ["Variable", attrs, Name] ["Reference", attrs, FQName, [Type...]]
          ["Tuple", attrs, [Type...]] ["Record", attrs, [{name, tpe}...]]
          ["ExtensibleRecord", attrs, Name, [{name, tpe}...]]
          ["Function", attrs, argType, returnType] ["Unit", attrs]
Pattern:  ["WildcardPattern", attrs] ["AsPattern", attrs, Pattern, Name]
          ["TuplePattern", attrs, [Pattern...]] ["ConstructorPattern", attrs, FQName, [Pattern...]]
          ["EmptyListPattern", attrs] ["HeadTailPattern", attrs, head, tail]
          ["LiteralPattern", attrs, Literal] ["UnitPattern", attrs]
FQName:   [Path, Path, Name]   Name: ["lower","case","words"]   Path: [Name...]
Type Record fields are OBJECTS {name, tpe}; everything else positional.
```

- [ ] **Step 1: Write the failing tests**

`packages/morphir-ir/test/ast-decode.test.ts`:
```ts
import { describe, expect, test } from 'bun:test'
import { decodeLiteral, decodePattern, decodeTypeExpr, fqNameFromRaw } from '../src/index.ts'

const intRef = ['Reference', {}, [[['morphir'], ['s', 'd', 'k']], [['basics']], ['int']], []]

describe('decodeLiteral', () => {
  test('decodes all six v3 literal tags', () => {
    expect(decodeLiteral(['BoolLiteral', true])).toEqual({ kind: 'bool', value: true })
    expect(decodeLiteral(['CharLiteral', 'x'])).toEqual({ kind: 'char', value: 'x' })
    expect(decodeLiteral(['StringLiteral', 'hi'])).toEqual({ kind: 'string', value: 'hi' })
    expect(decodeLiteral(['WholeNumberLiteral', 42])).toEqual({ kind: 'whole-number', value: 42 })
    expect(decodeLiteral(['FloatLiteral', 2.5])).toEqual({ kind: 'float', value: 2.5 })
    expect(decodeLiteral(['DecimalLiteral', '10.01'])).toEqual({ kind: 'decimal', value: '10.01' })
  })
  test('unknown tag degrades to UnknownNode', () => {
    expect(decodeLiteral(['UuidLiteral', 'x'])).toEqual({ kind: 'unknown', tag: 'UuidLiteral', raw: ['UuidLiteral', 'x'] })
    expect(decodeLiteral(42)).toEqual({ kind: 'unknown', tag: '<malformed>', raw: 42 })
  })
})

describe('decodeTypeExpr', () => {
  test('decodes references with type arguments', () => {
    const listOfInt = ['Reference', {}, [[['morphir'], ['s', 'd', 'k']], [['list']], ['list']], [intRef]]
    const decoded = decodeTypeExpr(listOfInt)
    expect(decoded).toEqual({
      kind: 'type-reference',
      fqn: { pkg: [['morphir'], ['s', 'd', 'k']], module: [['list']], local: ['list'] },
      args: [{ kind: 'type-reference', fqn: { pkg: [['morphir'], ['s', 'd', 'k']], module: [['basics']], local: ['int'] }, args: [] }]
    })
  })
  test('decodes record fields (object form) and functions', () => {
    const rec = ['Record', {}, [{ name: ['age'], tpe: intRef }]]
    expect(decodeTypeExpr(rec)).toEqual({
      kind: 'type-record',
      fields: [{ name: ['age'], tpe: { kind: 'type-reference', fqn: { pkg: [['morphir'], ['s', 'd', 'k']], module: [['basics']], local: ['int'] }, args: [] } }]
    })
    const fn = ['Function', {}, intRef, intRef]
    const dfn = decodeTypeExpr(fn)
    expect(dfn.kind).toBe('type-function')
  })
  test('unit, tuple, variable, extensible record', () => {
    expect(decodeTypeExpr(['Unit', {}])).toEqual({ kind: 'type-unit' })
    expect(decodeTypeExpr(['Variable', {}, ['a']])).toEqual({ kind: 'type-variable', name: ['a'] })
    expect(decodeTypeExpr(['Tuple', {}, [intRef]]).kind).toBe('type-tuple')
    expect(decodeTypeExpr(['ExtensibleRecord', {}, ['r'], []]).kind).toBe('type-extensible-record')
  })
  test('unknown tag degrades', () => {
    expect(decodeTypeExpr(['Weird', {}, 1])).toEqual({ kind: 'unknown', tag: 'Weird', raw: ['Weird', {}, 1] })
  })
})

describe('decodePattern', () => {
  test('decodes all eight v3 pattern tags', () => {
    expect(decodePattern(['WildcardPattern', {}])).toEqual({ kind: 'wildcard' })
    expect(decodePattern(['AsPattern', {}, ['WildcardPattern', {}], ['x']])).toEqual({
      kind: 'as', inner: { kind: 'wildcard' }, name: ['x']
    })
    expect(decodePattern(['TuplePattern', {}, [['WildcardPattern', {}]]]).kind).toBe('pattern-tuple')
    const ctor = decodePattern(['ConstructorPattern', {}, [[['p']], [['m']], ['just']], [['WildcardPattern', {}]]])
    expect(ctor).toEqual({
      kind: 'constructor-pattern',
      fqn: { pkg: [['p']], module: [['m']], local: ['just'] },
      args: [{ kind: 'wildcard' }]
    })
    expect(decodePattern(['EmptyListPattern', {}])).toEqual({ kind: 'empty-list' })
    expect(decodePattern(['HeadTailPattern', {}, ['WildcardPattern', {}], ['EmptyListPattern', {}]]).kind).toBe('head-tail')
    expect(decodePattern(['LiteralPattern', {}, ['WholeNumberLiteral', 0]])).toEqual({
      kind: 'literal-pattern', literal: { kind: 'whole-number', value: 0 }
    })
    expect(decodePattern(['UnitPattern', {}])).toEqual({ kind: 'pattern-unit' })
  })
})

describe('fqNameFromRaw', () => {
  test('parses the 3-tuple and rejects malformed input', () => {
    expect(fqNameFromRaw([[['a']], [['b']], ['c']])).toEqual({ pkg: [['a']], module: [['b']], local: ['c'] })
    expect(fqNameFromRaw(['nope'])).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure** — `cd packages/morphir-ir && mise exec -- bun test test/ast-decode.test.ts` → FAIL (exports missing).

- [ ] **Step 3: Implement**

`src/ast.ts`:
```ts
import type { Name, Path } from './decode.ts'

export interface UnknownNode { readonly kind: 'unknown'; readonly tag: string; readonly raw: unknown }

export interface FQName { readonly pkg: Path; readonly module: Path; readonly local: Name }

export type Literal =
  | { readonly kind: 'bool'; readonly value: boolean }
  | { readonly kind: 'char'; readonly value: string }
  | { readonly kind: 'string'; readonly value: string }
  | { readonly kind: 'whole-number'; readonly value: number }
  | { readonly kind: 'float'; readonly value: number }
  | { readonly kind: 'decimal'; readonly value: string }
  | UnknownNode

export type TypeExpr =
  | { readonly kind: 'type-variable'; readonly name: Name }
  | { readonly kind: 'type-reference'; readonly fqn: FQName; readonly args: readonly TypeExpr[] }
  | { readonly kind: 'type-tuple'; readonly elements: readonly TypeExpr[] }
  | { readonly kind: 'type-record'; readonly fields: readonly { readonly name: Name; readonly tpe: TypeExpr }[] }
  | { readonly kind: 'type-extensible-record'; readonly variable: Name; readonly fields: readonly { readonly name: Name; readonly tpe: TypeExpr }[] }
  | { readonly kind: 'type-function'; readonly argument: TypeExpr; readonly result: TypeExpr }
  | { readonly kind: 'type-unit' }
  | UnknownNode

export type Pattern =
  | { readonly kind: 'wildcard' }
  | { readonly kind: 'as'; readonly inner: Pattern; readonly name: Name }
  | { readonly kind: 'pattern-tuple'; readonly elements: readonly Pattern[] }
  | { readonly kind: 'constructor-pattern'; readonly fqn: FQName; readonly args: readonly Pattern[] }
  | { readonly kind: 'empty-list' }
  | { readonly kind: 'head-tail'; readonly head: Pattern; readonly tail: Pattern }
  | { readonly kind: 'literal-pattern'; readonly literal: Literal }
  | { readonly kind: 'pattern-unit' }
  | UnknownNode
```

`src/ast-decode.ts`:
```ts
import type { Name } from './decode.ts'
import type { FQName, Literal, Pattern, TypeExpr, UnknownNode } from './ast.ts'

export const unknown = (raw: unknown): UnknownNode => ({
  kind: 'unknown',
  tag: Array.isArray(raw) && typeof raw[0] === 'string' ? raw[0] : '<malformed>',
  raw
})

const isName = (u: unknown): u is Name => Array.isArray(u) && u.every((p) => typeof p === 'string')
const isPath = (u: unknown): u is Name[] => Array.isArray(u) && u.every(isName)

export const fqNameFromRaw = (u: unknown): FQName | null => {
  if (!Array.isArray(u) || u.length !== 3) return null
  const [pkg, module, local] = u
  if (!isPath(pkg) || !isPath(module) || !isName(local)) return null
  return { pkg, module, local }
}

export const decodeLiteral = (u: unknown): Literal => {
  if (!Array.isArray(u) || typeof u[0] !== 'string') return unknown(u)
  const [tag, value] = u
  switch (tag) {
    case 'BoolLiteral': return typeof value === 'boolean' ? { kind: 'bool', value } : unknown(u)
    case 'CharLiteral': return typeof value === 'string' ? { kind: 'char', value } : unknown(u)
    case 'StringLiteral': return typeof value === 'string' ? { kind: 'string', value } : unknown(u)
    case 'WholeNumberLiteral': return typeof value === 'number' ? { kind: 'whole-number', value } : unknown(u)
    case 'FloatLiteral': return typeof value === 'number' ? { kind: 'float', value } : unknown(u)
    case 'DecimalLiteral': return typeof value === 'string' ? { kind: 'decimal', value } : unknown(u)
    default: return unknown(u)
  }
}

const decodeTypeFields = (u: unknown): { name: Name; tpe: TypeExpr }[] | null => {
  if (!Array.isArray(u)) return null
  const fields: { name: Name; tpe: TypeExpr }[] = []
  for (const f of u) {
    if (typeof f !== 'object' || f === null) return null
    const { name, tpe } = f as { name?: unknown; tpe?: unknown }
    if (!isName(name)) return null
    fields.push({ name, tpe: decodeTypeExpr(tpe) })
  }
  return fields
}

export const decodeTypeExpr = (u: unknown): TypeExpr => {
  if (!Array.isArray(u) || typeof u[0] !== 'string') return unknown(u)
  const tag = u[0]
  switch (tag) {
    case 'Variable': return isName(u[2]) ? { kind: 'type-variable', name: u[2] } : unknown(u)
    case 'Reference': {
      const fqn = fqNameFromRaw(u[2])
      if (!fqn || !Array.isArray(u[3])) return unknown(u)
      return { kind: 'type-reference', fqn, args: u[3].map(decodeTypeExpr) }
    }
    case 'Tuple': return Array.isArray(u[2]) ? { kind: 'type-tuple', elements: u[2].map(decodeTypeExpr) } : unknown(u)
    case 'Record': {
      const fields = decodeTypeFields(u[2])
      return fields ? { kind: 'type-record', fields } : unknown(u)
    }
    case 'ExtensibleRecord': {
      const fields = decodeTypeFields(u[3])
      return isName(u[2]) && fields ? { kind: 'type-extensible-record', variable: u[2], fields } : unknown(u)
    }
    case 'Function': return { kind: 'type-function', argument: decodeTypeExpr(u[2]), result: decodeTypeExpr(u[3]) }
    case 'Unit': return { kind: 'type-unit' }
    default: return unknown(u)
  }
}

export const decodePattern = (u: unknown): Pattern => {
  if (!Array.isArray(u) || typeof u[0] !== 'string') return unknown(u)
  const tag = u[0]
  switch (tag) {
    case 'WildcardPattern': return { kind: 'wildcard' }
    case 'AsPattern': return isName(u[3]) ? { kind: 'as', inner: decodePattern(u[2]), name: u[3] } : unknown(u)
    case 'TuplePattern': return Array.isArray(u[2]) ? { kind: 'pattern-tuple', elements: u[2].map(decodePattern) } : unknown(u)
    case 'ConstructorPattern': {
      const fqn = fqNameFromRaw(u[2])
      if (!fqn || !Array.isArray(u[3])) return unknown(u)
      return { kind: 'constructor-pattern', fqn, args: u[3].map(decodePattern) }
    }
    case 'EmptyListPattern': return { kind: 'empty-list' }
    case 'HeadTailPattern': return { kind: 'head-tail', head: decodePattern(u[2]), tail: decodePattern(u[3]) }
    case 'LiteralPattern': return { kind: 'literal-pattern', literal: decodeLiteral(u[2]) }
    case 'UnitPattern': return { kind: 'pattern-unit' }
    default: return unknown(u)
  }
}
```

Add to `src/index.ts`:
```ts
export * from './ast.ts'
export * from './ast-decode.ts'
```

- [ ] **Step 4: Run tests, verify pass** — `mise exec -- bun test && mise exec -- bun run typecheck` → PASS; root `mise exec -- bun run lint` clean.

- [ ] **Step 5: Commit**

```bash
git add packages/morphir-ir && git commit -s -m "feat(ir): decode v3 literals, patterns and type expressions"
```

---

### Task 3: Value expression and definition decoder (`@morphir/ir`)

**Files:**
- Modify: `packages/morphir-ir/src/ast.ts`, `src/ast-decode.ts`, `src/decode.ts` (carry raw definitions on entries), `src/index.ts`
- Test: `packages/morphir-ir/test/value-decode.test.ts`

**Interfaces:**
- Consumes: Task 2's `Literal/Pattern/TypeExpr/FQName/UnknownNode`, decoders, `unknown()`; Task 1's `insight-ir.json` definition names.
- Produces (consumed by Tasks 4–8):
  - `type ValueExpr =` 18 tagged variants + `UnknownNode` (exact union in Step 3; kinds: `literal, constructor, value-tuple, value-list, value-record, variable, value-reference, field, field-function, apply, lambda, let-definition, let-recursion, destructure, if-then-else, pattern-match, update-record, value-unit`) — every variant carries `attr: unknown`.
  - `interface ValueDef { inputs: { name: Name; attr: unknown; tpe: TypeExpr }[]; output: TypeExpr; body: ValueExpr }`
  - `decodeValueExpr(u: unknown): ValueExpr` (total), `decodeValueDef(u: unknown): ValueDef | null`
  - `uncurryApply(expr: ValueExpr): { fn: ValueExpr; args: ValueExpr[] }` — flattens nested `apply` nodes (function position first).
  - `RawDefEntry` gains `readonly rawDefinition: unknown` (the `Documented.value` payload) so entry bodies decode lazily: `decodeEntryValueDef(entry: RawDefEntry): ValueDef | null`.

**v3 encodings (verbatim reference):**
```
["Literal", va, Literal]  ["Constructor", va, FQName]  ["Tuple", va, [Value...]]
["List", va, [Value...]]  ["Record", va, [[Name, Value]...]]  (pairs, NOT objects)
["Variable", va, Name]    ["Reference", va, FQName]
["Field", va, subject, Name]  ["FieldFunction", va, Name]
["Apply", va, fn, arg]  (curried — ONE arg per node)
["Lambda", va, Pattern, body]
["LetDefinition", va, Name, ValueDefObj, inValue]
["LetRecursion", va, [[Name, ValueDefObj]...], inValue]
["Destructure", va, Pattern, value, inValue]
["IfThenElse", va, cond, then, else]
["PatternMatch", va, subject, [[Pattern, body]...]]  (pairs)
["UpdateRecord", va, subject, [[Name, Value]...]]  (pairs)
["Unit", va]
ValueDefObj = { "inputTypes": [[Name, attr, Type]...], "outputType": Type, "body": Value }
Module value entry = [Name, {access, value: {doc, value: ValueDefObj}}]
```

- [ ] **Step 1: Write the failing tests**

`packages/morphir-ir/test/value-decode.test.ts`:
```ts
import { describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import {
  decodeMorphirIr, decodeEntryValueDef, decodeValueExpr, uncurryApply,
  nameToCamel, type RawDefEntry, type ValueExpr
} from '../src/index.ts'

const loadFixture = async () => {
  const text = await Bun.file(new URL('./fixtures/insight-ir.json', import.meta.url)).text()
  const lib = await Effect.runPromise(decodeMorphirIr(text))
  const values = new Map<string, RawDefEntry>()
  for (const entry of lib.modules[0]!.values) values.set(nameToCamel(entry.name), entry)
  return values
}

const walkForUnknown = (e: ValueExpr, found: string[]): void => {
  if (e.kind === 'unknown') { found.push(e.tag); return }
  for (const v of Object.values(e)) {
    if (Array.isArray(v)) v.forEach((x) => walkMaybe(x, found))
    else walkMaybe(v, found)
  }
}
const walkMaybe = (v: unknown, found: string[]): void => {
  if (typeof v === 'object' && v !== null && 'kind' in v) {
    const k = (v as { kind: string }).kind
    if (k === 'unknown') found.push((v as { tag: string }).tag)
    else if (!k.startsWith('type-')) walkForUnknown(v as ValueExpr, found)
  }
}

describe('decodeValueExpr against unit snippets', () => {
  test('literal with full type attribute', () => {
    const raw = ['Literal', ['Reference', {}, [[['morphir'], ['s', 'd', 'k']], [['basics']], ['int']], []], ['WholeNumberLiteral', 0]]
    const d = decodeValueExpr(raw)
    expect(d.kind).toBe('literal')
    if (d.kind === 'literal') expect(d.literal).toEqual({ kind: 'whole-number', value: 0 })
  })
  test('record fields are name/value pairs', () => {
    const raw = ['Record', {}, [[['age'], ['Literal', {}, ['WholeNumberLiteral', 36]]]]]
    const d = decodeValueExpr(raw)
    expect(d.kind).toBe('value-record')
    if (d.kind === 'value-record') {
      expect(d.fields[0]!.name).toEqual(['age'])
      expect(d.fields[0]!.value.kind).toBe('literal')
    }
  })
  test('unknown tag degrades without throwing', () => {
    expect(decodeValueExpr(['Mystery', {}, 1]).kind).toBe('unknown')
  })
})

describe('decoding the insight fixture', () => {
  test('all 21 definitions decode with zero unknown nodes', async () => {
    const values = await loadFixture()
    expect(values.size).toBe(21)
    for (const [name, entry] of values) {
      const def = decodeEntryValueDef(entry)
      expect(def, name).not.toBeNull()
      const found: string[] = []
      walkForUnknown(def!.body, found)
      expect(found, `${name} contains unknown tags: ${found.join(',')}`).toEqual([])
    }
  })

  test('chainedArithmetic uncurries to add applied twice', async () => {
    const values = await loadFixture()
    const def = decodeEntryValueDef(values.get('chainedArithmetic')!)!
    const { fn, args } = uncurryApply(def.body)
    expect(fn.kind).toBe('value-reference')
    if (fn.kind === 'value-reference') expect(fn.fqn.local).toEqual(['add'])
    expect(args).toHaveLength(2)
  })

  test('gradeIf decodes as a nested if-then-else chain', async () => {
    const values = await loadFixture()
    const def = decodeEntryValueDef(values.get('gradeIf')!)!
    expect(def.body.kind).toBe('if-then-else')
    if (def.body.kind === 'if-then-else') expect(def.body.elseBranch.kind).toBe('if-then-else')
  })

  test('tupleCase decodes as pattern-match with tuple patterns', async () => {
    const values = await loadFixture()
    const def = decodeEntryValueDef(values.get('tupleCase')!)!
    expect(def.body.kind).toBe('pattern-match')
    if (def.body.kind === 'pattern-match') {
      expect(def.body.cases.length).toBe(3)
      expect(def.body.cases[0]!.pattern.kind).toBe('pattern-tuple')
    }
  })

  test('letBound decodes nested let-definitions with input metadata', async () => {
    const values = await loadFixture()
    const def = decodeEntryValueDef(values.get('letBound')!)!
    expect(def.inputs).toHaveLength(1)
    expect(def.inputs[0]!.name).toEqual(['x'])
    expect(def.body.kind).toBe('let-definition')
  })

  test('updatedPerson decodes update-record with pair fields', async () => {
    const values = await loadFixture()
    const def = decodeEntryValueDef(values.get('updatedPerson')!)!
    expect(def.body.kind).toBe('update-record')
    if (def.body.kind === 'update-record') expect(def.body.fields[0]!.name).toEqual(['age'])
  })
})
```

- [ ] **Step 2: Run to verify failure** — `cd packages/morphir-ir && mise exec -- bun test test/value-decode.test.ts` → FAIL.

- [ ] **Step 3: Implement**

Append to `src/ast.ts`:
```ts
export interface ValueDefInput { readonly name: Name; readonly attr: unknown; readonly tpe: TypeExpr }
export interface ValueDef {
  readonly inputs: readonly ValueDefInput[]
  readonly output: TypeExpr
  readonly body: ValueExpr
}

export type ValueExpr =
  | { readonly kind: 'literal'; readonly attr: unknown; readonly literal: Literal }
  | { readonly kind: 'constructor'; readonly attr: unknown; readonly fqn: FQName }
  | { readonly kind: 'value-tuple'; readonly attr: unknown; readonly elements: readonly ValueExpr[] }
  | { readonly kind: 'value-list'; readonly attr: unknown; readonly items: readonly ValueExpr[] }
  | { readonly kind: 'value-record'; readonly attr: unknown; readonly fields: readonly { readonly name: Name; readonly value: ValueExpr }[] }
  | { readonly kind: 'variable'; readonly attr: unknown; readonly name: Name }
  | { readonly kind: 'value-reference'; readonly attr: unknown; readonly fqn: FQName }
  | { readonly kind: 'field'; readonly attr: unknown; readonly subject: ValueExpr; readonly name: Name }
  | { readonly kind: 'field-function'; readonly attr: unknown; readonly name: Name }
  | { readonly kind: 'apply'; readonly attr: unknown; readonly fn: ValueExpr; readonly arg: ValueExpr }
  | { readonly kind: 'lambda'; readonly attr: unknown; readonly pattern: Pattern; readonly body: ValueExpr }
  | { readonly kind: 'let-definition'; readonly attr: unknown; readonly name: Name; readonly definition: ValueDef; readonly inValue: ValueExpr }
  | { readonly kind: 'let-recursion'; readonly attr: unknown; readonly definitions: readonly { readonly name: Name; readonly definition: ValueDef }[]; readonly inValue: ValueExpr }
  | { readonly kind: 'destructure'; readonly attr: unknown; readonly pattern: Pattern; readonly value: ValueExpr; readonly inValue: ValueExpr }
  | { readonly kind: 'if-then-else'; readonly attr: unknown; readonly condition: ValueExpr; readonly thenBranch: ValueExpr; readonly elseBranch: ValueExpr }
  | { readonly kind: 'pattern-match'; readonly attr: unknown; readonly subject: ValueExpr; readonly cases: readonly { readonly pattern: Pattern; readonly body: ValueExpr }[] }
  | { readonly kind: 'update-record'; readonly attr: unknown; readonly subject: ValueExpr; readonly fields: readonly { readonly name: Name; readonly value: ValueExpr }[] }
  | { readonly kind: 'value-unit'; readonly attr: unknown }
  | UnknownNode
```

Append to `src/ast-decode.ts` (imports extend accordingly):
```ts
const namedPairs = <T>(u: unknown, decodeSecond: (x: unknown) => T): { name: Name; value: T }[] | null => {
  if (!Array.isArray(u)) return null
  const out: { name: Name; value: T }[] = []
  for (const p of u) {
    if (!Array.isArray(p) || p.length !== 2 || !isName(p[0])) return null
    out.push({ name: p[0], value: decodeSecond(p[1]) })
  }
  return out
}

export const decodeValueDef = (u: unknown): ValueDef | null => {
  if (typeof u !== 'object' || u === null) return null
  const { inputTypes, outputType, body } = u as { inputTypes?: unknown; outputType?: unknown; body?: unknown }
  if (!Array.isArray(inputTypes)) return null
  const inputs: ValueDefInput[] = []
  for (const row of inputTypes) {
    if (!Array.isArray(row) || row.length !== 3 || !isName(row[0])) return null
    inputs.push({ name: row[0], attr: row[1], tpe: decodeTypeExpr(row[2]) })
  }
  return { inputs, output: decodeTypeExpr(outputType), body: decodeValueExpr(body) }
}

export const decodeValueExpr = (u: unknown): ValueExpr => {
  if (!Array.isArray(u) || typeof u[0] !== 'string') return unknown(u)
  const tag = u[0]
  const attr = u[1]
  switch (tag) {
    case 'Literal': return { kind: 'literal', attr, literal: decodeLiteral(u[2]) }
    case 'Constructor': {
      const fqn = fqNameFromRaw(u[2])
      return fqn ? { kind: 'constructor', attr, fqn } : unknown(u)
    }
    case 'Tuple': return Array.isArray(u[2]) ? { kind: 'value-tuple', attr, elements: u[2].map(decodeValueExpr) } : unknown(u)
    case 'List': return Array.isArray(u[2]) ? { kind: 'value-list', attr, items: u[2].map(decodeValueExpr) } : unknown(u)
    case 'Record': {
      const fields = namedPairs(u[2], decodeValueExpr)
      return fields ? { kind: 'value-record', attr, fields } : unknown(u)
    }
    case 'Variable': return isName(u[2]) ? { kind: 'variable', attr, name: u[2] } : unknown(u)
    case 'Reference': {
      const fqn = fqNameFromRaw(u[2])
      return fqn ? { kind: 'value-reference', attr, fqn } : unknown(u)
    }
    case 'Field': return isName(u[3]) ? { kind: 'field', attr, subject: decodeValueExpr(u[2]), name: u[3] } : unknown(u)
    case 'FieldFunction': return isName(u[2]) ? { kind: 'field-function', attr, name: u[2] } : unknown(u)
    case 'Apply': return { kind: 'apply', attr, fn: decodeValueExpr(u[2]), arg: decodeValueExpr(u[3]) }
    case 'Lambda': return { kind: 'lambda', attr, pattern: decodePattern(u[2]), body: decodeValueExpr(u[3]) }
    case 'LetDefinition': {
      const definition = decodeValueDef(u[3])
      return isName(u[2]) && definition
        ? { kind: 'let-definition', attr, name: u[2], definition, inValue: decodeValueExpr(u[4]) }
        : unknown(u)
    }
    case 'LetRecursion': {
      if (!Array.isArray(u[2])) return unknown(u)
      const definitions: { name: Name; definition: ValueDef }[] = []
      for (const p of u[2]) {
        if (!Array.isArray(p) || !isName(p[0])) return unknown(u)
        const definition = decodeValueDef(p[1])
        if (!definition) return unknown(u)
        definitions.push({ name: p[0], definition })
      }
      return { kind: 'let-recursion', attr, definitions, inValue: decodeValueExpr(u[3]) }
    }
    case 'Destructure':
      return { kind: 'destructure', attr, pattern: decodePattern(u[2]), value: decodeValueExpr(u[3]), inValue: decodeValueExpr(u[4]) }
    case 'IfThenElse':
      return { kind: 'if-then-else', attr, condition: decodeValueExpr(u[2]), thenBranch: decodeValueExpr(u[3]), elseBranch: decodeValueExpr(u[4]) }
    case 'PatternMatch': {
      if (!Array.isArray(u[3])) return unknown(u)
      const cases = u[3].map((p: unknown) =>
        Array.isArray(p) && p.length === 2
          ? { pattern: decodePattern(p[0]), body: decodeValueExpr(p[1]) }
          : { pattern: decodePattern(undefined), body: decodeValueExpr(p) }
      )
      return { kind: 'pattern-match', attr, subject: decodeValueExpr(u[2]), cases }
    }
    case 'UpdateRecord': {
      const fields = namedPairs(u[3], decodeValueExpr)
      return fields ? { kind: 'update-record', attr, subject: decodeValueExpr(u[2]), fields } : unknown(u)
    }
    case 'Unit': return { kind: 'value-unit', attr }
    default: return unknown(u)
  }
}

export const uncurryApply = (expr: ValueExpr): { fn: ValueExpr; args: ValueExpr[] } => {
  const args: ValueExpr[] = []
  let current = expr
  while (current.kind === 'apply') {
    args.unshift(current.arg)
    current = current.fn
  }
  return { fn: current, args }
}
```

Modify `src/decode.ts` — `readDefEntry` keeps the raw definition payload. Change the return and its interface:
```ts
export interface RawDefEntry {
  readonly name: Name
  readonly access: Access
  readonly doc: string | null
  readonly rawDefinition: unknown          // NEW: the Documented.value payload
}
```
and in `readDefEntry`, after computing `doc`:
```ts
  const rawDefinition =
    documented && typeof documented === 'object' && 'value' in documented
      ? (documented as { value: unknown }).value
      : undefined
  return { name: entry[0], access: ac['access'], doc, rawDefinition }
```
Add to `src/ast-decode.ts`:
```ts
export const decodeEntryValueDef = (entry: { rawDefinition: unknown }): ValueDef | null =>
  decodeValueDef(entry.rawDefinition)
```

- [ ] **Step 4: Run all package tests, verify pass** — `mise exec -- bun test && mise exec -- bun run typecheck`; root `mise exec -- bun run lint`. All existing envelope/explorer tests must stay green (the `RawDefEntry` change is additive).

- [ ] **Step 5: Commit**

```bash
git add packages/morphir-ir && git commit -s -m "feat(ir): decode the full v3 value expression tree and definitions"
```

---

### Task 4: XRay view and definition-detail tabs (`@morphir/ui`)

**Files:**
- Create: `packages/morphir-ui/src/views/insight/DetailTabs.svelte`, `src/views/insight/XRayNode.svelte`, `src/views/insight/XRayView.svelte`, `src/views/insight/DefinitionDetail.svelte`
- Modify: `packages/morphir-ui/src/state/workspace-state.svelte.ts` (keep the raw library), `src/views/IrExplorerView.svelte` (definition selection → detail surface), `src/index.ts`
- Test: `packages/morphir-ui/test/xray.test.ts`; extend `test/ir-explorer.test.ts`

**Interfaces:**
- Consumes: `decodeEntryValueDef`, `decodeTypeExpr`, `ValueDef`, `ValueExpr`, `TypeExpr`, `MorphirLibrary`, `RawDefEntry`, `nameToCamel`, `nameToTitle`, `pathToTitle` (@morphir/ir).
- Produces:
  - `OpenWorkspace` gains `readonly library: MorphirLibrary` (WorkspaceState `#ingest` stores the decoded library alongside the display model — one decode, both consumers).
  - `DetailTabs.svelte` props: `{ tabs: { id: string; label: string }[]; active: string; onSelect: (id: string) => void }`.
  - `XRayView.svelte` props: `{ def: ValueDef | null; typeRaw?: unknown }` — renders the AST tree; for types renders `decodeTypeExpr(typeRaw)`.
  - `XRayNode.svelte` props: `{ node: unknown; label?: string }` — recursive; renders `kind`, scalar fields inline, child nodes/arrays via native `<details open>` disclosure; `unknown` kinds render tag + a muted `raw unavailable in xray` marker (never JSON.stringify of raw — it can be huge).
  - `DefinitionDetail.svelte` props: `{ entry: RawDefEntry; kind: 'type' | 'value'; moduleName: string; packageName: string }` — value tabs `[insight (added Task 8), xray]`, type tabs `[type, xray]`; THIS task renders only the XRay tab for values (single tab) and Type|XRay for types where the Type tab shows `nameToTitle` + decoded type via XRayNode (a structured type rendering is acceptable as the Type tab this cycle).
  - `IrExplorerView` gains `selectedDef: { info: DefinitionInfo; entry: RawDefEntry } | null` selection state; clicking a definition row opens `DefinitionDetail` in place of the definitions list (with a Back row reusing the settings-sidebar back pattern); entry lookup goes through the stored `library` by module path + local name.

- [ ] **Step 1: Write the failing tests**

`packages/morphir-ui/test/xray.test.ts`:
```ts
import { render, screen, cleanup } from '@testing-library/svelte'
import { afterEach, describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Effect } from 'effect'
import XRayView from '../src/views/insight/XRayView.svelte'
import { decodeMorphirIr, decodeEntryValueDef, nameToCamel } from '@morphir/ir'

afterEach(() => cleanup())

const fixture = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../morphir-ir/test/fixtures/insight-ir.json'),
  'utf8'
)

const defByName = async (name: string) => {
  const lib = await Effect.runPromise(decodeMorphirIr(fixture))
  const entry = lib.modules[0]!.values.find((v) => nameToCamel(v.name) === name)!
  return decodeEntryValueDef(entry)!
}

describe('XRayView', () => {
  test('renders the node kinds of a simple arithmetic body', async () => {
    render(XRayView, { props: { def: await defByName('chainedArithmetic') } })
    expect(screen.getAllByText('apply').length).toBeGreaterThan(0)
    expect(screen.getAllByText('value-reference').length).toBeGreaterThan(0)
    expect(screen.getAllByText('variable').length).toBeGreaterThan(0)
  })

  test('renders inputs and output sections', async () => {
    render(XRayView, { props: { def: await defByName('gradeIf') } })
    expect(screen.getByText('inputs')).toBeTruthy()
    expect(screen.getByText('output')).toBeTruthy()
    expect(screen.getAllByText('if-then-else').length).toBeGreaterThan(0)
  })

  test('unknown nodes render the fallback marker', async () => {
    render(XRayView, {
      props: { def: { inputs: [], output: { kind: 'type-unit' }, body: { kind: 'unknown', tag: 'Mystery', raw: null } } }
    })
    expect(screen.getByText(/Mystery/)).toBeTruthy()
  })

  test('null def renders an empty state', () => {
    render(XRayView, { props: { def: null } })
    expect(screen.getByText(/could not be decoded/i)).toBeTruthy()
  })
})
```

Extend `packages/morphir-ui/test/ir-explorer.test.ts` with (append inside the existing describe; keep existing tests unchanged):
```ts
  test('clicking a definition opens the detail surface with an XRay tab', async () => {
    render(IrExplorerView, { props: { workspace: await openWorkspace() } })
    await userEvent.click(screen.getByText('listExample'))
    expect(screen.getByText('XRay')).toBeTruthy()
    expect(screen.getAllByText('value-list').length).toBeGreaterThan(0)
    await userEvent.click(screen.getByText('Back'))
    expect(screen.getByPlaceholderText('Filter definitions')).toBeTruthy()
  })
```

- [ ] **Step 2: Run to verify failure** — `cd packages/morphir-ui && mise exec -- bun run test` → FAIL (components missing; workspace-state lacks `library`).

- [ ] **Step 3: Implement**

`workspace-state.svelte.ts` — extend `OpenWorkspace` and `#ingest`:
```ts
export interface OpenWorkspace { readonly ref: WorkspaceRef; readonly ir: WorkspaceIr; readonly library: MorphirLibrary }
// in #ingest success path:
this.current = { ref, ir: toWorkspaceIr(exit.value), library: exit.value }
```
(import `MorphirLibrary` type from @morphir/ir.)

`DetailTabs.svelte`:
```svelte
<script lang="ts">
  let {
    tabs,
    active,
    onSelect
  }: { tabs: { id: string; label: string }[]; active: string; onSelect: (id: string) => void } = $props()
</script>

<div class="tabs" role="tablist">
  {#each tabs as tab (tab.id)}
    <button class="tab" class:active={tab.id === active} role="tab" aria-selected={tab.id === active} onclick={() => onSelect(tab.id)}>
      {tab.label}
    </button>
  {/each}
</div>

<style>
  .tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--edge); margin-bottom: 12px; }
  .tab {
    padding: 6px 14px; border: none; background: none; color: var(--muted);
    font-size: 13px; font-weight: 500; cursor: pointer;
    border-bottom: 2px solid transparent;
  }
  .tab:hover { color: var(--text); }
  .tab.active { color: var(--text-strong); border-bottom-color: var(--accent); }
</style>
```

`XRayNode.svelte`:
```svelte
<script lang="ts">
  import XRayNode from './XRayNode.svelte'
  let { node, label = '' }: { node: unknown; label?: string } = $props()

  const isAstNode = (v: unknown): v is Record<string, unknown> & { kind: string } =>
    typeof v === 'object' && v !== null && 'kind' in v

  const children = $derived.by(() => {
    if (!isAstNode(node)) return []
    const out: { label: string; value: unknown }[] = []
    for (const [key, value] of Object.entries(node)) {
      if (key === 'kind' || key === 'attr' || key === 'raw') continue
      if (Array.isArray(value)) value.forEach((v, i) => out.push({ label: `${key}[${i}]`, value: v }))
      else if (isAstNode(value)) out.push({ label: key, value })
      else out.push({ label: key, value })
    }
    return out
  })
  const scalar = (v: unknown) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
</script>

{#if isAstNode(node)}
  <details open class="xray-node">
    <summary>
      {#if label}<span class="label">{label}:</span>{/if}
      <span class="kind" class:unknown={node.kind === 'unknown'}>{node.kind}</span>
      {#if node.kind === 'unknown'}<span class="tag">{String(node['tag'])}</span>{/if}
    </summary>
    <div class="children">
      {#each children as child (child.label)}
        {#if scalar(child.value) || Array.isArray(child.value)}
          <div class="scalar"><span class="label">{child.label}:</span> <span class="value">{JSON.stringify(child.value)}</span></div>
        {:else}
          <XRayNode node={child.value} label={child.label} />
        {/if}
      {/each}
    </div>
  </details>
{:else}
  <div class="scalar">{#if label}<span class="label">{label}:</span>{/if} <span class="value">{JSON.stringify(node)}</span></div>
{/if}

<style>
  .xray-node { font-family: var(--mono); font-size: 12.5px; }
  summary { cursor: pointer; padding: 1px 0; }
  .kind { color: var(--accent2); font-weight: 600; }
  .kind.unknown { color: var(--accent); }
  .tag { color: var(--muted); margin-left: 6px; }
  .label { color: var(--muted2); }
  .value { color: var(--text); }
  .children { padding-left: 18px; border-left: 1px solid var(--row-edge); margin-left: 4px; }
  .scalar { padding: 1px 0; font-family: var(--mono); font-size: 12.5px; }
</style>
```
(Scalars stringify only names/paths/literal values — `attr` and `raw` are explicitly skipped, keeping output bounded.)

`XRayView.svelte`:
```svelte
<script lang="ts">
  import XRayNode from './XRayNode.svelte'
  import { decodeTypeExpr, type ValueDef } from '@morphir/ir'
  let { def = null, typeRaw = undefined }: { def?: ValueDef | null; typeRaw?: unknown } = $props()
</script>

{#if typeRaw !== undefined}
  <XRayNode node={decodeTypeExpr(typeRaw)} />
{:else if def}
  <div class="section">inputs</div>
  {#each def.inputs as input (JSON.stringify(input.name))}
    <XRayNode node={input.tpe} label={input.name.join('-')} />
  {/each}
  <div class="section">output</div>
  <XRayNode node={def.output} />
  <div class="section">body</div>
  <XRayNode node={def.body} />
{:else}
  <p class="empty">This definition could not be decoded.</p>
{/if}

<style>
  .section {
    font-family: var(--mono); font-size: 10px; font-weight: 600; letter-spacing: 0.16em;
    text-transform: uppercase; color: var(--muted2); margin: 10px 0 4px 0;
  }
  .empty { color: var(--muted); font-size: 13px; }
</style>
```

`DefinitionDetail.svelte`:
```svelte
<script lang="ts">
  import DetailTabs from './DetailTabs.svelte'
  import XRayView from './XRayView.svelte'
  import { decodeEntryValueDef, nameToCamel, nameToTitle, type RawDefEntry } from '@morphir/ir'

  let {
    entry,
    kind,
    moduleName,
    packageName
  }: { entry: RawDefEntry; kind: 'type' | 'value'; moduleName: string; packageName: string } = $props()

  const displayName = $derived(kind === 'value' ? nameToCamel(entry.name) : nameToTitle(entry.name))
  const tabs = $derived(kind === 'value' ? [{ id: 'xray', label: 'XRay' }] : [{ id: 'type', label: 'Type' }, { id: 'xray', label: 'XRay' }])
  let active = $state('xray')
  $effect(() => { active = tabs[0]!.id })
  const def = $derived(kind === 'value' ? decodeEntryValueDef(entry) : null)
</script>

<section class="card">
  <header class="head">
    <span class="fqn">{packageName}.{moduleName}.<span class="local">{displayName}</span></span>
    {#if entry.doc}<span class="doc">{entry.doc}</span>{/if}
  </header>
  <DetailTabs {tabs} {active} onSelect={(id) => (active = id)} />
  {#if active === 'xray' && kind === 'value'}
    <XRayView {def} />
  {:else}
    <XRayView typeRaw={entry.rawDefinition} />
  {/if}
</section>

<style>
  .card { background: var(--panel); border: 1px solid var(--panel-edge); border-radius: 10px; padding: 16px; }
  .head { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
  .fqn { font-family: var(--mono); font-size: 12.5px; color: var(--muted); }
  .local { color: var(--text-strong); }
  .doc { font-size: 12.5px; color: var(--muted); }
</style>
```
(For the Type tab this cycle, structured XRay of the type definition satisfies the spec's "Type | XRay" — a prettier type renderer is future polish; the type's raw definition decodes via `decodeTypeExpr` on the payload's inner type where shaped as `["TypeAliasDefinition", params, type]` — pass `entry.rawDefinition` and let `XRayNode`'s unknown-fallback handle custom-type definitions.)

`IrExplorerView.svelte` — add selection state and detail surface. Modify the script:
```ts
  import DefinitionDetail from './insight/DefinitionDetail.svelte'
  import Icon from '../icons/Icon.svelte'
  import { type RawDefEntry } from '@morphir/ir'

  let selected = $state<{ info: (typeof definitions)[number]; entry: RawDefEntry } | null>(null)

  const findEntry = (moduleName: string, localName: string, kind: 'type' | 'value'): RawDefEntry | null => {
    const lib = workspace.current?.library
    if (!lib) return null
    for (const m of lib.modules) {
      // module display name must match the explorer's derived name
      // (import pathToTitle from @morphir/ir at the top of the script)
      if (pathToTitle(m.path) !== moduleName) continue
      const entries = kind === 'type' ? m.types : m.values
      for (const e of entries) {
        const display = kind === 'type' ? nameToTitle(e.name) : nameToCamel(e.name)
        if (display === localName) return e
      }
    }
    return null
  }
```
and in the markup, replace the Definitions card body with:
```svelte
  {#if selected}
    <button class="back" onclick={() => (selected = null)}><Icon name="back" /> Back</button>
    <DefinitionDetail
      entry={selected.entry}
      kind={selected.info.kind}
      moduleName={selected.info.ref.moduleName}
      packageName={selected.info.ref.packageName}
    />
  {:else}
    <!-- existing filter row + definitions list, with each row becoming a button: -->
    {#each definitions as d (d.ref.localName + d.kind)}
      <button
        class="def"
        onclick={() => {
          const entry = findEntry(d.ref.moduleName, d.ref.localName, d.kind)
          if (entry) selected = { info: d, entry }
        }}
      >
        <span class="def-name">{d.ref.localName}</span>
        <span class="def-kind">{d.kind}</span>
        <span class="def-access">{d.access}</span>
        {#if d.doc}<span class="def-doc">{d.doc}</span>{/if}
      </button>
    {:else}
      <p class="muted">No definitions match.</p>
    {/each}
  {/if}
```
with `.def` restyled as a full-width button (background none, existing row styling preserved, cursor pointer) and `.back` reusing the settings back-row styling (gap 7px, padding, hover var(--hover)).

Add to `src/index.ts`:
```ts
export { default as XRayView } from './views/insight/XRayView.svelte'
export { default as DefinitionDetail } from './views/insight/DefinitionDetail.svelte'
```

- [ ] **Step 4: Run tests, verify pass** — `mise exec -- bun run test && mise exec -- bun run typecheck`; root lint + full moon run green.

- [ ] **Step 5: Commit**

```bash
git add packages/morphir-ui && git commit -s -m "feat(ui): xray view and definition detail tabs in the ir explorer"
```

---

### Task 5: `@morphir/insight` scaffold, ViewNode vocabulary, structural transform

**Files:**
- Create: `packages/morphir-insight/package.json`, `moon.yml`, `tsconfig.json`, `src/index.ts`, `src/view-node.ts`, `src/context.ts`, `src/pattern-text.ts`, `src/transform.ts`
- Test: `packages/morphir-insight/test/transform-structural.test.ts`

**Interfaces:**
- Consumes: `ValueExpr`, `ValueDef`, `Pattern`, `Literal`, `FQName`, `MorphirLibrary`, `uncurryApply`, `nameToCamel`, `nameToTitle`, `pathToTitle`, `decodeEntryValueDef` (@morphir/ir).
- Produces (consumed by Tasks 6–8):
  - The full `ViewNode` union (Step 3 — kinds: `v-literal, v-variable, v-record, v-update-record, v-list, v-tuple, v-field-access, v-constructor, v-arith-chain, v-fraction, v-logic-chain, v-binary-op, v-prefix-call, v-power, v-member-of, v-pipeline, v-if-tree, v-decision-table, v-lambda, v-let-group, v-reference, v-unit, v-unknown`) and `ViewCell`. This refines the spec's indicative vocabulary; the spec's "pattern-branches" is realized by `v-if-tree` branches and `v-decision-table` rows (morphir-elm routes ALL pattern matches to tables — extraction finding).
  - `interface InsightContext { readonly library: MorphirLibrary; readonly expanded: ReadonlySet<string>; readonly path: readonly string[] }` and `makeContext(library, expanded?)`.
  - `fqnKey(fqn: FQName): string` — `pkg|module|local` joined with `:` on dot-joined title paths (stable expansion-set key).
  - `isSdkFqn(fqn: FQName): boolean` — pkg === `[["morphir"],["s","d","k"]]`.
  - `patternToText(p: Pattern): string` — `_` for wildcard, bound name for as-wildcard, literal text, `Title(a, b)` for constructors, `(a, b)` tuples, `[]`, `head :: tail`, `()`.
  - `literalText(l: Literal): string` — `"str"` quoted, chars quoted `'c'`, numbers plain, bools `True/False`, decimals verbatim.
  - `toViewTree(def: ValueDef, ctx: InsightContext): ViewNode` — THIS task implements the structural kinds and a generic-call path; Tasks 6–7 extend the dispatch (the file is organized so those tasks add cases, not rewrite).

- [ ] **Step 1: Package scaffold**

`packages/morphir-insight/package.json`:
```json
{
  "name": "@morphir/insight",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "lint": "eslint src test",
    "typecheck": "tsc --noEmit",
    "test": "bun test",
    "build": "tsc --noEmit",
    "gen:goldens": "bun scripts/gen-goldens.ts"
  },
  "dependencies": { "@morphir/ir": "workspace:*", "effect": "^3.22.1" },
  "devDependencies": { "bun-types": "^1.4.0", "typescript": "7.0.2" }
}
```
(TS 7 local pin — pure-TS package, same ruling as @morphir/ir. `gen:goldens` arrives in Task 6; declaring the script now is inert.)

`packages/morphir-insight/moon.yml`:
```yaml
$schema: 'https://moonrepo.dev/schemas/project.json'
layer: 'library'
language: 'typescript'
```

`packages/morphir-insight/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["bun-types"] },
  "include": ["src", "test", "scripts"]
}
```
Run root `mise exec -- bun install` after creating package.json so the workspace links it.

- [ ] **Step 2: Write the failing tests**

`packages/morphir-insight/test/transform-structural.test.ts`:
```ts
import { describe, expect, test } from 'bun:test'
import type { ValueDef, ValueExpr } from '@morphir/ir'
import { makeContext, patternToText, toViewTree } from '../src/index.ts'
import type { MorphirLibrary } from '@morphir/ir'

const emptyLib: MorphirLibrary = { packageName: [['test']], modules: [] }
const ctx = () => makeContext(emptyLib)
const lit = (n: number): ValueExpr => ({ kind: 'literal', attr: {}, literal: { kind: 'whole-number', value: n } })
const def = (body: ValueExpr): ValueDef => ({ inputs: [], output: { kind: 'type-unit' }, body })

describe('structural transform', () => {
  test('literals format by kind', () => {
    expect(toViewTree(def(lit(42)), ctx())).toEqual({ kind: 'v-literal', text: '42', literalKind: 'whole-number' })
    expect(toViewTree(def({ kind: 'literal', attr: {}, literal: { kind: 'string', value: 'hi' } }), ctx()))
      .toEqual({ kind: 'v-literal', text: '"hi"', literalKind: 'string' })
    expect(toViewTree(def({ kind: 'literal', attr: {}, literal: { kind: 'bool', value: true } }), ctx()))
      .toEqual({ kind: 'v-literal', text: 'True', literalKind: 'bool' })
  })

  test('records, lists, tuples, field access', () => {
    const rec = toViewTree(def({ kind: 'value-record', attr: {}, fields: [{ name: ['age'], value: lit(1) }] }), ctx())
    expect(rec).toEqual({ kind: 'v-record', fields: [{ name: 'age', value: { kind: 'v-literal', text: '1', literalKind: 'whole-number' } }] })
    expect(toViewTree(def({ kind: 'value-list', attr: {}, items: [lit(1), lit(2)] }), ctx()).kind).toBe('v-list')
    expect(toViewTree(def({ kind: 'value-tuple', attr: {}, elements: [lit(1)] }), ctx()).kind).toBe('v-tuple')
    const fa = toViewTree(def({ kind: 'field', attr: {}, subject: { kind: 'variable', attr: {}, name: ['p'] }, name: ['age'] }), ctx())
    expect(fa).toEqual({ kind: 'v-field-access', subject: { kind: 'v-variable', name: 'p' }, field: 'age' })
  })

  test('lambda and let-group', () => {
    const lam = toViewTree(def({ kind: 'lambda', attr: {}, pattern: { kind: 'as', inner: { kind: 'wildcard' }, name: ['y'] }, body: lit(1) }), ctx())
    expect(lam).toEqual({ kind: 'v-lambda', pattern: 'y', body: { kind: 'v-literal', text: '1', literalKind: 'whole-number' } })
    const letNode = toViewTree(def({
      kind: 'let-definition', attr: {}, name: ['doubled'],
      definition: { inputs: [], output: { kind: 'type-unit' }, body: lit(2) },
      inValue: { kind: 'let-definition', attr: {}, name: ['offset'], definition: { inputs: [], output: { kind: 'type-unit' }, body: lit(3) }, inValue: { kind: 'variable', attr: {}, name: ['offset'] } }
    }), ctx())
    // consecutive let-definitions flatten into ONE v-let-group
    expect(letNode).toEqual({
      kind: 'v-let-group',
      bindings: [
        { name: 'doubled', value: { kind: 'v-literal', text: '2', literalKind: 'whole-number' } },
        { name: 'offset', value: { kind: 'v-literal', text: '3', literalKind: 'whole-number' } }
      ],
      body: { kind: 'v-variable', name: 'offset' }
    })
  })

  test('non-SDK reference is expandable and collapsed by default; SDK plain reference is not expandable', () => {
    const userRef = toViewTree(def({ kind: 'value-reference', attr: {}, fqn: { pkg: [['my'], ['pkg']], module: [['mod']], local: ['helper'] } }), ctx())
    expect(userRef).toEqual({ kind: 'v-reference', fqn: { pkg: [['my'], ['pkg']], module: [['mod']], local: ['helper'] }, display: 'helper', expandable: true, args: [] })
    const sdkRef = toViewTree(def({ kind: 'value-reference', attr: {}, fqn: { pkg: [['morphir'], ['s', 'd', 'k']], module: [['string']], local: ['to', 'upper'] } }), ctx())
    expect(sdkRef.kind).toBe('v-reference')
    if (sdkRef.kind === 'v-reference') expect(sdkRef.expandable).toBe(false)
  })

  test('generic apply becomes a reference call with args', () => {
    const call: ValueExpr = {
      kind: 'apply', attr: {},
      fn: { kind: 'value-reference', attr: {}, fqn: { pkg: [['my']], module: [['m']], local: ['f'] } },
      arg: lit(1)
    }
    const node = toViewTree(def(call), ctx())
    expect(node.kind).toBe('v-reference')
    if (node.kind === 'v-reference') { expect(node.display).toBe('f'); expect(node.args).toHaveLength(1) }
  })

  test('unknown and unit degrade gracefully', () => {
    expect(toViewTree(def({ kind: 'unknown', tag: 'Mystery', raw: null }), ctx())).toEqual({ kind: 'v-unknown', tag: 'Mystery' })
    expect(toViewTree(def({ kind: 'value-unit', attr: {} }), ctx())).toEqual({ kind: 'v-unit' })
  })
})

describe('patternToText', () => {
  test('formats the pattern zoo', () => {
    expect(patternToText({ kind: 'wildcard' })).toBe('_')
    expect(patternToText({ kind: 'as', inner: { kind: 'wildcard' }, name: ['user', 'id'] })).toBe('userId')
    expect(patternToText({ kind: 'literal-pattern', literal: { kind: 'whole-number', value: 0 } })).toBe('0')
    expect(patternToText({
      kind: 'constructor-pattern',
      fqn: { pkg: [['p']], module: [['m']], local: ['just'] },
      args: [{ kind: 'wildcard' }]
    })).toBe('Just(_)')
    expect(patternToText({ kind: 'pattern-tuple', elements: [{ kind: 'wildcard' }, { kind: 'empty-list' }] })).toBe('(_, [])')
    expect(patternToText({ kind: 'head-tail', head: { kind: 'wildcard' }, tail: { kind: 'wildcard' } })).toBe('_ :: _')
    expect(patternToText({ kind: 'pattern-unit' })).toBe('()')
  })
})
```

- [ ] **Step 3: Run to verify failure, then implement**

`src/view-node.ts`:
```ts
import type { FQName, Literal } from '@morphir/ir'

export type ViewCell =
  | { readonly kind: 'cell-pattern'; readonly text: string }
  | { readonly kind: 'cell-wildcard' }
  | { readonly kind: 'cell-missing' }
  | { readonly kind: 'cell-unsupported'; readonly patternKind: string }

export type ViewNode =
  | { readonly kind: 'v-literal'; readonly text: string; readonly literalKind: Literal['kind'] }
  | { readonly kind: 'v-variable'; readonly name: string }
  | { readonly kind: 'v-record'; readonly fields: readonly { readonly name: string; readonly value: ViewNode }[] }
  | { readonly kind: 'v-update-record'; readonly subject: ViewNode; readonly fields: readonly { readonly name: string; readonly value: ViewNode }[] }
  | { readonly kind: 'v-list'; readonly items: readonly ViewNode[] }
  | { readonly kind: 'v-tuple'; readonly elements: readonly ViewNode[] }
  | { readonly kind: 'v-field-access'; readonly subject: ViewNode; readonly field: string }
  | { readonly kind: 'v-constructor'; readonly name: string; readonly args: readonly ViewNode[] }
  | { readonly kind: 'v-arith-chain'; readonly op: '+' | '-' | '*'; readonly items: readonly { readonly node: ViewNode; readonly grouped: boolean }[] }
  | { readonly kind: 'v-fraction'; readonly numerator: ViewNode; readonly denominator: ViewNode }
  | { readonly kind: 'v-logic-chain'; readonly op: 'AND' | 'OR'; readonly items: readonly ViewNode[] }
  | { readonly kind: 'v-binary-op'; readonly symbol: string; readonly left: ViewNode; readonly right: ViewNode }
  | { readonly kind: 'v-prefix-call'; readonly label: string; readonly args: readonly ViewNode[] }
  | { readonly kind: 'v-power'; readonly base: ViewNode; readonly exponent: ViewNode }
  | { readonly kind: 'v-member-of'; readonly item: ViewNode; readonly options: readonly ViewNode[] }
  | { readonly kind: 'v-pipeline'; readonly input: ViewNode; readonly stages: readonly { readonly label: string; readonly arg: ViewNode }[] }
  | { readonly kind: 'v-if-tree'; readonly branches: readonly { readonly condition: ViewNode; readonly thenLabel: string; readonly elseLabel: string; readonly result: ViewNode }[]; readonly fallback: ViewNode }
  | { readonly kind: 'v-decision-table'; readonly columns: readonly ViewNode[]; readonly rows: readonly { readonly cells: readonly ViewCell[]; readonly result: ViewNode }[] }
  | { readonly kind: 'v-lambda'; readonly pattern: string; readonly body: ViewNode }
  | { readonly kind: 'v-let-group'; readonly bindings: readonly { readonly name: string; readonly value: ViewNode }[]; readonly body: ViewNode }
  | { readonly kind: 'v-reference'; readonly fqn: FQName; readonly display: string; readonly expandable: boolean; readonly args: readonly ViewNode[]; readonly expanded?: ViewNode; readonly cycle?: boolean }
  | { readonly kind: 'v-unit' }
  | { readonly kind: 'v-unknown'; readonly tag: string }
```

`src/context.ts`:
```ts
import { pathToTitle, type FQName, type MorphirLibrary } from '@morphir/ir'

export interface InsightContext {
  readonly library: MorphirLibrary
  readonly expanded: ReadonlySet<string>
  readonly path: readonly string[]
}

export const makeContext = (library: MorphirLibrary, expanded: ReadonlySet<string> = new Set()): InsightContext => ({
  library,
  expanded,
  path: []
})

export const fqnKey = (fqn: FQName): string =>
  `${pathToTitle(fqn.pkg)}:${pathToTitle(fqn.module)}:${fqn.local.join('-')}`

export const isSdkFqn = (fqn: FQName): boolean =>
  JSON.stringify(fqn.pkg) === JSON.stringify([['morphir'], ['s', 'd', 'k']])
```

`src/pattern-text.ts`:
```ts
import { nameToCamel, nameToTitle, type Literal, type Pattern } from '@morphir/ir'

export const literalText = (l: Literal): string => {
  switch (l.kind) {
    case 'bool': return l.value ? 'True' : 'False'
    case 'char': return `'${l.value}'`
    case 'string': return `"${l.value}"`
    case 'whole-number': return String(l.value)
    case 'float': return String(l.value)
    case 'decimal': return l.value
    case 'unknown': return `?${l.tag}`
  }
}

export const patternToText = (p: Pattern): string => {
  switch (p.kind) {
    case 'wildcard': return '_'
    case 'as': return p.inner.kind === 'wildcard' ? nameToCamel(p.name) : `${patternToText(p.inner)} as ${nameToCamel(p.name)}`
    case 'pattern-tuple': return `(${p.elements.map(patternToText).join(', ')})`
    case 'constructor-pattern':
      return p.args.length === 0 ? nameToTitle(p.fqn.local) : `${nameToTitle(p.fqn.local)}(${p.args.map(patternToText).join(', ')})`
    case 'empty-list': return '[]'
    case 'head-tail': return `${patternToText(p.head)} :: ${patternToText(p.tail)}`
    case 'literal-pattern': return literalText(p.literal)
    case 'pattern-unit': return '()'
    case 'unknown': return `?${p.tag}`
  }
}
```

`src/transform.ts` (structural core — Tasks 6/7 splice into the marked dispatch points):
```ts
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
```
(The Task-7 note is about *refining* branching — elif flattening, Maybe special case, tuple-column decomposition, widening rules — the interim shapes above are already correct for single-level cases, so goldens created later don't churn.)

`src/index.ts`:
```ts
export * from './view-node.ts'
export * from './context.ts'
export * from './pattern-text.ts'
export * from './transform.ts'
```

- [ ] **Step 4: Run tests, verify pass** — `cd packages/morphir-insight && mise exec -- bun test && mise exec -- bun run typecheck`; root lint + `mise exec -- moon query projects` (new project registers) green.

- [ ] **Step 5: Commit**

```bash
git add packages/morphir-insight bun.lock && git commit -s -m "feat(insight): view-node vocabulary and structural display-tree transform"
```

---

### Task 6: Operators, chains, and apply specials (`@morphir/insight`)

**Files:**
- Create: `packages/morphir-insight/src/operators.ts`, `src/chains.ts`, `scripts/gen-goldens.ts`
- Modify: `packages/morphir-insight/src/transform.ts` (replace the `viewSpecial` stub with the real router), `src/index.ts`
- Test: `packages/morphir-insight/test/chains.test.ts`, `test/goldens.test.ts`, `test/goldens/*.json` (generated then committed)

**Interfaces:**
- Consumes: Task 5's `ViewNode`, `viewExpr`, `referenceNode`, `InsightContext`, `isSdkFqn`, `uncurryApply`.
- Produces:
  - `sdkCallName(fqn: FQName): string` — `ModuleTitle.localCamel` (e.g. `Basics.add`); the extraction's key finding: morphir-elm keys operator tables on module+local WITHOUT the package for chain building, but package-checks (SDK-only) for inline operators — we require `isSdkFqn` for ALL operator treatment (deliberate tightening, noted in the PR body).
  - `INLINE_BINARY_OPERATORS: Record<string, string>` — the 12-entry ViewApply table verbatim: `Basics.equal '='`, `Basics.notEqual '≠'`, `Basics.lessThan '<'`, `Basics.lessThanOrEqual '<='`, `Basics.greaterThan '>'`, `Basics.greaterThanOrEqual '>='`, `Basics.add '+'`, `Basics.subtract '-'`, `Basics.multiply '*'`, `Basics.divide '/'`, `List.append '+'`, `Basics.power '^'` (power intercepted by superscript before lookup — kept for completeness).
  - `ARITH_OPS: Record<string, '+' | '-' | '*'>` = add/subtract/multiply; `Basics.divide` → `v-fraction`; precedence `{'+': 1, '-': 1, '*': 2}` with division treated as precedence 2.
  - `LOGIC_OPS: Record<string, 'AND' | 'OR'>` = `Basics.and`/`Basics.or`.
  - `buildChains` behavior (all inside the real `viewSpecial`):
    - 2-arg SDK apply where the call name is in `ARITH_OPS`: flatten same-operator nesting n-ary (divergence #1); children that are chains of strictly lower precedence get `grouped: true` (divergence #2); `divide` produces `v-fraction` with BOTH sides recursed (divergence from elm's leaf-forced numerator — numerator chains render as chains inside the fraction; noted in PR body as intent-preserving).
    - 2-arg SDK apply in `LOGIC_OPS`: n-ary same-operator flattening (elm's guarded behavior, faithfully) → `v-logic-chain`.
    - 2-arg SDK apply in `INLINE_BINARY_OPERATORS` (comparisons, List.append): `v-binary-op`.
    - `Basics.power` 2-arg → `v-power`; `Basics.negate` 1-arg → `v-prefix-call {label:'-'}`; `Basics.abs` 1-arg → `v-prefix-call {label:'abs'}`; any other 1-arg `Basics.*` → `v-prefix-call {label: camelName}`; `Basics.min`/`Basics.max` 2-arg → `v-prefix-call`.
    - `List.member` 2-arg where arg2 is a `value-list` → `v-member-of`; otherwise fall through to generic call.
    - Any-SDK-module `map`/`filter`/`filterMap` 2-arg → `v-pipeline`: walk nested qualifying applies innermost-first, producing `input` + ordered `stages` (label `map`/`filter`/`filter & map`, arg = the function argument).
    - `is`-prefixed local names on plain reference calls (`isFoo x` → `x is Foo`): `v-binary-op { symbol: 'is', left: arg, right: {kind:'v-variable', name: TitleRest} }` when the local name's first word is `is` and there is exactly 1 arg.

- [ ] **Step 1: Write the failing tests**

`packages/morphir-insight/test/chains.test.ts`:
```ts
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
```

`packages/morphir-insight/test/goldens.test.ts`:
```ts
import { describe, expect, test } from 'bun:test'
import { readdirSync } from 'node:fs'
import { Effect } from 'effect'
import { decodeMorphirIr, decodeEntryValueDef, nameToCamel } from '@morphir/ir'
import { makeContext, toViewTree } from '../src/index.ts'

// Golden coverage grows per task: Task 6 commits goldens for the chain/apply definitions;
// Task 7 adds branching; Task 8 regenerates the full 21 with drill-down fields present.
const GOLDEN_DIR = new URL('./goldens/', import.meta.url)

describe('display-tree goldens', () => {
  test('every committed golden matches the transform output', async () => {
    const text = await Bun.file(new URL('../../morphir-ir/test/fixtures/insight-ir.json', import.meta.url)).text()
    const lib = await Effect.runPromise(decodeMorphirIr(text))
    const entries = new Map(lib.modules[0]!.values.map((e) => [nameToCamel(e.name), e]))
    const goldens = readdirSync(GOLDEN_DIR).filter((f) => f.endsWith('.json'))
    expect(goldens.length).toBeGreaterThan(0)
    for (const file of goldens) {
      const name = file.replace(/\.json$/, '')
      const expected = JSON.parse(await Bun.file(new URL(file, GOLDEN_DIR)).text())
      const actual = toViewTree(decodeEntryValueDef(entries.get(name)!)!, makeContext(lib))
      expect(actual, `golden drift: ${name} (regenerate with bun run gen:goldens and review the diff)`).toEqual(expected)
    }
  })
})
```

`scripts/gen-goldens.ts`:
```ts
import { Effect } from 'effect'
import { decodeMorphirIr, decodeEntryValueDef, nameToCamel } from '@morphir/ir'
import { makeContext, toViewTree } from '../src/index.ts'

const NAMES = process.argv.slice(2)
const text = await Bun.file(new URL('../../morphir-ir/test/fixtures/insight-ir.json', import.meta.url)).text()
const lib = await Effect.runPromise(decodeMorphirIr(text))
const entries = new Map(lib.modules[0]!.values.map((e) => [nameToCamel(e.name), e]))
const targets = NAMES.length ? NAMES : [...entries.keys()]
for (const name of targets) {
  const entry = entries.get(name)
  if (!entry) { console.error(`no such definition: ${name}`); process.exit(1) }
  const tree = toViewTree(decodeEntryValueDef(entry)!, makeContext(lib))
  await Bun.write(new URL(`../test/goldens/${name}.json`, import.meta.url), JSON.stringify(tree, null, 2) + '\n')
  console.log(`wrote ${name}.json`)
}
```

- [ ] **Step 2: Run to verify failure** — chains tests FAIL (viewSpecial returns null → generic calls).

- [ ] **Step 3: Implement**

`src/operators.ts`:
```ts
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
```

`src/chains.ts`:
```ts
import { nameToCamel, nameToTitle, uncurryApply, type ValueExpr } from '@morphir/ir'
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
      if (call === 'Basics.min' || call === 'Basics.max')
        return { kind: 'v-prefix-call', label: nameToCamel(local.split('-').map((w) => w).map(String) as string[]), args: args.map((a) => viewExpr(a, ctx)) }
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
```
In `src/transform.ts`, replace the stub:
```ts
import { routeSpecial } from './chains.ts'
export const viewSpecial = (e: ValueExpr, ctx: InsightContext): ViewNode | null => routeSpecial(e, ctx)
```
(Note the circular import `transform ↔ chains` is intentional and safe: both only call each other's functions at runtime, never at module-init. Fix the `Basics.min/max` label expression to simply `nameToCamel(fqnLocalOf(call))` style if the split form fights the type-checker — the label must be `min`/`max`.)

Add to `src/index.ts`:
```ts
export * from './operators.ts'
export { routeSpecial } from './chains.ts'
```

- [ ] **Step 4: Generate and review the first goldens**

```bash
cd packages/morphir-insight && mise exec -- bun run gen:goldens chainedArithmetic mixedPrecedence safeDivide boolChain comparison negated powered memberOf applyPipeline personRecord updatedPerson applyLambda letBound
```
READ each generated file (they are small); confirm shapes match the tests' expectations before committing — goldens are an oracle, not a rubber stamp.

- [ ] **Step 5: Run tests, verify pass** — `mise exec -- bun test && mise exec -- bun run typecheck`; root lint green.

- [ ] **Step 6: Commit**

```bash
git add packages/morphir-insight && git commit -s -m "feat(insight): operator routing, arithmetic and logic chains, apply specials, goldens"
```

---

### Task 7: Branching — if-trees and decision tables (`@morphir/insight`)

**Files:**
- Create: `packages/morphir-insight/src/branching.ts`
- Modify: `packages/morphir-insight/src/transform.ts` (route `if-then-else`/`pattern-match` to branching.ts, delete the interim `viewBranching`), `src/index.ts`
- Test: `packages/morphir-insight/test/branching.test.ts`; extend goldens

**Interfaces:**
- Consumes: `viewExpr`, `ViewNode`/`ViewCell`, `patternToText`, `isSdkFqn`, fixture defs `gradeIf`, `maybeCase`, `colorCase`, `tupleCase`, `nestedCase`.
- Produces (behavioral contract, from the morphir-elm extraction):
  - `viewIfTree(e, ctx)`: flattens direct `else if` chains into sequential `branches` (labels `Yes`/`No`), `fallback` = the final else. A `pattern-match` over SDK `Maybe` with exactly two cases (`Just`/`Nothing` in either order) ALSO produces a `v-if-tree` with one branch labeled `set`/`not set`, condition = the subject, branch result = the Just body, fallback = the Nothing body (elm's Maybe special case).
  - `viewDecisionTable(e, ctx)`: every other `pattern-match` → `v-decision-table`. Columns: recursively flatten a `value-tuple` subject into one column per leaf element (elm's `decomposeInput`); otherwise one column. Rows: per case, `wildcard` widens to `cell-wildcard` in EVERY column; `pattern-tuple` yields one cell per element (each rendered via `patternToText`, wildcards as `cell-wildcard`); `literal-pattern`/`constructor-pattern`/`as` yield one `cell-pattern` and pad remaining columns with `cell-missing`; `empty-list`/`head-tail`/`pattern-unit` yield one `cell-unsupported {patternKind}` plus padding (divergence #3 — elm drops these rows silently). Row results recurse through `viewExpr` (nested case = nested table inside the result — elm behavior, no flattening).

- [ ] **Step 1: Write the failing tests**

`packages/morphir-insight/test/branching.test.ts`:
```ts
import { describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import { decodeMorphirIr, decodeEntryValueDef, nameToCamel, type MorphirLibrary, type RawDefEntry } from '@morphir/ir'
import { makeContext, toViewTree, type ViewNode } from '../src/index.ts'

let lib: MorphirLibrary
const defs = new Map<string, RawDefEntry>()
const tree = async (name: string): Promise<ViewNode> => {
  if (!defs.size) {
    const text = await Bun.file(new URL('../../morphir-ir/test/fixtures/insight-ir.json', import.meta.url)).text()
    lib = await Effect.runPromise(decodeMorphirIr(text))
    for (const e of lib.modules[0]!.values) defs.set(nameToCamel(e.name), e)
  }
  return toViewTree(decodeEntryValueDef(defs.get(name)!)!, makeContext(lib))
}

describe('if trees', () => {
  test('gradeIf flattens three elif branches over one fallback', async () => {
    const node = await tree('gradeIf')
    expect(node.kind).toBe('v-if-tree')
    if (node.kind === 'v-if-tree') {
      expect(node.branches).toHaveLength(3)
      expect(node.branches[0]!.condition.kind).toBe('v-binary-op')
      expect(node.branches[0]!.thenLabel).toBe('Yes')
      expect(node.fallback).toMatchObject({ kind: 'v-literal', text: '"F"' })
    }
  })

  test('maybeCase becomes a set/not-set if-tree, not a table', async () => {
    const node = await tree('maybeCase')
    expect(node.kind).toBe('v-if-tree')
    if (node.kind === 'v-if-tree') {
      expect(node.branches[0]!.thenLabel).toBe('set')
      expect(node.branches[0]!.elseLabel).toBe('not set')
      expect(node.fallback).toMatchObject({ kind: 'v-literal', text: '0' })
    }
  })
})

describe('decision tables', () => {
  test('colorCase: one column, three constructor rows', async () => {
    const node = await tree('colorCase')
    expect(node.kind).toBe('v-decision-table')
    if (node.kind === 'v-decision-table') {
      expect(node.columns).toHaveLength(1)
      expect(node.rows).toHaveLength(3)
      expect(node.rows[0]!.cells[0]).toEqual({ kind: 'cell-pattern', text: 'Red' })
    }
  })

  test('tupleCase: tuple subject decomposes into two columns; wildcard row widens', async () => {
    const node = await tree('tupleCase')
    expect(node.kind).toBe('v-decision-table')
    if (node.kind === 'v-decision-table') {
      expect(node.columns).toHaveLength(2)
      expect(node.rows[0]!.cells.map((c) => c.kind)).toEqual(['cell-pattern', 'cell-pattern'])
      expect(node.rows[1]!.cells.map((c) => c.kind)).toEqual(['cell-wildcard', 'cell-pattern'])
      expect(node.rows[2]!.cells.map((c) => c.kind)).toEqual(['cell-wildcard', 'cell-wildcard'])
    }
  })

  test('nestedCase: outer table row result embeds the inner Maybe if-tree', async () => {
    const node = await tree('nestedCase')
    expect(node.kind).toBe('v-decision-table')
    if (node.kind === 'v-decision-table') {
      expect(node.rows[0]!.result.kind).toBe('v-if-tree')
      expect(node.rows[1]!.cells[0]!.kind).toBe('cell-wildcard')
    }
  })
})
```

- [ ] **Step 2: Run to verify failure** (gradeIf currently yields a single-branch tree; maybeCase yields a table) — then implement.

`src/branching.ts`:
```ts
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

export const viewDecisionTable = (e: MatchExpr, ctx: InsightContext): ViewNode => {
  const special = maybeSpecial(e, ctx)
  if (special) return special
  const columnCount = countColumns(e.subject)
  return {
    kind: 'v-decision-table',
    columns: columnSubjects(e.subject).map((s) => viewExpr(s, ctx)),
    rows: e.cases.map((c) => ({ cells: rowCells(c.pattern, columnCount), result: viewExpr(c.body, ctx) }))
  }
}
```
In `src/transform.ts`: delete the interim `viewBranching`; the two cases become
```ts
    case 'if-then-else': return viewIfTree(e, ctx)
    case 'pattern-match': return viewDecisionTable(e, ctx)
```
with `import { viewDecisionTable, viewIfTree } from './branching.ts'`. Add `export * from './branching.ts'` to `src/index.ts`.

- [ ] **Step 3: Extend goldens and verify**

```bash
cd packages/morphir-insight && mise exec -- bun run gen:goldens gradeIf maybeCase colorCase tupleCase nestedCase
```
READ the five new goldens against the test expectations, then `mise exec -- bun test && mise exec -- bun run typecheck`; root lint green. (Existing goldens must NOT change — if any do, the diff is a regression to investigate, not regenerate.)

- [ ] **Step 4: Commit**

```bash
git add packages/morphir-insight && git commit -s -m "feat(insight): if-tree flattening, maybe special case, and decision tables"
```

---

### Task 8: Drill-down and the Insight renderers

**Files:**
- Create: `packages/morphir-insight/src/drill-down.ts`; `packages/morphir-ui/src/views/insight/insight-state.svelte.ts`, `InsightView.svelte`, `InsightNode.svelte`, `nodes/ChainNode.svelte`, `nodes/FractionNode.svelte`, `nodes/IfTreeNode.svelte`, `nodes/TableNode.svelte`, `nodes/ReferenceNode.svelte`
- Modify: `packages/morphir-insight/src/transform.ts` (referenceNode resolves through drill-down), `packages/morphir-insight/src/context.ts` (path threading), `packages/morphir-ui/src/views/insight/DefinitionDetail.svelte` (Insight tab, default for values), `packages/morphir-ui/src/index.ts`
- Test: `packages/morphir-insight/test/drill-down.test.ts`; `packages/morphir-ui/test/insight-view.test.ts`; full golden regeneration

**Interfaces:**
- Consumes: everything prior; fixture defs `usesHelper`, `helperFn`, `selfRecursive`.
- Produces:
  - `resolveReference(fqn, args, ctx)` in drill-down.ts — replaces Task 5's `referenceNode` internals: looks the FQName up in `ctx.library` (module path match + value local-name match); `expandable` = found && !SDK. If `fqnKey(fqn)` ∈ `ctx.expanded`: when the key is already on `ctx.path` → `{ …, cycle: true }` (collapsed); otherwise `expanded` = `toViewTree(decodedDef, { …ctx, path: [...ctx.path, key] })`.
  - `InsightState` (runes): `expanded = new SvelteSet<string>()`, `toggle(key)`, `selectedKey: string | null`.
  - `InsightView.svelte` props `{ def: ValueDef | null; library: MorphirLibrary }` — owns an `InsightState`; `$derived` view tree recomputed from `(def, expansion-set contents)`; renders an inputs signature line (`name : Type` per input via a compact type formatter `typeText(t)` added to `@morphir/insight` pattern-text.ts: references → local Title name with args in angle brackets, functions → `a → b`, tuples/records structurally) then `<InsightNode node={tree} />`.
  - `InsightNode.svelte` dispatches on `node.kind`: inline rendering for `v-literal` (mono, `--accent-text` for strings/numbers), `v-variable` (italic), `v-unit`, `v-unknown` (accent warning chip), `v-field-access` (`subject.field`), `v-prefix-call`, `v-binary-op`, `v-power` (sup element), `v-member-of` (`item is one of [...]`), `v-record`/`v-update-record` (definition-list rows), `v-list`/`v-tuple` (bracketed inline flow), `v-lambda`, `v-let-group` (bindings block + body), `v-constructor`, `v-pipeline` (input ▸ stage ▸ stage ▸ output flow); delegates to the dedicated components for `v-arith-chain`/`v-logic-chain` (ChainNode), `v-fraction` (FractionNode), `v-if-tree` (IfTreeNode), `v-decision-table` (TableNode), `v-reference` (ReferenceNode).
  - ChainNode: items separated by the op symbol (AND/OR bold-mono for logic); `grouped` items wrapped in parentheses spans. FractionNode: numerator over a `--row-edge` top-bordered denominator, inline-block. IfTreeNode: per branch a condition row (`? condition → Yes:` result) indented cascade, fallback labeled with the last branch's `elseLabel`/`No`. TableNode: an HTML `<table>` — header cells render column ViewNodes, body rows render cells (`cell-wildcard` → italic `anything else`, `cell-missing` → muted `—`, `cell-unsupported` → accent `⟨patternKind⟩`), trailing `→ result` column. ReferenceNode: the display name as a button (`aria-expanded`) when `expandable`; expanded body renders in an inset bordered block; `cycle` renders the name + a `↺ recursive` chip; args render as a call-style suffix. NO inline styles anywhere; expansion clicks call the injected `onToggle(fqnKey)` passed down via Svelte context (`setContext('insight-toggle', …)` in InsightView — a single context key documented in InsightView).

- [ ] **Step 1: Write the failing transform tests**

`packages/morphir-insight/test/drill-down.test.ts`:
```ts
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
const findRef = (n: ViewNode, display: string): Extract<ViewNode, { kind: 'v-reference' }> | null => {
  if (n.kind === 'v-reference' && n.display === display) return n
  for (const v of Object.values(n)) {
    const scan = (x: unknown): ReturnType<typeof findRef> => {
      if (typeof x === 'object' && x !== null && 'kind' in x) return findRef(x as ViewNode, display)
      return null
    }
    if (Array.isArray(v)) { for (const item of v) { const inner = typeof item === 'object' && item !== null && 'node' in (item as object) ? (item as { node: ViewNode }).node : item; const hit = scan(inner); if (hit) return hit } }
    else { const hit = scan(v); if (hit) return hit }
  }
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
```
(If `fqnKey`'s package path for the fixture library needs the envelope's `packageName` rather than an FQName pkg, adjust the key construction in `resolveReference` so both sides derive from the SAME source — the test pins the contract.)

- [ ] **Step 2: Implement drill-down; regenerate ALL goldens; verify**

`src/drill-down.ts`:
```ts
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
```
In `src/transform.ts`, `referenceNode` delegates to `resolveReference` (keeping the export name so Task 5/6 call sites are untouched). Then:
```bash
cd packages/morphir-insight && mise exec -- bun run gen:goldens
```
regenerates all 21 goldens (previous goldens gain no new fields for collapsed references — spot-check `usesHelper.json` shows `expandable: true` with no `expanded`). `mise exec -- bun test` → all green.

- [ ] **Step 3: Write the failing component tests, then implement the renderers**

`packages/morphir-ui/test/insight-view.test.ts`:
```ts
import { render, screen, cleanup } from '@testing-library/svelte'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Effect } from 'effect'
import InsightView from '../src/views/insight/InsightView.svelte'
import { decodeMorphirIr, decodeEntryValueDef, nameToCamel, type MorphirLibrary } from '@morphir/ir'

afterEach(() => cleanup())

const fixture = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../morphir-ir/test/fixtures/insight-ir.json'), 'utf8'
)
const setup = async (name: string) => {
  const lib: MorphirLibrary = await Effect.runPromise(decodeMorphirIr(fixture))
  const entry = lib.modules[0]!.values.find((v) => nameToCamel(v.name) === name)!
  render(InsightView, { props: { def: decodeEntryValueDef(entry), library: lib } })
  return lib
}

describe('InsightView', () => {
  test('renders an arithmetic chain with operator separators', async () => {
    await setup('chainedArithmetic')
    expect(screen.getAllByText('+')).toHaveLength(2)
    expect(screen.getByText('a')).toBeTruthy()
  })

  test('renders a decision table with wildcard cells as anything else', async () => {
    await setup('tupleCase')
    expect(screen.getAllByText('anything else').length).toBeGreaterThan(0)
    expect(screen.getByText('"zero-true"')).toBeTruthy()
  })

  test('expanding a reference embeds its definition; collapsing removes it', async () => {
    await setup('usesHelper')
    const button = screen.getByRole('button', { name: /helperFn/ })
    expect(button.getAttribute('aria-expanded')).toBe('false')
    await userEvent.click(button)
    expect(screen.getAllByText('+').length).toBeGreaterThan(0) // helperFn body: x + 1
    await userEvent.click(screen.getByRole('button', { name: /helperFn/ }))
    expect(screen.queryAllByText('+')).toHaveLength(0)
  })

  test('recursive expansion shows the cycle chip', async () => {
    await setup('selfRecursive')
    await userEvent.click(screen.getByRole('button', { name: /selfRecursive/ }))
    expect(screen.getByText(/recursive/)).toBeTruthy()
  })
})
```
Renderer code freedom: the behavioral contracts in the Interfaces block plus the component tests are BINDING (aria-expanded on reference buttons, `anything else` wildcard text, cycle chip text containing `recursive`, operator separators as text nodes, no inline styles); the exact markup inside ChainNode/FractionNode/IfTreeNode is the implementer's, kept under ~100 lines each with scoped styles. ReferenceNode's contract is the strictest — button when expandable, `aria-expanded` reflecting state, expanded body in an inset `--panel-edge` bordered block, args rendered as a parenthesized call suffix, cycle chip replacing expansion.

Implement `insight-state.svelte.ts` (SvelteSet-based), `InsightView.svelte` (state + context provider + signature line + root node), `InsightNode.svelte` (dispatch per the Interfaces block), and the four dedicated node components — every component under ~100 lines, scoped styles only, no inline `style=`. Wire `DefinitionDetail.svelte`: value tabs become `[{id:'insight',label:'Insight'},{id:'xray',label:'XRay'}]` with `insight` default; the Insight tab renders `<InsightView {def} library={…} />` (DefinitionDetail gains a `library: MorphirLibrary` prop; IrExplorerView passes `workspace.current.library`). Update the Task-4 explorer test expectation if the default tab changed the first visible content (the XRay assertion moves behind a tab click).

- [ ] **Step 3b: Node selection → shell inspector (spec §4)**

Clicking any rendered node selects it: `InsightNode` wraps each dispatch target in a click handler that calls `setContext`-provided `onSelectNode(meta)` where `meta = { kindLabel: string; fqn?: string; doc?: string }` (references pass their FQName display and the referenced entry's doc when resolvable; other nodes pass their `kind` as label). `InsightView` receives an optional `onSelect` prop and forwards; `DefinitionDetail` forwards it upward; `IrExplorerView` stores `inspected = $state<meta | null>` and exposes it via a NEW optional prop `onInspect` that `MorphirApp` supplies, storing the meta in its own state and rendering it in the AppShell `inspector` snippet (FQName in mono, kind label, doc in muted text; empty state text `Select a node to inspect`). Add one vitest case: clicking a reference node populates the inspector text (render `MorphirApp` with the insight fixture via fakes, navigate to a definition, click, assert the FQName appears in the inspector region).

- [ ] **Step 4: Full verification** — both packages' suites, `packages/morphir-ui` vitest, root `mise exec -- moon run :lint :typecheck :test :build` all green.

- [ ] **Step 5: Commit**

```bash
git add packages/morphir-insight packages/morphir-ui && git commit -s -m "feat(insight): drill-down resolution and native insight renderers"
```

---

### Task 9: Final verification, push, PR

**Files:** none (verification + delivery)

- [ ] **Step 1: Corruption/leniency spot-check** — hand-corrupt a copy of the fixture (`sed 's/"IfThenElse"/"IfThenBroken"/' …` into /tmp), decode + transform + render it via a one-off bun script asserting: no throw, `v-unknown` nodes present. Record the command + output.

- [ ] **Step 2: Success-criteria walk** — spec's 7 criteria, each with named evidence (test file / golden / component test). Criterion 7's "both hosts identical": confirmed structurally (both render `MorphirApp` → same explorer/detail components); note that in the report rather than duplicating host-specific tests. Desktop smoke still green: `cd apps/morphir-desktop && MORPHIR_HOME=$(mktemp -d) mise exec -- bun run smoke`.

- [ ] **Step 3: Authorship/DCO sweep** — `git log origin/main..HEAD --format='%an %ae%n%B'`: every commit signed off by Damian Reeves, zero AI attribution. Fix by rebase BEFORE push if not.

- [ ] **Step 4: Push and open the PR** — `git push -u origin feat/insight-static`; `gh pr create --repo finos/morphir-ui` titled `feat: static insight visualization with decision tables, drill-down and xray`, body covering: what (three layers, per-package summary), the spec/plan paths, the morphir-elm divergences list (Global Constraints items 1–5 plus the SDK-package-check tightening and recursed fraction numerators), the v4 deferral pointer (beads morphir-19s6), verification summary, and follow-ups (evaluation cycle, editors). NO AI attribution.

- [ ] **Step 5: Hand back to the controller** for the standing PR protocol (checks monitor, three-surface comment sweep + post-merge recheck, fixes with inline replies, admin bypass once green per the user's standing grant).
