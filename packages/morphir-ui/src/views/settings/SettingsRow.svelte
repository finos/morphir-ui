<script lang="ts">
  import type { Snippet } from 'svelte'
  let {
    label,
    description = '',
    trailing,
  }: { label: string; description?: string; trailing?: Snippet } = $props()
</script>

<div class="settings-row">
  <div class="row-text">
    <div class="row-label">{label}</div>
    {#if description}<div class="row-desc">{description}</div>{/if}
  </div>
  <div class="row-trailing">
    {#if trailing}{@render trailing()}{/if}
  </div>
</div>

<style>
  .settings-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 12px 0;
    border-bottom: 1px solid var(--row-edge);
  }
  .row-label {
    font-weight: 500;
    color: var(--text);
  }
  .row-desc {
    font-size: 12.5px;
    color: var(--muted);
    margin-top: 2px;
  }
  .row-trailing {
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: var(--mono);
    font-size: 12.5px;
    color: var(--accent-text);
  }
</style>
