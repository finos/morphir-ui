<script lang="ts">
  import {
    decodeEntryValueDef,
    decodeTypeExpr,
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
  import type { DetailView } from '../state/shell-constants.ts'
  import {
    definitionForFqn,
    definitionFqn,
    type DetailLocation,
    type DetailResolution,
  } from './insight/detail-location.ts'
  import {
    projectXRayDefinition,
    projectXRayValue,
    type XRayTreeNode,
  } from './insight/xray-tree.ts'
  import type { Snippet } from 'svelte'

  let {
    model,
    onInspect,
    treeLeading,
    selectedDefinitionId,
    onSelectedDefinition,
    detailLocation,
    onDetailLocation,
    onDetailResolution,
  }: {
    model: ModelWorkbenchData
    onInspect?: (meta: InspectMeta) => void
    treeLeading?: Snippet
    selectedDefinitionId?: string | null
    onSelectedDefinition?: (definitionId: string | null) => void
    detailLocation?: DetailLocation
    onDetailLocation?: (location: DetailLocation) => void
    onDetailResolution?: (resolution: DetailResolution) => void
  } = $props()

  const ir = $derived(model.ir)
  let selected = $state<{ info: DefinitionInfo; entry: RawDefEntry } | null>(null)
  let resolutionError = $state<string | null>(null)
  let stateModelId = $state('')
  let previousResolutionCallback: typeof onDetailResolution
  let previousResolutionKey = ''
  const locationInfo = $derived(
    detailLocation && ir ? definitionForFqn(ir.definitions, detailLocation.definition) : null,
  )
  const locationEntry = $derived(
    locationInfo
      ? findEntry(
          locationInfo.ref.packageName,
          locationInfo.ref.moduleName,
          locationInfo.ref.localName,
          locationInfo.kind,
        )
      : null,
  )
  const controlledInfo = $derived(
    selectedDefinitionId === undefined
      ? null
      : (ir?.definitions.find(
          (definition) => definitionNodeId(definition) === selectedDefinitionId,
        ) ?? null),
  )
  const controlledEntry = $derived(
    controlledInfo
      ? findEntry(
          controlledInfo.ref.packageName,
          controlledInfo.ref.moduleName,
          controlledInfo.ref.localName,
          controlledInfo.kind,
        )
      : null,
  )
  const currentSelected = $derived(
    selectedDefinitionId === undefined
      ? detailLocation
        ? locationInfo && locationEntry
          ? { info: locationInfo, entry: locationEntry }
          : null
        : stateModelId === model.descriptor.id
          ? selected
          : null
      : controlledInfo && controlledEntry
        ? { info: controlledInfo, entry: controlledEntry }
        : null,
  )
  const currentResolutionError = $derived(
    detailLocation
      ? ir && (!locationInfo || !locationEntry)
        ? detailLocation.definition
        : null
      : selectedDefinitionId === undefined
        ? stateModelId === model.descriptor.id
          ? resolutionError
          : null
        : selectedDefinitionId && !currentSelected
          ? selectedDefinitionId
          : null,
  )
  const selectedId = $derived(currentSelected ? definitionNodeId(currentSelected.info) : null)
  const locationPathIndex = $derived.by(() => {
    if (!locationInfo || !locationEntry) return null
    const roots =
      locationInfo.kind === 'value'
        ? (() => {
            const def = decodeEntryValueDef(locationEntry)
            return def ? projectXRayDefinition(def) : []
          })()
        : [projectXRayValue(decodeTypeExpr(locationEntry.rawDefinition), 'type', '/type')]
    return indexXRayPaths(roots)
  })
  const detailResolution = $derived.by(() => resolveDetailLocation())

  $effect(() => {
    const nextModelId = model.descriptor.id
    if (nextModelId !== stateModelId) {
      stateModelId = nextModelId
      selected = null
      resolutionError = null
    }
  })

  $effect(() => {
    if (!detailLocation || !locationInfo || !locationEntry || selectedDefinitionId === undefined)
      return
    const definitionId = definitionNodeId(locationInfo)
    if (definitionId !== selectedDefinitionId) onSelectedDefinition?.(definitionId)
  })

  $effect(() => {
    const callback = onDetailResolution
    const resolution = detailResolution
    if (!callback || !resolution) {
      previousResolutionCallback = callback
      previousResolutionKey = ''
      return
    }
    const key = JSON.stringify([detailLocation, resolution])
    if (callback === previousResolutionCallback && key === previousResolutionKey) return
    previousResolutionCallback = callback
    previousResolutionKey = key
    callback(resolution)
  })

  function findEntry(
    packageName: string,
    moduleName: string,
    localName: string,
    kind: 'type' | 'value',
  ): RawDefEntry | null {
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

  function resolveDetailLocation(): DetailResolution | null {
    if (!detailLocation) return null
    if (!ir) return { kind: 'pending' }
    if (!locationInfo || !locationEntry) {
      return { kind: 'invalid-definition', definition: detailLocation.definition }
    }
    if (!detailLocation.node) return { kind: 'resolved' }

    return locationPathIndex?.has(detailLocation.node)
      ? { kind: 'resolved' }
      : {
          kind: 'invalid-node',
          definition: detailLocation.definition,
          node: detailLocation.node,
        }
  }

  function indexXRayPaths(roots: readonly XRayTreeNode[]): ReadonlySet<string> {
    // This derived index is immutable after construction; it does not own reactive state.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const paths = new Set<string>()
    const stack = [...roots]
    while (stack.length > 0) {
      const node = stack.pop()
      if (!node) continue
      paths.add(node.path)
      stack.push(...node.children)
    }
    return paths
  }

  function compatibleView(kind: 'type' | 'value', requested?: DetailView): DetailView {
    if (requested === 'xray') return 'xray'
    return kind === 'value' ? 'insight' : 'type'
  }

  function emitDefinitionLocation(info: DefinitionInfo): void {
    const definition = definitionFqn(info)
    const sameDefinition = detailLocation?.definition === definition
    const view = compatibleView(info.kind, detailLocation?.view)
    onDetailLocation?.({
      definition,
      view,
      ...(sameDefinition && detailLocation?.node ? { node: detailLocation.node } : {}),
    })
  }

  function selectDetailView(view: DetailView): void {
    if (!currentSelected) return
    onDetailLocation?.({
      definition: definitionFqn(currentSelected.info),
      view,
      ...(detailLocation?.node ? { node: detailLocation.node } : {}),
    })
  }

  function selectXRayPath(path: string): void {
    if (!currentSelected) return
    onDetailLocation?.({
      definition: definitionFqn(currentSelected.info),
      view: 'xray',
      node: path,
    })
  }

  function selectDefinition(info: DefinitionInfo): void {
    emitDefinitionLocation(info)
    if (selectedDefinitionId !== undefined) {
      onSelectedDefinition?.(definitionNodeId(info))
      return
    }
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
      <ModelTreePane {ir} {selectedId} onSelect={selectDefinition} leading={treeLeading} />
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
          activeView={detailLocation?.view}
          selectedXRayPath={detailLocation?.node}
          onViewSelect={selectDetailView}
          onXRaySelect={selectXRayPath}
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
