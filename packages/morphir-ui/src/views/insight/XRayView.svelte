<script lang="ts">
  import { decodeTypeExpr, type ValueDef } from '@morphir/ir'
  import XRayNode from './XRayNode.svelte'
  import XRayToolbar from './XRayToolbar.svelte'
  import { filterXRayTree } from './xray-filter.ts'
  import { projectXRayDefinition, projectXRayValue, type XRayTreeNode } from './xray-tree.ts'
  import { XRayState } from './xray-state.svelte.ts'

  let { def = null, typeRaw = undefined }: { def?: ValueDef | null; typeRaw?: unknown } = $props()
  const xrayState = new XRayState()
  let previousSource: unknown = Symbol('initial xray source')

  const roots = $derived.by(() => {
    if (typeRaw !== undefined) return [projectXRayValue(decodeTypeExpr(typeRaw), 'type', '/type')]
    return def ? projectXRayDefinition(def) : []
  })
  const source = $derived(typeRaw !== undefined ? typeRaw : def)
  const filtered = $derived.by(() => filterXRayTree(roots, xrayState.query, xrayState.scopes))
  const expanded = $derived.by(() => xrayState.expandedWith(filtered.expandedPaths))
  const visibleBranchPaths = $derived.by(() => branchPaths(filtered.tree))
  const hasQuery = $derived(xrayState.query.trim().length > 0)

  $effect(() => {
    if (source === previousSource) return
    previousSource = source
    xrayState.clearFilters()
    xrayState.manualExpanded.clear()
    xrayState.select(null)
    xrayState.expandAll(branchPaths(roots))
  })

  const branchPaths = (nodes: readonly XRayTreeNode[]): string[] => {
    const paths: string[] = []
    const stack = [...nodes]
    while (stack.length > 0) {
      const node = stack.pop()
      if (!node) continue
      if (node.children.length > 0) {
        paths.push(node.path)
        stack.push(...node.children)
      }
    }
    return paths
  }
</script>

{#if roots.length > 0}
  <section class="xray-canvas" aria-label="XRay diagnostic tree">
    <XRayToolbar
      query={xrayState.query}
      scopes={xrayState.scopes}
      matchCount={filtered.matchCount}
      onQuery={(query) => (xrayState.query = query)}
      onScope={(scope) =>
        scope === 'all' ? xrayState.selectAllScopes() : xrayState.selectScope(scope)}
      onExpandAll={() => xrayState.expandAll(visibleBranchPaths)}
      onCollapseAll={() => xrayState.collapseAll(visibleBranchPaths)}
    />

    {#if hasQuery && filtered.tree.length === 0}
      <div class="no-matches">
        <p>No matching nodes</p>
        <button type="button" onclick={() => xrayState.clearFilters()}>Clear search</button>
      </div>
    {:else}
      <div class="xray-tree">
        {#each filtered.tree as node (node.path)}
          <XRayNode {node} {expanded} onToggle={(path) => xrayState.toggle(path)} />
        {/each}
      </div>
    {/if}
  </section>
{:else}
  <p class="empty">This definition could not be decoded.</p>
{/if}

<style>
  .xray-canvas {
    overflow: hidden;
    border: 1px solid var(--panel-edge);
    border-radius: 6px;
    background: var(--surface);
  }
  .xray-tree {
    padding: 6px;
  }
  .no-matches {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px;
    color: var(--muted);
    font-size: 13px;
  }
  .no-matches p {
    margin: 0;
  }
  .no-matches button {
    padding: 4px 7px;
    border: 1px solid var(--panel-edge);
    border-radius: 4px;
    color: var(--accent-text);
    background: var(--panel);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .no-matches button:focus-visible {
    outline: 2px solid var(--accent2);
    outline-offset: 2px;
  }
  .empty {
    color: var(--muted);
    font-size: 13px;
  }
</style>
