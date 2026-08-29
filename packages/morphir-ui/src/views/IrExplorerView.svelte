<script lang="ts">
  import {
    nameToCamel,
    nameToTitle,
    pathToTitle,
    type DefinitionInfo,
    type RawDefEntry,
  } from '@morphir/ir'
  import type { ModelWorkbenchData } from '../workbench/types.ts'
  import DefinitionDetail from './insight/DefinitionDetail.svelte'
  import type { InspectMeta } from './insight/insight-context.ts'
  import ModelTreePane from './model-tree/ModelTreePane.svelte'
  import { definitionNodeId } from './model-tree/model-tree.ts'

  let { model, onInspect }: { model: ModelWorkbenchData; onInspect?: (meta: InspectMeta) => void } =
    $props()

  const ir = $derived(model.ir)
  let selected = $state<{ info: DefinitionInfo; entry: RawDefEntry } | null>(null)
  let resolutionError = $state<string | null>(null)
  let stateModelId = $state('')
  const currentSelected = $derived(stateModelId === model.descriptor.id ? selected : null)
  const currentResolutionError = $derived(
    stateModelId === model.descriptor.id ? resolutionError : null,
  )
  const selectedId = $derived(currentSelected ? definitionNodeId(currentSelected.info) : null)

  $effect(() => {
    const nextModelId = model.descriptor.id
    if (nextModelId !== stateModelId) {
      stateModelId = nextModelId
      selected = null
      resolutionError = null
    }
  })

  const findEntry = (
    packageName: string,
    moduleName: string,
    localName: string,
    kind: 'type' | 'value',
  ): RawDefEntry | null => {
    const lib = model.library
    if (!lib || pathToTitle(lib.packageName) !== packageName) return null
    for (const m of lib.modules) {
      if (pathToTitle(m.path) !== moduleName) continue
      const entries = kind === 'type' ? m.types : m.values
      for (const e of entries) {
        const display = kind === 'type' ? nameToTitle(e.name) : nameToCamel(e.name)
        if (display === localName) return e
      }
    }
    return null
  }

  function selectDefinition(info: DefinitionInfo): void {
    const entry = findEntry(
      info.ref.packageName,
      info.ref.moduleName,
      info.ref.localName,
      info.kind,
    )
    stateModelId = model.descriptor.id
    if (entry) {
      selected = { info, entry }
      resolutionError = null
      return
    }

    selected = null
    resolutionError = `${info.ref.packageName}.${info.ref.moduleName}.${info.ref.localName}`
  }
</script>

{#if !ir}
  <section class="card unavailable">
    <p class="muted">Decoded IR is not available for this Model Workbench.</p>
  </section>
{:else}
  <section class="ir-explorer">
    {#key model.descriptor.id}
      <ModelTreePane {ir} {selectedId} onSelect={selectDefinition} />
    {/key}
    <div class="definition-detail">
      {#if currentResolutionError}
        <section class="detail-state" role="alert">
          <h2>Definition unavailable</h2>
          <p>
            <span class="definition-name">{currentResolutionError}</span> could not be found in the decoded
            library.
          </p>
        </section>
      {:else if currentSelected && model.library}
        <DefinitionDetail
          entry={currentSelected.entry}
          kind={currentSelected.info.kind}
          moduleName={currentSelected.info.ref.moduleName}
          packageName={currentSelected.info.ref.packageName}
          library={model.library}
          onSelect={onInspect}
        />
      {:else}
        <section class="detail-state">
          <h2>Select a definition</h2>
          <p>Choose a type or value from the model hierarchy.</p>
        </section>
      {/if}
    </div>
  </section>
{/if}

<style>
  .ir-explorer {
    display: flex;
    flex: 1;
    width: 100%;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: var(--bg);
  }
  .definition-detail {
    flex: 1;
    min-width: 0;
    overflow: auto;
    padding: 16px;
  }
  .detail-state,
  .card {
    box-sizing: border-box;
    width: 100%;
    max-width: 620px;
    border: 1px solid var(--panel-edge);
    border-radius: 10px;
    background: var(--panel);
  }
  .detail-state {
    max-width: 620px;
    margin: 8vh auto;
    padding: 20px;
  }
  .card {
    margin: 0 auto;
    padding: 16px;
  }
  .detail-state h2 {
    margin: 0 0 4px;
    color: var(--text-strong);
    font-size: 16px;
  }
  .detail-state p,
  .muted {
    margin: 0;
    color: var(--muted);
    font-size: 13px;
  }
  .definition-name {
    color: var(--text-strong);
    font-family: var(--mono);
  }
  .unavailable {
    grid-column: 1 / -1;
  }
</style>
