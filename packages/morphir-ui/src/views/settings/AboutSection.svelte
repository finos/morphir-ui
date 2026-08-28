<script lang="ts">
  import SettingsRow from './SettingsRow.svelte'
  let { version }: { version: string } = $props()
</script>

<SettingsRow label="App version">
  {#snippet trailing()}<span>v{version}</span>{/snippet}
</SettingsRow>
<SettingsRow label="Foundation">
  {#snippet trailing()}<span>Svelte · Effect · @morphir/ui</span>{/snippet}
</SettingsRow>
