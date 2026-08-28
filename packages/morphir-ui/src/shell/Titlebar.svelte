<script lang="ts">
  import Icon from '../icons/Icon.svelte'
  import type { ShellState } from '../state/shell-state.svelte.ts'
  let {
    shell,
    badge,
    version,
    crumbTitle,
    macChrome = false,
  }: {
    shell: ShellState
    badge: string
    version: string
    crumbTitle: string
    macChrome?: boolean
  } = $props()
  const crumbPrefix = $derived(shell.isSettings ? 'Settings' : 'morphir')
</script>

<header class="titlebar" id="titlebar">
  {#if shell.leftVisible}
    <div class="brand-zone" class:lights-inset={macChrome}>
      <button
        class="icon-btn"
        id="sidebar-toggle"
        onclick={() => shell.toggleLeft()}
        title="Toggle sidebar"
      >
        <Icon name="sidebar" />
      </button>
      <div class="brand">
        <span class="brand-mark">morphir</span><span class="brand-sub">{badge}</span>
      </div>
    </div>
    <div class="titlebar-rest">
      <div class="topbar-title"><span class="crumb">{crumbPrefix} / </span>{crumbTitle}</div>
      {@render rightCluster()}
    </div>
  {:else}
    <div class="titlebar-left" class:lights-inset={macChrome}>
      <button
        class="icon-btn"
        id="sidebar-toggle"
        onclick={() => shell.toggleLeft()}
        title="Toggle sidebar"
      >
        <Icon name="sidebar" />
      </button>
      <div class="topbar-title"><span class="crumb">{crumbPrefix} / </span>{crumbTitle}</div>
    </div>
    {@render rightCluster()}
  {/if}
</header>

{#snippet rightCluster()}
  <div class="titlebar-right">
    {#if shell.isSettings}
      <button class="titlebar-action" id="restore-defaults" onclick={() => shell.restoreDefaults()}>
        <Icon name="restore" /><span class="titlebar-action-label">Restore defaults</span>
      </button>
    {:else}
      <span class="chip" id="app-version">v{version}</span>
      <button
        class="icon-btn"
        id="right-toggle"
        onclick={() => shell.toggleRight()}
        title="Toggle inspector"
      >
        <Icon name="panelRight" />
      </button>
      <button
        class="icon-btn"
        id="bottom-toggle"
        onclick={() => shell.toggleBottom()}
        title="Toggle log"
      >
        <Icon name="panelBottom" />
      </button>
    {/if}
  </div>
{/snippet}

<style>
  .titlebar {
    display: flex;
    align-items: stretch;
    height: 52px;
    background: var(--surface);
    border-bottom: 1px solid var(--edge);
    flex-shrink: 0;
    -webkit-app-region: drag; /* frameless-window drag region — owned here, not in global CSS */
  }
  .icon-btn,
  .chip,
  .titlebar-action {
    -webkit-app-region: no-drag;
  }
  .brand-zone {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 224px;
    padding: 0 12px;
    background: var(--rail);
    border-right: 1px solid var(--edge);
    flex-shrink: 0;
  }
  .brand-zone.lights-inset {
    padding: 0 12px 0 var(--traffic-light-inset);
  }
  .brand-zone.lights-inset .brand-sub {
    display: none;
  }
  .titlebar-rest {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 22px;
  }
  .titlebar-left {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 0 0 22px;
  }
  .titlebar-left.lights-inset {
    padding: 0 0 0 var(--traffic-light-inset);
  }
  .titlebar-right {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 22px 0 0;
  }
  .brand {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 0 10px;
    font-weight: 700;
    font-size: 17px;
    letter-spacing: -0.01em;
  }
  .brand-mark {
    background: linear-gradient(120deg, var(--accent), var(--accent2));
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
  .brand-sub {
    font-family: var(--mono);
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.22em;
    color: var(--muted2);
  }
  .topbar-title {
    display: flex;
    gap: 4px;
    font-weight: 600;
    font-size: 14px;
    color: var(--text);
  }
  .topbar-title .crumb {
    color: var(--muted2);
    font-weight: 400;
  }
  .chip {
    font-family: var(--mono);
    font-size: 11px;
    font-weight: 600;
    padding: 3px 10px;
    border-radius: 999px;
    color: var(--accent-text);
    background: rgba(214, 64, 159, 0.14);
    border: 1px solid rgba(214, 64, 159, 0.35);
  }
  .titlebar-action {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 5px 10px;
    border-radius: 8px;
    color: var(--muted);
    font-size: 12.5px;
    cursor: pointer;
    background: none;
    border: none;
  }
  .titlebar-action:hover {
    background: var(--hover);
    color: var(--text);
  }
  .titlebar-action-label {
    font-weight: 500;
  }
  .icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 8px;
    color: var(--muted);
    background: none;
    border: none;
    cursor: pointer;
  }
  .icon-btn:hover {
    background: var(--hover);
    color: var(--text);
  }
</style>
