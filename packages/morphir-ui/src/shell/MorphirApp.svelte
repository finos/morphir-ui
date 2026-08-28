<script lang="ts">
  import { onMount } from 'svelte'
  import AppShell from './AppShell.svelte'
  import OverviewView from '../views/OverviewView.svelte'
  import IrExplorerView from '../views/IrExplorerView.svelte'
  import SettingsView from '../views/settings/SettingsView.svelte'
  import { ShellState, type SettingsSection } from '../state/shell-state.svelte.ts'
  import { WorkspaceState } from '../state/workspace-state.svelte.ts'
  import { configToSnapshot, withSnapshot, type UiConfig } from '../services/config.ts'
  import type { AppServices } from '../services/services.ts'
  import type { NavItem } from './nav.ts'
  import type { InspectMeta } from '../views/insight/insight-context.ts'

  let {
    services,
    badge,
    version,
    initialConfig,
    macChrome = false,
  }: {
    services: AppServices
    badge: string
    version: string
    initialConfig: UiConfig
    macChrome?: boolean
  } = $props()

  const NAV_ITEMS: NavItem[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'explorer', label: 'IR Explorer' },
  ]
  const SECTION_LABELS: Record<SettingsSection, string> = {
    general: 'General',
    appearance: 'Appearance',
    github: 'GitHub',
    about: 'About',
  }

  const shell = new ShellState()
  shell.hydrate(configToSnapshot(initialConfig))
  const workspace = new WorkspaceState(services, initialConfig.workspace.recent)
  let activeNav = $state('overview')
  let inspected = $state<InspectMeta | null>(null)

  const crumbTitle = $derived(
    shell.route.kind === 'settings'
      ? SECTION_LABELS[shell.route.section]
      : (NAV_ITEMS.find((n) => n.id === activeNav)?.label ?? ''),
  )

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

  onMount(() => {
    if (
      initialConfig.workspace.reopenOnLaunch &&
      initialConfig.workspace.active &&
      services.capabilities.reopenWorkspaces
    ) {
      void workspace.reopen(initialConfig.workspace.active)
    }
  })
</script>

<AppShell
  {shell}
  {badge}
  {version}
  {crumbTitle}
  navItems={NAV_ITEMS}
  {activeNav}
  onNavSelect={(id) => {
    activeNav = id
    shell.closeSettings()
  }}
  onOpenSettings={() => shell.openSettings()}
  {macChrome}
>
  {#snippet center()}
    {#if shell.isSettings}
      <SettingsView {services} {shell} {workspace} {version} />
    {:else if activeNav === 'overview'}
      <OverviewView
        {workspace}
        capabilities={services.capabilities}
        onOpen={() => void workspace.openPicked()}
      />
    {:else}
      <IrExplorerView {workspace} onInspect={(meta) => (inspected = meta)} />
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
  .inspector { display: flex; flex-direction: column; gap: 4px; }
  .fqn { font-family: var(--mono); font-size: 12px; color: var(--text-strong); word-break: break-word; }
  .kind { font-size: 11px; color: var(--accent2); text-transform: uppercase; letter-spacing: 0.08em; }
  .doc { font-size: 12.5px; color: var(--muted); }
  .empty { font-size: 12.5px; color: var(--muted); }
</style>
