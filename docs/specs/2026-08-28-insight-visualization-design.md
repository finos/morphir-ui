# Insight Visualization Design (Static)

**Date:** 2026-08-28
**Status:** Approved
**Scope:** Second development cycle of finos/morphir-ui — the static portion of morphir-elm's insight visualization, rendered natively in the shared Svelte 5 + Effect shell.

## Background

morphir-elm's `Morphir/Visual` library (~13k lines of Elm) renders Morphir IR value definitions as readable business logic: per-node views dispatched from `ViewValue`, decision tables and trees, an XRay view of the raw IR, drill-down into referenced definitions, argument editors, and live evaluation. It is the most substantial Morphir UI codebase and the classic "insight" experience.

This cycle migrates the **static** portion natively — no Elm artifacts, no evaluator. The strategy decision (native Svelte, static first) was made over embedding the compiled Elm `<morphir-insight>` custom element: uniform look and feel by construction, at the cost of deferring live evaluation to a follow-up cycle.

## Decisions

| Decision           | Choice                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Strategy           | Native Svelte port, static first; evaluation and editors in a follow-up cycle                                      |
| Cycle contents     | Core value visualization, drill-down, decision tables & trees, XRay                                                |
| Architecture       | AST → display-tree transform → thin recursive renderers (Approach A)                                               |
| Logic home         | New pure package `packages/morphir-insight` (`@morphir/insight`): AST-to-display-tree transform, drill-down        |
| Decoder home       | `@morphir/ir` grows the full Value/Type/Pattern/Literal AST decoder                                                |
| Placement          | Definition detail inside the existing IR Explorer: tabs **Insight \| XRay** (values), **Type \| XRay** (types)     |
| Unknown IR nodes   | Decode to `UnknownNode` carrying the raw tag; render a fallback — never crash                                      |
| Test oracle        | Golden display-tree JSON snapshots against v3 fixtures; new fixtures generated from morphir-elm tutorial sources   |

## 1. Modules & boundaries

```
packages/
├── morphir-ir/            # + full AST decoder (types.ts, value-decode.ts extensions)
├── morphir-insight/       # NEW: pure display-tree logic — depends on @morphir/ir + effect ONLY
│   ├── src/view-node.ts   #   ViewNode vocabulary
│   ├── src/transform.ts   #   toViewTree(def, context)
│   ├── src/chains.ts      #   arithmetic/logic chain flattening
│   ├── src/decision.ts    #   decision table/tree detection
│   └── src/drill-down.ts  #   reference resolution + cycle guard
└── morphir-ui/
    └── src/views/insight/ # NEW: thin recursive Svelte renderers + tabs + XRay
```

`@morphir/insight` contains no Svelte and no DOM — the same purity rule that keeps `@morphir/ui/config` importable from Electron main. The follow-up evaluation cycle plugs an interpreter into `@morphir/insight` (annotating the same trees) without touching `@morphir/ui`; a future morphir-rust WASM evaluator slots behind the same boundary per the bootstrap spec's extension principle.

## 2. Full AST decoding (`@morphir/ir`)

Hand-rolled discriminated unions over the v3 positional-tagged-tuple format, extending the existing decoder's style (Effect Schema deliberately not used for tagged tuples — bootstrap-cycle lesson):

- **`TypeExpr`**: Variable, Reference, Tuple, Record, ExtensibleRecord, Function, Unit
- **`ValueExpr`** (all v3 tags): Literal, Constructor, Tuple, List, Record, Variable, Reference, Field, FieldFunction, Apply, Lambda, LetDefinition, LetRecursion, Destructure, IfThenElse, PatternMatch, UpdateRecord, Unit
- **`Pattern`**: Wildcard, As, Tuple, Constructor, EmptyList, HeadTail, Literal, Unit
- **`Literal`**: Bool, Char, String, WholeNumber, Float

Attributes decode as opaque `unknown` this cycle (they carry inferred types needed only by evaluation). Any unrecognized tag becomes `UnknownNode { tag, raw }` — the leniency contract extends from the envelope to the AST. The existing shallow `RawDefEntry` gains an optional decoded `body` resolved lazily, so the explorer's counts-only path pays nothing.

