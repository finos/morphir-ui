<script lang="ts">
  import DetailTabs from './DetailTabs.svelte'
  import XRayView from './XRayView.svelte'
  import { decodeEntryValueDef, nameToCamel, nameToTitle, type RawDefEntry } from '@morphir/ir'

  let {
    entry,
    kind,
    moduleName,
    packageName
  }: { entry: RawDefEntry; kind: 'type' | 'value'; moduleName: string; packageName: string } = $props()

  const displayName = $derived(kind === 'value' ? nameToCamel(entry.name) : nameToTitle(entry.name))
  const tabs = $derived(kind === 'value' ? [{ id: 'xray', label: 'XRay' }] : [{ id: 'type', label: 'Type' }, { id: 'xray', label: 'XRay' }])
  let active = $derived(tabs[0]!.id)
  const def = $derived(kind === 'value' ? decodeEntryValueDef(entry) : null)
</script>

<section class="card">
  <header class="head">
    <span class="fqn">{packageName}.{moduleName}.<span class="local">{displayName}</span></span>
    {#if entry.doc}<span class="doc">{entry.doc}</span>{/if}
  </header>
  <DetailTabs {tabs} {active} onSelect={(id) => (active = id)} />
  {#if active === 'xray' && kind === 'value'}
    <XRayView {def} />
  {:else}
    <XRayView typeRaw={entry.rawDefinition} />
  {/if}
</section>

<style>
  .card { background: var(--panel); border: 1px solid var(--panel-edge); border-radius: 10px; padding: 16px; }
  .head { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
  .fqn { font-family: var(--mono); font-size: 12.5px; color: var(--muted); }
  .local { color: var(--text-strong); }
  .doc { font-size: 12.5px; color: var(--muted); }
</style>
