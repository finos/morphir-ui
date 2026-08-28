<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { ViewNode } from '@morphir/insight'

  let { node, render }: { node: Extract<ViewNode, { kind: 'v-fraction' }>; render: Snippet<[ViewNode]> } = $props()
</script>

<span class="fraction">
  <span class="num">{@render render(node.numerator)}</span>
  <span class="den">{@render render(node.denominator)}</span>
</span>

<style>
  .fraction {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    vertical-align: middle;
    font-size: 12.5px;
  }
  .num { padding: 0 4px 2px 4px; }
  .den { padding: 2px 4px 0 4px; border-top: 1px solid var(--row-edge); }
</style>
