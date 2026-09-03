<script lang="ts">
  import type { XRayTreeNode } from './xray-tree.ts'
  import XRayKindBadge from './XRayKindBadge.svelte'
  import XRayNode from './XRayNode.svelte'

  type Props = {
    node: XRayTreeNode
    expanded: ReadonlySet<string>
    level: number
    selectedPath: string | null
    focusedPath: string | null
    onToggle: (path: string) => void
    onSelect: (path: string) => void
    onFocus: (path: string) => void
    onKeyDown: (event: KeyboardEvent, path: string) => void
    onRow: (path: string, element: HTMLButtonElement | null) => void
  }

  let {
    node,
    expanded,
    level,
    selectedPath,
    focusedPath,
    onToggle,
    onSelect,
    onFocus,
    onKeyDown,
    onRow,
  }: Props = $props()
  let rowElement: HTMLButtonElement | undefined = $state()
  const branch = () => node.children.length > 0
  const open = () => expanded.has(node.path)

  $effect(() => {
    if (!rowElement) return
    onRow(node.path, rowElement)
    return () => onRow(node.path, null)
  })

  const activate = () => {
    onFocus(node.path)
    onSelect(node.path)
    if (branch()) onToggle(node.path)
  }
</script>

<div class="xray-node" class:branch={branch()}>
  <button
    bind:this={rowElement}
    type="button"
    class="xray-row"
    class:leaf={!branch()}
    class:selected={selectedPath === node.path}
    role="treeitem"
    aria-level={level}
    aria-expanded={branch() ? open() : undefined}
    aria-selected={selectedPath === node.path}
    tabindex={focusedPath === node.path ? 0 : -1}
    data-path={node.path}
    data-xray-path={node.path}
    onclick={activate}
    onfocus={() => onFocus(node.path)}
    onkeydown={(event) => onKeyDown(event, node.path)}
  >
    <span class:leaf-gutter={!branch()} class:disclosure={branch()} aria-hidden="true"
      >{branch() ? (open() ? '⌄' : '›') : '·'}</span
    >
    <span class="label">{node.label}</span>
    {#if node.kind}<XRayKindBadge kind={node.kind} />{/if}
    {#if node.typeText}<span class="xray-type type-badge">{node.typeText}</span>{/if}
    {#if node.scalar}<span class="value">{node.scalar}</span>{/if}
    {#if node.warning}<span class="warning">{node.warning}</span>{/if}
  </button>
  {#if branch() && open()}
    <div class="children" role="group">
      {#each node.children as child (child.path)}
        <XRayNode
          {expanded}
          {selectedPath}
          {focusedPath}
          {onToggle}
          {onSelect}
          {onFocus}
          {onKeyDown}
          {onRow}
          node={child}
          level={level + 1}
        />
      {/each}
    </div>
  {/if}
</div>

<style>
  .xray-node {
    font-family: var(--mono);
    font-size: 12.5px;
  }
  .xray-row {
    display: flex;
    align-items: baseline;
    width: 100%;
    gap: 6px;
    padding: 3px 5px;
    color: var(--text);
    text-align: left;
  }
  .xray-row {
    border: 0;
    background: transparent;
    font: inherit;
    cursor: pointer;
  }
  .xray-row:hover {
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }
  .xray-row.selected {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
  }
  .xray-row:focus-visible {
    outline: 2px solid var(--accent2);
    outline-offset: -2px;
  }
  .disclosure,
  .leaf-gutter {
    flex: 0 0 10px;
    color: var(--muted);
  }
  .label {
    color: var(--muted2);
  }
  .type-badge {
    display: inline-flex;
    align-items: center;
    padding: 1px 6px;
    border: 1px solid color-mix(in srgb, var(--status-stale) 55%, var(--panel-edge));
    border-radius: 999px;
    color: var(--text);
    background: color-mix(in srgb, var(--status-stale) 12%, var(--surface));
    font-size: 10px;
    font-weight: 650;
    line-height: 1.4;
    white-space: nowrap;
  }
  .warning {
    color: var(--accent);
  }
  .value {
    color: var(--text);
  }
  .warning {
    font-style: italic;
  }
  .children {
    margin-left: 9px;
    padding-left: 9px;
    border-left: 1px solid var(--row-edge);
  }
</style>
