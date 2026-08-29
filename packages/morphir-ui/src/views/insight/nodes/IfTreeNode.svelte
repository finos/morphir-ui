<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { ViewNode } from '@morphir/insight'

  let {
    node,
    render,
  }: { node: Extract<ViewNode, { kind: 'v-if-tree' }>; render: Snippet<[ViewNode]> } = $props()

  const lastElseLabel = $derived(node.branches.at(-1)?.elseLabel ?? 'No')
  // No inline style= — indentation is expressed with a small fixed set of depth classes
  // (real DOM nesting would be another option, but this keeps the markup flat and readable).
  const depthClass = (i: number) => `depth-${Math.min(i, 6)}`
</script>

<div class="if-tree">
  {#each node.branches as b, i (i)}
    <div class={`branch ${depthClass(i)}`}>
      <span class="q">?</span>
      {@render render(b.condition)}
      <span class="arrow">→</span> <span class="label">{b.thenLabel}:</span>
      {@render render(b.result)}
    </div>
  {/each}
  <div class={`branch fallback ${depthClass(node.branches.length)}`}>
    <span class="label">{lastElseLabel}:</span>
    {@render render(node.fallback)}
  </div>
</div>

<style>
  .if-tree {
    font-size: 12.5px;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .branch {
    display: flex;
    align-items: baseline;
    gap: 5px;
  }
  .q {
    color: var(--muted2);
    font-family: var(--mono);
  }
  .arrow {
    color: var(--muted);
  }
  .label {
    color: var(--accent2);
  }
  .depth-0 {
    margin-left: 0;
  }
  .depth-1 {
    margin-left: 14px;
  }
  .depth-2 {
    margin-left: 28px;
  }
  .depth-3 {
    margin-left: 42px;
  }
  .depth-4 {
    margin-left: 56px;
  }
  .depth-5 {
    margin-left: 70px;
  }
  .depth-6 {
    margin-left: 84px;
  }
</style>