## 3. Display-tree transform (`@morphir/insight`)

`toViewTree(def: DecodedValueDef, context: InsightContext): ViewNode` — pure, synchronous, data-to-data. `InsightContext` carries the loaded `WorkspaceIr` definition index and an expansion set (`ReadonlySet<string>` of FQName paths).

**`ViewNode` vocabulary** (presentation-shaped, not IR-shaped): `literal`, `record`, `list`, `tuple`, `field-access`, `arith-chain` (operator chains flattened with precedence-aware grouping, ported from `ViewArithmetic`), `logic-chain` (`ViewBoolOperatorTree` equivalent), `if-else` (with elif-chain flattening), `pattern-branches`, `decision-table` (detected per morphir-elm's `DecisionTable` rules: nested if/case over comparable scrutinees → columns × rows), `lambda`, `let-group`, `reference` (FQName + expansion state), `unknown`. Every node reserves an optional `value` slot so the evaluation cycle can annotate results without reshaping trees.

**Drill-down** is tree substitution: an expanded `reference` embeds the referenced definition's own view tree, resolved from the context index. A reference already on the current expansion path renders collapsed with a cycle marker — expansion is always finite. `Morphir.SDK` references render as operators/keywords per the elm mapping table rather than as expandable references.

## 4. Rendering & shell integration (`@morphir/ui`)

One `InsightNode.svelte` dispatches on `ViewNode.kind` to small per-kind components (each under ~100 lines, scoped styles only, tokens doing the styling: `--code-bg`, `--accent`, `--accent2`, `--row-edge`, `--mono`). No inline `style=` attributes — the bootstrap rules carry forward. Expansion and node-selection state live in a runes `InsightState` owned by the definition-detail view; toggling expansion recomputes the view tree via the pure transform.

IA: selecting a definition in the IR Explorer opens a detail surface with tabs — **Insight | XRay** for values, **Type | XRay** for types — replacing the current inline definition card. The inspector panel shows the selected node's FQName, raw attribute, and doc. The explorer's package/module/definition lists and filters are unchanged.

## 5. XRay

A raw-AST renderer over the same decoded tree: indented tag/argument nodes, collapsible, monospace. It is deliberately scheduled first among the views in the plan — it visually verifies the decoder before the display-tree work begins, and it satisfies the XRay feature with near-zero incremental logic.

## 6. Testing

TDD throughout, three layers:

- **Decoder** (`bun test`): exact-value tests against every v3 fixture; new fixtures generated once from morphir-elm tutorial sources via `morphir-elm make` in the submodule (covering pattern matches, let bindings, nested ifs, constructors) and committed with provenance comments.
- **Transform** (`bun test`): golden display-tree JSON snapshots per fixture definition (human-reviewable diffs), plus targeted unit tests for chain flattening precedence, decision-table detection boundaries (what does and does not tabulate), and cycle-guarded drill-down.
- **Components** (vitest + testing-library): expansion toggling, tab switching, unknown-node fallback rendering — with the established mechanics (explicit `cleanup`, `tick`).

## Success criteria

1. Opening a fixture workspace and selecting a value definition renders readable static business logic (literals, records, chains, if-else, pattern branches) themed with the shell's tokens.
2. Nested if/case logic meeting the decision-table rules renders as a table; other branching renders as branches.
3. Clicking a reference expands the referenced definition inline; cycles render collapsed with a marker; SDK references render as operators.
4. The XRay tab shows the full decoded AST for any definition, including `UnknownNode` fallbacks.
5. Malformed or unknown IR constructs degrade to visible fallbacks — no crashes on any committed fixture or hand-corrupted variant.
6. Golden snapshots exist for every fixture definition; decoder and transform layers reach exhaustive tag coverage.
7. Both hosts (web and desktop) present identical insight experiences; CI green; landed via PR with the established authorship/DCO discipline.

## Out of scope (follow-up cycles)

Argument editors and live evaluation (interpreter strategy — TS port vs morphir-elm JS vs morphir-rust WASM — deliberately open), decorations, test-case management, dependency graph, `morphir server`-style hosting. The `value` slot on `ViewNode` and the `@morphir/insight` package boundary are the prepared seams.
