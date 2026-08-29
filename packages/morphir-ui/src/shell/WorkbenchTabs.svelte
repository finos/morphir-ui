<script lang="ts">
  import type { WorkbenchStore } from '../workbench/workbench-store.svelte.ts'
  import type { ModelRoute, WorkbenchEntry } from '../workbench/types.ts'

  let { entry, store }: { entry: WorkbenchEntry; store: WorkbenchStore } = $props()
  const current = $derived(
    store.openEntries.find((candidate) => candidate.descriptor.id === entry.descriptor.id) ?? entry,
  )
  const hasDecodedIr = $derived(
    current.status === 'ready' && current.data.kind === 'model' && !!current.data.ir,
  )
  const routes = $derived.by((): ReadonlyArray<readonly [ModelRoute, string]> =>
    current.descriptor.kind === 'model'
      ? [
          ['overview', 'Overview'],
          ...(hasDecodedIr ? ([['explorer', 'IR Explorer']] as const) : []),
        ]
      : [['overview', 'Overview']],
  )
</script>

<div class="tabs" role="tablist" aria-label={`${current.descriptor.name} views`}>
  {#each routes as [route, label] (route)}
    <button
      type="button"
      role="tab"
      aria-selected={current.descriptor.route === route}
      class:active={current.descriptor.route === route}
      onclick={() => store.selectRoute(current.descriptor.id, route)}>{label}</button
    >
  {/each}
</div>

<style>
  .tabs {
    display: flex;
    min-height: 40px;
    padding: 0 22px;
    gap: 18px;
    border-bottom: 1px solid var(--edge);
    background: var(--surface);
  }
  button {
    position: relative;
    border: 0;
    padding: 0;
    background: none;
    color: var(--muted);
    font-size: 12.5px;
    cursor: pointer;
  }
  button:hover,
  button.active {
    color: var(--text-strong);
  }
  button.active::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 2px;
    background: linear-gradient(90deg, var(--accent), var(--accent2));
  }
</style>
