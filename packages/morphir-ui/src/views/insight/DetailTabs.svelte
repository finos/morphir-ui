<script lang="ts">
  let {
    tabs,
    active,
    onSelect,
  }: { tabs: { id: string; label: string }[]; active: string; onSelect: (id: string) => void } =
    $props()
</script>

<div class="tabs" role="tablist">
  {#each tabs as tab (tab.id)}
    <button
      class="tab"
      class:active={tab.id === active}
      role="tab"
      aria-selected={tab.id === active}
      onclick={() => onSelect(tab.id)}
    >
      {tab.label}
    </button>
  {/each}
</div>

<style>
  .tabs {
    display: flex;
    gap: 4px;
    border-bottom: 1px solid var(--edge);
    margin-bottom: 12px;
  }
  .tab {
    padding: 6px 14px;
    border: none;
    background: none;
    color: var(--muted);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    border-bottom: 2px solid transparent;
  }
  .tab:hover {
    color: var(--text);
  }
  .tab.active {
    color: var(--text-strong);
    border-bottom-color: var(--accent);
  }
</style>
