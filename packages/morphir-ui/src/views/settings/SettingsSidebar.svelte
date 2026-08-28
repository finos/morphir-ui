<script lang="ts">
  import Icon from '../../icons/Icon.svelte'
  import type { SettingsSection } from '../../state/shell-state.svelte.ts'
  let {
    sections,
    active,
    onSelect,
    onBack,
  }: {
    sections: ReadonlyArray<{ key: SettingsSection; label: string }>
    active: SettingsSection
    onSelect: (key: SettingsSection) => void
    onBack: () => void
  } = $props()
</script>

<div class="settings-side">
  <button class="back" onclick={onBack}><Icon name="back" /> Back</button>
  {#each sections as section (section.key)}
    <button
      class="section"
      class:active={section.key === active}
      onclick={() => onSelect(section.key)}
    >
      {section.label}
    </button>
  {/each}
</div>

<style>
  .settings-side {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 180px;
    flex-shrink: 0;
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
  .section {
    padding: 8px 10px;
    border-radius: 8px;
    background: none;
    border: none;
    text-align: left;
    color: var(--nav);
    font-weight: 500;
    cursor: pointer;
  }
  .section:hover {
    background: var(--hover-soft);
    color: var(--text);
  }
  .section.active {
    background: linear-gradient(
      to right,
      rgba(214, 64, 159, 0.16) 0%,
      rgba(139, 92, 246, 0.1) 100%
    );
    color: var(--text-strong);
  }
</style>
