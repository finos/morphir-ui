<script lang="ts">
  import type { Snippet } from 'svelte'
  let {
    region,
    extent,
    children,
  }: { region: 'left' | 'right' | 'bottom'; extent: number; children: Snippet } = $props()
</script>

<div class="region region-{region}" data-region={region} style:--region-extent="{extent}px">
  {@render children()}
</div>

<style>
  .region {
    overflow: hidden;
    flex-shrink: 0;
    display: flex;
    transition:
      width var(--slide-ms) ease-in-out,
      height var(--slide-ms) ease-in-out;
  }
  .region-left,
  .region-right {
    width: var(--region-extent);
  }
  .region-bottom {
    height: var(--region-extent);
  }
  .region-left {
    border-right: 1px solid var(--edge);
    background: var(--rail);
  }
  .region-right {
    border-left: 1px solid var(--edge);
    background: var(--panel);
  }
  .region-bottom {
    border-top: 1px solid var(--edge);
    background: var(--panel);
  }
</style>
