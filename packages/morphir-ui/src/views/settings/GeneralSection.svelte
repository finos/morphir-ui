<script lang="ts">
  import SettingsRow from './SettingsRow.svelte'
  import Toggle from './Toggle.svelte'
  import type { AppServices } from '../../services/services.ts'
  import type { WorkspaceState } from '../../state/workspace-state.svelte.ts'
  let { services, workspace }: { services: AppServices; workspace: WorkspaceState } = $props()

  let reopenOnLaunch = $state(true)
  // Guards against the mount-load effect below resolving *after* a user toggle and
  // clobbering the just-set value with the (now stale) config-file snapshot.
  let touched = $state(false)
  $effect(() => {
    void services.loadConfig().then((cfg) => {
      if (!touched) reopenOnLaunch = cfg.workspace.reopenOnLaunch
    })
  })
  async function setReopen(value: boolean) {
    touched = true
    reopenOnLaunch = value
    await services.updateConfig((cfg) => ({
      ...cfg,
      workspace: { ...cfg.workspace, reopenOnLaunch: value },
    }))
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
