<script lang="ts">
  import type { Snippet } from 'svelte'
  import Titlebar from './Titlebar.svelte'
  import Sidebar from './Sidebar.svelte'
  import RegionPanel from './RegionPanel.svelte'
  import ResizeHandle from './ResizeHandle.svelte'
  import type { NavItem } from './nav.ts'
  import type { ShellState } from '../state/shell-state.svelte.ts'

  let {
    shell,
    badge,
    version,
    crumbTitle,
    navItems,
    activeNav,
    onNavSelect,
    onOpenSettings,
    macChrome = false,
    center,
    inspector,
    log,
  }: {
    shell: ShellState
    badge: string
    version: string
    crumbTitle: string
    navItems: NavItem[]
    activeNav: string
    onNavSelect: (id: string) => void
    onOpenSettings: () => void
    macChrome?: boolean
    center?: Snippet
    inspector?: Snippet
    log?: Snippet
  } = $props()
</script>

<div class="shell {shell.schemeClass}" class:no-motion={!shell.animations}>
  <Titlebar {shell} {badge} {version} {crumbTitle} {macChrome} />
  <div class="shell-body">
    <RegionPanel region="left" extent={shell.leftExtent}>
      <Sidebar {navItems} {activeNav} {onNavSelect} {onOpenSettings} />
    </RegionPanel>
    {#if shell.leftVisible}
      <ResizeHandle
        edge="left"
        currentSize={shell.leftWidth}
        onResize={(px) => shell.resizeLeft(px)}
      />
    {/if}
    <div class="shell-center">
      <div class="shell-main">
        <main class="content" class:content-settings={shell.isSettings}>
          {#if center}{@render center()}{/if}
        </main>
        {#if shell.rightVisible}
          <ResizeHandle
            edge="right"
            currentSize={shell.rightWidth}
            onResize={(px) => shell.resizeRight(px)}
          />
        {/if}
        <RegionPanel region="right" extent={shell.rightExtent}>
          <div class="panel-body">
            {#if inspector}{@render inspector()}{:else}<span class="panel-title">Inspector</span
              >{/if}
          </div>
        </RegionPanel>
      </div>
      {#if shell.bottomVisible}
        <ResizeHandle
          edge="bottom"
          currentSize={shell.bottomHeight}
          onResize={(px) => shell.resizeBottom(px)}
        />
      {/if}
      <RegionPanel region="bottom" extent={shell.bottomExtent}>
        <div class="panel-body">
          {#if log}{@render log()}{:else}<span class="panel-title">Log</span>{/if}
        </div>
      </RegionPanel>
    </div>
  </div>
</div>

<style>
  .shell {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg);
    color: var(--text);
  }
  .shell-body {
    flex: 1;
    display: flex;
    min-height: 0;
  }
  .shell-center {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .shell-main {
    flex: 1;
    display: flex;
    min-height: 0;
  }
  .content {
    flex: 1;
    overflow: auto;
    padding: 22px;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(380px, 1fr));
    gap: 16px;
    align-content: start;
  }
  .content.content-settings {
    grid-template-columns: minmax(0, 1fr);
    gap: 0;
  }
  .panel-body {
    padding: 14px;
    flex: 1;
    overflow: auto;
  }
  .panel-title {
    font-family: var(--mono);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--muted2);
  }
</style>
