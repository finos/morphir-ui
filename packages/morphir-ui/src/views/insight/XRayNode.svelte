<script lang="ts">
  import type { XRayTreeNode } from './xray-tree.ts'
  import XRayNode from './XRayNode.svelte'

  type Props = {
    node: XRayTreeNode
    expanded: ReadonlySet<string>
    onToggle: (path: string) => void
  }

  let { node, expanded, onToggle }: Props = $props()
  const branch = () => node.children.length > 0
  const open = () => expanded.has(node.path)
</script>

<div class="xray-node" class:branch={branch()}>
  {#if branch()}
    <button
      type="button"
      class="xray-row"
      data-xray-path={node.path}
      aria-expanded={open()}
      onclick={() => onToggle(node.path)}
    >
      <span class="disclosure" aria-hidden="true">{open() ? '⌄' : '›'}</span>
      <span class="label">{node.label}</span>
      {#if node.kind}<span class:unknown={node.kind === 'unknown'} class="kind">{node.kind}</span
        >{/if}
      {#if node.typeText}<span class="xray-type">{node.typeText}</span>{/if}
      {#if node.scalar}<span class="value">{node.scalar}</span>{/if}
      {#if node.warning}<span class="warning">{node.warning}</span>{/if}
    </button>
    {#if open()}
      <div class="children">
        {#each node.children as child (child.path)}
          <XRayNode {expanded} {onToggle} node={child} />
        {/each}
      </div>
    {/if}
  {:else}
    <div class="xray-row leaf">
      <span class="leaf-gutter" aria-hidden="true">·</span>
      <span class="label">{node.label}</span>
      {#if node.kind}<span class:unknown={node.kind === 'unknown'} class="kind">{node.kind}</span
        >{/if}
      {#if node.typeText}<span class="xray-type">{node.typeText}</span>{/if}
      {#if node.scalar}<span class="value">{node.scalar}</span>{/if}
      {#if node.warning}<span class="warning">{node.warning}</span>{/if}
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
  button.xray-row {
    border: 0;
    background: transparent;
    font: inherit;
    cursor: pointer;
  }
  button.xray-row:hover {
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }
  button.xray-row:focus-visible {
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
  .kind {
    color: var(--accent2);
    font-weight: 600;
  }
  .kind.unknown,
  .warning {
    color: var(--accent);
  }
  .xray-type {
    padding: 1px 4px;
    border: 1px solid var(--panel-edge);
    border-radius: 3px;
    color: var(--muted);
    background: var(--panel);
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
