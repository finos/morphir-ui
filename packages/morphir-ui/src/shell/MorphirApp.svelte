<script lang="ts">
  import { onMount } from 'svelte'
  import AppShell from './AppShell.svelte'
  import OverviewView from '../views/OverviewView.svelte'
  import IrExplorerView from '../views/IrExplorerView.svelte'
  import { ShellState, type SettingsSection } from '../state/shell-state.svelte.ts'
  import { WorkspaceState } from '../state/workspace-state.svelte.ts'
  import { configToSnapshot, withSnapshot, type UiConfig } from '../services/config.ts'
  import type { AppServices } from '../services/services.ts'
  import type { NavItem } from './nav.ts'

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
      void services.loadConfig().then((cfg) => services.saveConfig(withSnapshot(cfg, snap)))
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
      <!-- Replaced by SettingsView in Task 14 -->
      <div class="settings-stub">Settings</div>
    {:else if activeNav === 'overview'}
      <OverviewView
        {workspace}
        capabilities={services.capabilities}
        onOpen={() => void workspace.openPicked()}
      />
    {:else}
      <IrExplorerView {workspace} />
    {/if}
  {/snippet}
</AppShell>
