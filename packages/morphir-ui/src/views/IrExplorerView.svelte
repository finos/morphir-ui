<script lang="ts">
  import type { ModelWorkbenchData } from '../workbench/types.ts'
  import DefinitionDetail from './insight/DefinitionDetail.svelte'
  import Icon from '../icons/Icon.svelte'
  import { nameToCamel, nameToTitle, pathToTitle, type RawDefEntry } from '@morphir/ir'
  import type { InspectMeta } from './insight/insight-context.ts'

  let { model, onInspect }: { model: ModelWorkbenchData; onInspect?: (meta: InspectMeta) => void } =
    $props()

  let search = $state('')
  let showTypes = $state(true)
  let showValues = $state(true)
  let selectedModule = $state<string | null>(null)

  const ir = $derived(model.ir)
  const activeModule = $derived(selectedModule ?? ir?.modules[0]?.name ?? null)
  const definitions = $derived(
    (ir?.definitions ?? []).filter(
      (d) =>
        d.ref.moduleName === activeModule &&
        (d.kind === 'type' ? showTypes : showValues) &&
        d.ref.localName.toLowerCase().includes(search.toLowerCase()),
    ),
  )

  let selected = $state<{ info: (typeof definitions)[number]; entry: RawDefEntry } | null>(null)

  const findEntry = (
    moduleName: string,
    localName: string,
    kind: 'type' | 'value',
  ): RawDefEntry | null => {
    const lib = model.library
    if (!lib) return null
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
</script>

{#if !ir}
  <section class="card">
    <p class="muted">Decoded IR is not available for this Model Workbench.</p>
  </section>
{:else}
  <section class="card">
    <h2 class="card-title">Package</h2>
    <div class="pkg">{ir.package.name}</div>
    <div class="muted">{ir.package.moduleCount} modules</div>
  </section>
  <section class="card">
    <h2 class="card-title">Modules</h2>
    {#each ir.modules as m (m.name)}
      <button
        class="mod"
        class:active={m.name === activeModule}
        onclick={() => (selectedModule = m.name)}
      >
        {m.name}<span class="counts">{m.typeCount}T / {m.valueCount}V</span>
      </button>
    {/each}
  </section>
  <section class="card">
    <h2 class="card-title">Definitions</h2>
    {#if selected}
      <button class="back" onclick={() => (selected = null)}><Icon name="back" /> Back</button>
      <DefinitionDetail
        entry={selected.entry}
        kind={selected.info.kind}
        moduleName={selected.info.ref.moduleName}
        packageName={selected.info.ref.packageName}
        library={model.library!}
        onSelect={onInspect}
      />
    {:else}
      <div class="filter">
        <input placeholder="Filter definitions" bind:value={search} />
        <button class="toggle" class:on={showTypes} onclick={() => (showTypes = !showTypes)}
          >Types</button
        >
        <button class="toggle" class:on={showValues} onclick={() => (showValues = !showValues)}
          >Values</button
        >
      </div>
      {#each definitions as d (d.ref.localName + d.kind)}
        <button
          class="def"
          onclick={() => {
            const entry = findEntry(d.ref.moduleName, d.ref.localName, d.kind)
            if (entry) selected = { info: d, entry }
          }}
        >
          <span class="def-name">{d.ref.localName}</span>
          <span class="def-kind">{d.kind}</span>
          <span class="def-access">{d.access}</span>
          {#if d.doc}<span class="def-doc">{d.doc}</span>{/if}
        </button>
      {:else}
        <p class="muted">No definitions match.</p>
      {/each}
    {/if}
  </section>
{/if}

<style>
  .card {
    background: var(--panel);
    border: 1px solid var(--panel-edge);
    border-radius: 10px;
    padding: 16px;
  }
  .card-title {
    font-family: var(--mono);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--muted2);
    margin-bottom: 10px;
  }
  .pkg {
    font-weight: 600;
    color: var(--text-strong);
  }
  .muted {
    color: var(--muted);
    font-size: 13px;
  }
  .mod {
    display: flex;
    justify-content: space-between;
    width: 100%;
    padding: 7px 10px;
    border-radius: 8px;
    background: none;
    border: none;
    color: var(--nav);
    cursor: pointer;
    font-size: 13.5px;
  }
  .mod:hover {
    background: var(--hover-soft);
    color: var(--text);
  }
  .mod.active {
    background: var(--hover);
    color: var(--text-strong);
  }
  .counts {
    font-family: var(--mono);
    font-size: 11px;
    color: var(--muted2);
  }
  .filter {
    display: flex;
    gap: 8px;
    margin-bottom: 10px;
  }
  .filter input {
    flex: 1;
    padding: 6px 10px;
    border-radius: 8px;
    border: 1px solid var(--panel-edge);
    background: var(--code-bg);
    color: var(--text);
    font-size: 13px;
  }
  .toggle {
    padding: 5px 10px;
    border-radius: 8px;
    border: 1px solid var(--panel-edge);
    background: none;
    color: var(--muted);
    cursor: pointer;
    font-size: 12.5px;
  }
  .toggle.on {
    color: var(--accent-text);
    background: rgba(214, 64, 159, 0.14);
    border-color: rgba(214, 64, 159, 0.35);
  }
  .def {
    display: flex;
    width: 100%;
    gap: 10px;
    align-items: baseline;
    padding: 6px 0;
    border-bottom: 1px solid var(--row-edge);
    background: none;
    border-left: none;
    border-right: none;
    border-top: none;
    text-align: left;
    cursor: pointer;
  }
  .back {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 8px 10px;
    margin-bottom: 10px;
    border-radius: 8px;
    background: none;
    border: none;
    color: var(--muted);
    cursor: pointer;
    text-align: left;
  }
  .back:hover {
    background: var(--hover);
    color: var(--text);
  }
  .def-name {
    font-family: var(--mono);
    font-size: 13px;
    color: var(--text-strong);
  }
  .def-kind {
    font-size: 11px;
    color: var(--accent2);
  }
  .def-access {
    font-size: 11px;
    color: var(--muted2);
  }
  .def-doc {
    font-size: 12px;
    color: var(--muted);
  }
</style>
