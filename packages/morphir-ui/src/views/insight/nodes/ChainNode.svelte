<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { ViewNode } from '@morphir/insight'

  let {
    node,
    render,
  }: {
    node: Extract<ViewNode, { kind: 'v-arith-chain' | 'v-logic-chain' }>
    render: Snippet<[ViewNode]>
  } = $props()

  const isLogic = $derived(node.kind === 'v-logic-chain')
  const items = $derived(
    node.kind === 'v-arith-chain'
      ? node.items
      : node.items.map((n) => ({ node: n, grouped: false })),
  )
</script>

<span class="chain">
  {#each items as item, i (i)}
    {#if i > 0}<span class="op" class:logic={isLogic}>{node.op}</span>{/if}
    {#if item.grouped}
      <span class="grouped"
        ><span class="punctuation grouping">(</span>{@render render(item.node)}<span
          class="punctuation grouping">)</span
        ></span
      >
    {:else}
      {@render render(item.node)}
    {/if}
  {/each}
</span>

<style>
  .chain {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    flex-wrap: wrap;
  }
  .op {
    font-family: var(--mono);
    color: var(--muted);
  }
  .op.logic {
    font-weight: 700;
  }
  .grouped {
    display: inline-flex;
  }
  .punctuation {
    font-family: var(--mono);
    color: var(--muted2);
    font-size: 0.9em;
  }
  .grouping {
    font-weight: 700;
  }
</style>
