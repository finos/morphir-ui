<script lang="ts">
  import { getContext, type Snippet } from 'svelte'
  import { fqnKey, type ViewNode } from '@morphir/insight'
  import { TOGGLE_KEY } from '../insight-context.ts'

  let {
    node,
    render
  }: { node: Extract<ViewNode, { kind: 'v-reference' }>; render: Snippet<[ViewNode]> } = $props()

  const onToggle = getContext<((key: string) => void) | undefined>(TOGGLE_KEY)
  const key = $derived(fqnKey(node.fqn))
  const isOpen = $derived(node.expanded !== undefined)
  const showButton = $derived(node.expandable && !node.cycle)
</script>

<span class="ref">
  {#if showButton}
    <button type="button" class="ref-name" aria-expanded={isOpen} onclick={() => onToggle?.(key)}>{node.display}</button>
  {:else}
    <span class="ref-name plain">{node.display}</span>
  {/if}
  {#if node.args.length > 0}
    <span class="call">(<!--
    -->{#each node.args as arg, i (i)}{#if i > 0}, {/if}{@render render(arg)}{/each}<!--
    -->)</span>
  {/if}
  {#if node.cycle}
    <span class="cycle-chip">↺ recursive</span>
  {:else if node.expanded}
    <div class="expanded-body">
      {@render render(node.expanded)}
    </div>
  {/if}
</span>

<style>
  .ref { display: inline-flex; flex-direction: column; align-items: flex-start; gap: 4px; }
  .ref-name {
    font-family: var(--mono); font-size: 12.5px; color: var(--accent2);
    background: none; border: none; padding: 0; cursor: pointer;
  }
  .ref-name.plain { color: var(--text); cursor: default; }
  .call { font-family: var(--mono); font-size: 12.5px; color: var(--text); }
  .cycle-chip {
    font-size: 11px; color: var(--accent-text); background: rgba(214, 64, 159, 0.14);
    border-radius: 6px; padding: 1px 6px;
  }
  .expanded-body {
    border: 1px solid var(--panel-edge); border-radius: 8px; padding: 8px 10px;
    background: var(--code-bg);
  }
</style>
