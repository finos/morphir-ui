<script lang="ts">
  import SettingsRow from './SettingsRow.svelte'
  import Toggle from './Toggle.svelte'
  import type { AppServices } from '../../services/services.ts'
  import type { WorkspaceState } from '../../state/workspace-state.svelte.ts'
  let { services, workspace }: { services: AppServices; workspace: WorkspaceState } = $props()

  let reopenOnLaunch = $state(true)
  $effect(() => {
    void services.loadConfig().then((cfg) => (reopenOnLaunch = cfg.workspace.reopenOnLaunch))
  })
  async function setReopen(value: boolean) {
    reopenOnLaunch = value
    const cfg = await services.loadConfig()
    await services.saveConfig({ ...cfg, workspace: { ...cfg.workspace, reopenOnLaunch: value } })
  }
</script>

<SettingsRow label="Active workspace" description="The workspace currently open in the shell.">
  {#snippet trailing()}<span>{workspace.current?.ref.path ?? '—'}</span>{/snippet}
</SettingsRow>
<SettingsRow label="Reopen on launch" description="Reopen the last workspace when the app starts.">
  {#snippet trailing()}<Toggle
      checked={reopenOnLaunch}
      onChange={setReopen}
      label="Reopen on launch"
    />{/snippet}
</SettingsRow>
<SettingsRow label="Recent workspaces" description="Workspaces you opened recently.">
  {#snippet trailing()}<span
      >{workspace.recents.length === 0 ? '—' : workspace.recents.join(' · ')}</span
    >{/snippet}
</SettingsRow>
