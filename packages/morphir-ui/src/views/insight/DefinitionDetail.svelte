<script lang="ts">
  import DetailTabs from './DetailTabs.svelte'
  import XRayView from './XRayView.svelte'
  import InsightView from './InsightView.svelte'
  import {
    decodeEntryValueDef,
    nameToCamel,
    nameToTitle,
    type MorphirLibrary,
    type RawDefEntry,
  } from '@morphir/ir'
  import type { InspectMeta } from './insight-context.ts'
  import type { DetailView } from '../../state/shell-constants.ts'

  let {
    entry,
    kind,
    moduleName,
    packageName,
    library,
    onSelect,
    activeView,
    selectedXRayPath,
    onViewSelect,
    onXRaySelect,
  }: {
    entry: RawDefEntry
    kind: 'type' | 'value'
    moduleName: string
    packageName: string
    library: MorphirLibrary
    onSelect?: (meta: InspectMeta) => void
    activeView?: DetailView
    selectedXRayPath?: string | null
    onViewSelect?: (view: DetailView) => void
    onXRaySelect?: (path: string) => void
  } = $props()

  const displayName = $derived(kind === 'value' ? nameToCamel(entry.name) : nameToTitle(entry.name))
  const tabs = $derived<{ id: DetailView; label: string }[]>(
    kind === 'value'
      ? [
          { id: 'insight', label: 'Insight' },
          { id: 'xray', label: 'XRay' },
        ]
      : [
          { id: 'type', label: 'Type' },
          { id: 'xray', label: 'XRay' },
        ],
  )
  let localActive = $state<DetailView>('insight')
  let previousKind = $state<'type' | 'value' | null>(null)
  const active = $derived(viewForKind(kind, activeView ?? localActive))
  const def = $derived(kind === 'value' ? decodeEntryValueDef(entry) : null)

  $effect(() => {
    if (kind === previousKind) return
    previousKind = kind
    if (activeView === undefined) localActive = kind === 'value' ? 'insight' : 'type'
  })

  function viewForKind(definitionKind: 'type' | 'value', requested: DetailView): DetailView {
    if (requested === 'xray') return 'xray'
    return definitionKind === 'value' ? 'insight' : 'type'
  }

  function selectView(view: DetailView): void {
    const compatible = viewForKind(kind, view)
    if (activeView === undefined) localActive = compatible
    onViewSelect?.(compatible)
  }
</script>

<section class="card">
  <header class="head">
    <span class="fqn">{packageName}.{moduleName}.<span class="local">{displayName}</span></span>
    {#if entry.doc}<span class="doc">{entry.doc}</span>{/if}
  </header>
  <DetailTabs {tabs} {active} onSelect={(view) => selectView(view as DetailView)} />
  {#if active === 'insight' && kind === 'value'}
    <InsightView {def} {library} definitionName={displayName} {onSelect} />
  {:else if active === 'xray' && kind === 'value'}
    <XRayView {def} selectedPath={selectedXRayPath} onSelectedPath={onXRaySelect} />
  {:else}
    <XRayView
      typeRaw={entry.rawDefinition}
      selectedPath={selectedXRayPath}
      onSelectedPath={onXRaySelect}
    />
  {/if}
</section>

<style>
  .card {
    background: var(--panel);
    border: 1px solid var(--panel-edge);
    border-radius: 10px;
    padding: 16px;
  }
  .head {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 10px;
  }
  .fqn {
    font-family: var(--mono);
    font-size: 12.5px;
    color: var(--muted);
  }
  .local {
    color: var(--text-strong);
  }
  .doc {
    font-size: 12.5px;
    color: var(--muted);
  }
</style>
