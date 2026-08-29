<script lang="ts">
  import SettingsRow from './SettingsRow.svelte'
  import Toggle from './Toggle.svelte'
  import type { AppServices } from '../../services/services.ts'
  import type { WorkbenchStore } from '../../workbench/workbench-store.svelte.ts'
  let { services, store }: { services: AppServices; store: WorkbenchStore } = $props()

  let reopenOnLaunch = $state(true)
  // Guards against the mount-load effect below resolving *after* a user toggle and
  // clobbering the just-set value with the (now stale) config-file snapshot.
  let touched = $state(false)
  $effect(() => {
    void services.loadConfig().then((cfg) => {
      if (!touched) reopenOnLaunch = cfg.workbenches.reopenOnLaunch
    })
  })
  async function setReopen(value: boolean) {
    touched = true
    reopenOnLaunch = value
    await services.updateConfig((cfg) => ({
      ...cfg,
      workbenches: { ...cfg.workbenches, reopenOnLaunch: value },
    }))
  }
</script>

<SettingsRow label="Active Workbench" description="The Workbench currently active in the shell.">
  {#snippet trailing()}<span>{store.active?.descriptor.source ?? '—'}</span>{/snippet}
</SettingsRow>
<SettingsRow
  label="Reopen Workbenches on launch"
  description="Restore open Workbenches when the app starts."
>
  {#snippet trailing()}<Toggle
      checked={reopenOnLaunch}
      onChange={setReopen}
      label="Reopen Workbenches on launch"
    />{/snippet}
</SettingsRow>
<SettingsRow label="Recent Workbenches" description="Workbenches you opened recently.">
  {#snippet trailing()}<span
      >{store.recent.length === 0 ? '—' : store.recent.map((item) => item.source).join(' · ')}</span
    >{/snippet}
</SettingsRow>
