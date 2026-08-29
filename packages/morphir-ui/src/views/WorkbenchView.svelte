<script lang="ts">
  import OverviewView from './OverviewView.svelte'
  import IrExplorerView from './IrExplorerView.svelte'
  import DevelopmentWorkbenchView from './DevelopmentWorkbenchView.svelte'
  import WorkbenchErrorView from './WorkbenchErrorView.svelte'
  import type { WorkbenchStore } from '../workbench/workbench-store.svelte.ts'
  import type { WorkbenchEntry } from '../workbench/types.ts'
  import type { InspectMeta } from './insight/insight-context.ts'

  let {
    entry,
    store,
    onInspect,
  }: { entry: WorkbenchEntry; store: WorkbenchStore; onInspect?: (meta: InspectMeta) => void } =
    $props()
</script>

{#if entry.status === 'loading'}
  <section class="loading" aria-live="polite">Loading {entry.descriptor.name}…</section>
{:else if entry.status === 'error'}
  <WorkbenchErrorView
    name={entry.descriptor.name}
    message={entry.message}
    onRetry={() => void store.retry(entry.descriptor.id)}
  />
{:else if entry.data.kind === 'development'}
  <DevelopmentWorkbenchView workbench={entry.data} />
{:else if entry.descriptor.route === 'explorer' && entry.data.ir}
  <IrExplorerView model={entry.data} {onInspect} />
{:else}
  <OverviewView model={entry.data} />
{/if}

<style>
  .loading {
    grid-column: 1 / -1;
    padding: 28px;
    color: var(--muted);
  }
</style>
