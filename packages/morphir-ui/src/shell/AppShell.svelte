<script lang="ts">
  import type { Snippet } from 'svelte'
  import Titlebar from './Titlebar.svelte'
  import WorkbenchRail from './WorkbenchRail.svelte'
  import RegionPanel from './RegionPanel.svelte'
  import ResizeHandle from './ResizeHandle.svelte'
  import type { ShellState } from '../state/shell-state.svelte.ts'
  import type { WorkbenchStore } from '../workbench/workbench-store.svelte.ts'
  import { PANEL_BOUNDS } from '../state/shell-constants.ts'

  let {
    shell,
    badge,
    version,
    crumbTitle,
    store,
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
    store: WorkbenchStore
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
      <WorkbenchRail {store} {onOpenSettings} />
    </RegionPanel>
    {#if shell.leftVisible}
      <ResizeHandle
        edge="left"
        label="Resize Workbench rail"
        min={PANEL_BOUNDS.left.min}
        max={PANEL_BOUNDS.left.max}
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
            label="Resize Inspector"
            min={PANEL_BOUNDS.right.min}
            max={PANEL_BOUNDS.right.max}
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
          label="Resize Log"
          min={PANEL_BOUNDS.bottom.min}
          max={PANEL_BOUNDS.bottom.max}
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
