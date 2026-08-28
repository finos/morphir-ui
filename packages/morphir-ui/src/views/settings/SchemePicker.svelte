<script lang="ts">
  import {
    SCHEME_CLASSES,
    SCHEME_LABELS,
    type ColorScheme,
  } from '../../state/shell-state.svelte.ts'
  let { value, onSelect }: { value: ColorScheme; onSelect: (scheme: ColorScheme) => void } =
    $props()
  const SCHEMES: ColorScheme[] = ['system', 'light', 'dark']
</script>

<div class="schemes">
  {#each SCHEMES as scheme (scheme)}
    <button class="scheme-card" class:active={scheme === value} onclick={() => onSelect(scheme)}>
      <span class="preview {SCHEME_CLASSES[scheme]}">
        <span class="mini-top"></span>
        <span class="mini-body"
          ><span class="mini-rail"></span><span class="mini-accent"></span></span
        >
      </span>
      {SCHEME_LABELS[scheme]}
    </button>
  {/each}
</div>

<style>
  .schemes {
    display: flex;
    gap: 12px;
  }
  .scheme-card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: center;
    padding: 8px;
    border-radius: 10px;
    border: 1px solid var(--panel-edge);
    background: none;
    color: var(--muted);
    font-size: 12.5px;
    cursor: pointer;
  }
  .scheme-card.active {
    border-color: var(--accent);
    color: var(--text);
  }
  .preview {
    display: flex;
    flex-direction: column;
    width: 108px;
    height: 64px;
    border-radius: 8px;
    overflow: hidden;
    background: var(--bg);
    border: 1px solid var(--edge);
  }
  .mini-top {
    height: 12px;
    background: var(--surface);
    border-bottom: 1px solid var(--edge);
  }
  .mini-body {
    flex: 1;
    display: flex;
  }
  .mini-rail {
    width: 24px;
    background: var(--rail);
    border-right: 1px solid var(--edge);
  }
  .mini-accent {
    align-self: flex-end;
    margin: 6px;
    width: 28px;
    height: 6px;
    border-radius: 3px;
    background: linear-gradient(90deg, var(--accent), var(--accent2));
  }
</style>
