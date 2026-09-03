<script lang="ts">
  import OverviewView from './OverviewView.svelte'
  import IrExplorerView from './IrExplorerView.svelte'
  import DevelopmentWorkbenchView from './DevelopmentWorkbenchView.svelte'
  import WorkbenchErrorView from './WorkbenchErrorView.svelte'
  import { recoveryActionLabel } from '../workbench/project-model-state.ts'
  import type { WorkbenchStore } from '../workbench/workbench-store.svelte.ts'
  import type { WorkbenchEntry } from '../workbench/types.ts'
  import type { InspectMeta } from './insight/insight-context.ts'
  import type { DetailLocation, DetailResolution } from './insight/detail-location.ts'

  let {
    entry,
    store,
    onInspect,
    detailLocation,
    onDetailLocation,
    onDetailResolution,
  }: {
    entry: WorkbenchEntry
    store: WorkbenchStore
    onInspect?: (meta: InspectMeta) => void
    detailLocation?: DetailLocation
    onDetailLocation?: (location: DetailLocation) => void
    onDetailResolution?: (resolution: DetailResolution) => void
  } = $props()
</script>

{#if entry.status === 'loading'}
  <section class="loading" aria-live="polite">Loading {entry.descriptor.name}…</section>
{:else if entry.status === 'error'}
  <WorkbenchErrorView
    name={entry.descriptor.name}
    message={entry.reason.message}
    actionLabel={recoveryActionLabel(entry.reason)}
    onRetry={() => void store.retry(entry.descriptor.id)}
  />
{:else if entry.status === 'unavailable'}
  <DevelopmentWorkbenchView
    workbench={entry.data}
    navigation={store.developmentNavigation(entry.descriptor.id)}
    unavailableReason={entry.reason}
    onRecoverWorkbench={() => void store.retry(entry.descriptor.id)}
    onSelectProject={(projectId) =>
      void store.selectDevelopmentProject(entry.descriptor.id, projectId)}
    onRetryProject={(projectId) =>
      void store.retryDevelopmentProject(entry.descriptor.id, projectId)}
    onSelectDefinition={(projectId, definitionId) =>
      store.selectDevelopmentDefinition(entry.descriptor.id, projectId, definitionId)}
    {onInspect}
    {detailLocation}
    {onDetailLocation}
    {onDetailResolution}
  />
{:else if entry.data.kind === 'development'}
  <DevelopmentWorkbenchView
    workbench={entry.data}
    navigation={store.developmentNavigation(entry.descriptor.id)}
    onSelectProject={(projectId) =>
      void store.selectDevelopmentProject(entry.descriptor.id, projectId)}
    onRetryProject={(projectId) =>
      void store.retryDevelopmentProject(entry.descriptor.id, projectId)}
    onSelectDefinition={(projectId, definitionId) =>
      store.selectDevelopmentDefinition(entry.descriptor.id, projectId, definitionId)}
    {onInspect}
    {detailLocation}
    {onDetailLocation}
    {onDetailResolution}
  />
{:else if entry.descriptor.route === 'explorer' && entry.data.ir}
  <IrExplorerView
    model={entry.data}
    {onInspect}
    {detailLocation}
    {onDetailLocation}
    {onDetailResolution}
  />
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
