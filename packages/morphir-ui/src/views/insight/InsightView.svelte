<script lang="ts">
  import { setContext } from 'svelte'
  import { makeContext, toViewTree, typeText } from '@morphir/insight'
  import { nameToCamel, type MorphirLibrary, type ValueDef } from '@morphir/ir'
  import InsightNode from './InsightNode.svelte'
  import { InsightState } from './insight-state.svelte.ts'
  import { INSPECT_KEY, LIBRARY_KEY, TOGGLE_KEY, type InspectMeta } from './insight-context.ts'

  let {
    def,
    library,
    onSelect
  }: { def: ValueDef | null; library: MorphirLibrary; onSelect?: (meta: InspectMeta) => void } = $props()

  const state = new InsightState()

  // Single context surface for the whole node-component tree below this view: expansion
  // toggles (Task 8 drill-down), node-click selection (Step 3b shell inspector), and the
  // library reference-node components need for doc lookups.
  setContext(TOGGLE_KEY, (key: string) => state.toggle(key))
  setContext(INSPECT_KEY, (meta: InspectMeta) => onSelect?.(meta))
  setContext(LIBRARY_KEY, () => library)

  // Reruns whenever `def` changes or the expansion set's membership changes — SvelteSet reads
  // inside toViewTree (via ctx.expanded.has(key)) are tracked like any other reactive read.
  const tree = $derived(def ? toViewTree(def, makeContext(library, state.expanded)) : null)
  const signature = $derived(
    def ? def.inputs.map((i) => `${nameToCamel(i.name)} : ${typeText(i.tpe)}`).join(', ') : ''
  )
</script>

{#if def && tree}
  <div class="signature">({signature}) → {typeText(def.output)}</div>
  <div class="body">
    <InsightNode node={tree} />
  </div>
{:else}
  <p class="empty">This definition could not be decoded.</p>
{/if}

<style>
  .signature {
    font-family: var(--mono);
    font-size: 11.5px;
    color: var(--muted);
    margin-bottom: 10px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--row-edge);
  }
  .body { font-size: 12.5px; color: var(--text); }
  .empty { color: var(--muted); font-size: 13px; }
</style>
