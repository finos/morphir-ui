<script lang="ts">
  import SettingsRow from './SettingsRow.svelte'
  import Toggle from './Toggle.svelte'
  import SchemePicker from './SchemePicker.svelte'
  import type { ShellState } from '../../state/shell-state.svelte.ts'
  let { shell }: { shell: ShellState } = $props()
</script>

<SettingsRow label="Color scheme" description="System follows your OS preference.">
  {#snippet trailing()}
    <SchemePicker value={shell.colorScheme} onSelect={(s) => shell.selectColorScheme(s)} />
  {/snippet}
</SettingsRow>
<SettingsRow label="Panel animations" description="Slide shell regions when they open and close.">
  {#snippet trailing()}
    <Toggle
      checked={shell.animations}
      onChange={() => shell.toggleAnimations()}
      label="Panel animations"
    />
  {/snippet}
</SettingsRow>
