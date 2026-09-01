<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import AppShell from './AppShell.svelte'
  import WorkbenchTabs from './WorkbenchTabs.svelte'
  import WorkbenchView from '../views/WorkbenchView.svelte'
  import SettingsView from '../views/settings/SettingsView.svelte'
  import { ShellState, type SettingsSection } from '../state/shell-state.svelte.ts'
  import { WorkbenchStore } from '../workbench/workbench-store.svelte.ts'
  import { configToSnapshot, withSnapshot, type UiConfig } from '../services/config.ts'
  import type { AppServices } from '../services/services.ts'
  import type { InspectMeta } from '../views/insight/insight-context.ts'
  import type { WorkbenchSourceRef } from '@morphir/workspace'

  let {
    services,
    badge,
    version,
    initialConfig,
    initialSources = [],
    registerOpenSources,
    macChrome = false,
  }: {
    services: AppServices
    badge: string
    version: string
    initialConfig: UiConfig
    initialSources?: ReadonlyArray<WorkbenchSourceRef>
    registerOpenSources?: (
      handler: (sources: ReadonlyArray<WorkbenchSourceRef>) => void,
    ) => () => void
    macChrome?: boolean
  } = $props()

  const SECTION_LABELS: Record<SettingsSection, string> = {
    general: 'General',
    appearance: 'Appearance',
    github: 'GitHub',
    about: 'About',
  }

  const shell = untrack(() => {
    const state = new ShellState()
    state.hydrate(configToSnapshot(initialConfig))
    return state
  })
  const workbenches = untrack(() => new WorkbenchStore(services, initialConfig.workbenches))
  let inspected = $state<InspectMeta | null>(null)
  let inspectedWorkbenchId: string | null = null

  const crumbTitle = $derived(
    shell.route.kind === 'settings'
      ? SECTION_LABELS[shell.route.section]
      : (workbenches.active?.descriptor.name ?? 'Workbenches'),
  )
  const explorerActive = $derived.by(() => {
    const active = workbenches.active
    return (
      (active?.status === 'ready' || active?.status === 'unavailable') &&
      ((active.descriptor.kind === 'development' && active.data.kind === 'development') ||
        (active.descriptor.kind === 'model' &&
          active.data.kind === 'model' &&
          active.descriptor.route === 'explorer' &&
          active.data.ir !== null))
    )
  })

  let saveTimer: ReturnType<typeof setTimeout> | undefined
  $effect(() => {
    const snap = shell.snapshot()
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      void services.updateConfig((cfg) => withSnapshot(cfg, snap))
    }, 200)
    // pending save is cancelled on unmount — acceptable: layout deltas <200ms before teardown are droppable
    return () => clearTimeout(saveTimer)
  })

  $effect(() => {
    const activeId = workbenches.activeId
    if (inspectedWorkbenchId !== activeId) {
      inspectedWorkbenchId = activeId
      inspected = null
    }
  })

  onMount(() => {
    void workbenches.restore(initialSources)
    const unsubscribe = registerOpenSources?.((sources) => {
      void (async () => {
        const activeBefore = workbenches.activeId
        let firstOpened: string | null = null
        for (const source of sources) {
          const openedId = await workbenches.open(source)
          if (!firstOpened) firstOpened = openedId
        }
        if (firstOpened) workbenches.activate(firstOpened)
        else if (activeBefore) workbenches.activate(activeBefore)
      })()
    })
    return () => {
      unsubscribe?.()
      workbenches.dispose()
    }
  })
</script>

<AppShell
  {shell}
  {badge}
  {version}
  {crumbTitle}
  store={workbenches}
  onOpenSettings={() => shell.openSettings()}
  {macChrome}
>
  {#snippet center()}
    {#if shell.isSettings}
      <SettingsView {services} {shell} store={workbenches} {version} />
    {:else if workbenches.active}
      <div class="workbench-content">
        <WorkbenchTabs entry={workbenches.active} store={workbenches} />
        <div class="workbench-view" class:workbench-view-explorer={explorerActive}>
          <WorkbenchView
            entry={workbenches.active}
            store={workbenches}
            onInspect={(meta) => (inspected = meta)}
          />
        </div>
      </div>
    {:else}
      <section class="welcome">
        <h1>Open a Workbench</h1>
        <p>Explore a Morphir model or open a development root.</p>
        <div>
          <button type="button" onclick={() => void workbenches.openPicked('model-file')}
            >Open model file</button
          >
          <button type="button" onclick={() => void workbenches.openPicked('folder')}
            >Open folder</button
          >
        </div>
      </section>
    {/if}
  {/snippet}
  {#snippet inspector()}
    {#if inspected}
      <div class="inspector">
        {#if inspected.fqn}<div class="fqn">{inspected.fqn}</div>{/if}
        <div class="kind">{inspected.kindLabel}</div>
        {#if inspected.doc}<div class="doc">{inspected.doc}</div>{/if}
      </div>
    {:else}
      <span class="empty">Select a node to inspect</span>
    {/if}
  {/snippet}
</AppShell>

<style>
  .workbench-content {
    display: flex;
    flex-direction: column;
    height: calc(100% + 44px);
    min-width: 0;
    min-height: 0;
    margin: -22px;
  }
  .workbench-view {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(380px, 1fr));
    align-content: start;
    gap: 16px;
    padding: 22px;
    overflow: auto;
  }
  .workbench-view-explorer {
    display: flex;
    grid-template-columns: none;
    gap: 0;
    padding: 0;
    overflow: hidden;
  }
  .welcome {
    grid-column: 1 / -1;
    max-width: 560px;
    margin: 8vh auto;
    text-align: center;
  }
  .welcome h1 {
    margin: 0 0 8px;
    color: var(--text-strong);
  }
  .welcome p {
    color: var(--muted);
  }
  .welcome div {
    display: flex;
    justify-content: center;
    gap: 8px;
    margin-top: 18px;
  }
  .welcome button {
    padding: 8px 14px;
    border: 1px solid var(--panel-edge);
    border-radius: 8px;
    background: var(--panel);
    color: var(--text);
    cursor: pointer;
  }
  .inspector {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .fqn {
    font-family: var(--mono);
    font-size: 12px;
    color: var(--text-strong);
    word-break: break-word;
  }
  .kind {
    font-size: 11px;
    color: var(--accent2);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .doc {
    font-size: 12.5px;
    color: var(--muted);
  }
  .empty {
    font-size: 12.5px;
    color: var(--muted);
  }
</style>
