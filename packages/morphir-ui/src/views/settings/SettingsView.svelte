<script lang="ts">
  import SettingsSidebar from './SettingsSidebar.svelte'
  import GeneralSection from './GeneralSection.svelte'
  import AppearanceSection from './AppearanceSection.svelte'
  import GitHubSection from './GitHubSection.svelte'
  import AboutSection from './AboutSection.svelte'
  import type { AppServices } from '../../services/services.ts'
  import type { ShellState, SettingsSection } from '../../state/shell-state.svelte.ts'
  import type { WorkspaceState } from '../../state/workspace-state.svelte.ts'

  let {
    services,
    shell,
    workspace,
    version,
  }: { services: AppServices; shell: ShellState; workspace: WorkspaceState; version: string } =
    $props()

  const sections = $derived([
    { key: 'general', label: 'General' },
    { key: 'appearance', label: 'Appearance' },
    ...(services.capabilities.github ? [{ key: 'github', label: 'GitHub' }] : []),
    { key: 'about', label: 'About' },
  ] as ReadonlyArray<{ key: SettingsSection; label: string }>)
  const active = $derived(shell.route.kind === 'settings' ? shell.route.section : 'general')
</script>

<div class="settings">
  <SettingsSidebar
    {sections}
    {active}
    onSelect={(key) => shell.selectSettingsSection(key)}
    onBack={() => shell.closeSettings()}
  />
  <div class="settings-body">
    {#if active === 'general'}<GeneralSection {services} {workspace} />
    {:else if active === 'appearance'}<AppearanceSection {shell} />
    {:else if active === 'github' && services.capabilities.github}<GitHubSection {services} />
    {:else}<AboutSection {version} />{/if}
  </div>
</div>

<style>
  .settings {
    display: flex;
    gap: 22px;
  }
  .settings-body {
    flex: 1;
    min-width: 0;
  }
</style>
