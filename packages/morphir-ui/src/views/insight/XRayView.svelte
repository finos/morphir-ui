<script lang="ts">
  import { decodeTypeExpr, type ValueDef } from '@morphir/ir'
  import { tick } from 'svelte'
  import { SvelteMap } from 'svelte/reactivity'
  import XRayNode from './XRayNode.svelte'
  import XRayToolbar from './XRayToolbar.svelte'
  import { filterXRayTree } from './xray-filter.ts'
  import { visibleXRayRows, xrayAncestorPaths, xrayKeyAction } from './xray-navigation.ts'
  import { projectXRayDefinition, projectXRayValue, type XRayTreeNode } from './xray-tree.ts'
  import { XRayState } from './xray-state.svelte.ts'

  type Props = {
    def?: ValueDef | null
    typeRaw?: unknown
    selectedPath?: string | null
    onSelectedPath?: (path: string) => void
  }

  let {
    def = null,
    typeRaw = undefined,
    selectedPath = undefined,
    onSelectedPath,
  }: Props = $props()
  const xrayState = new XRayState()
  const rowElements = new SvelteMap<string, HTMLButtonElement>()
  let previousSource: unknown = Symbol('initial xray source')
  let previousControlledPath: unknown = Symbol('initial controlled xray path')
  let previousControlledSource: unknown = Symbol('initial controlled xray source')
  let focusedPath = $state<string | null>(null)
  let focusRequest = 0

  const roots = $derived.by(() => {
    if (typeRaw !== undefined) return [projectXRayValue(decodeTypeExpr(typeRaw), 'type', '/type')]
    return def ? projectXRayDefinition(def) : []
  })
  const source = $derived(typeRaw !== undefined ? typeRaw : def)
  const filtered = $derived.by(() => filterXRayTree(roots, xrayState.query, xrayState.scopes))
  const directMatchPaths = $derived(new Set(filtered.matchPaths))
  const expanded = $derived.by(() => xrayState.expandedWith(filtered.expandedPaths))
  const visibleBranchPaths = $derived.by(() => branchPaths(filtered.tree))
  const visibleRows = $derived.by(() => visibleXRayRows(filtered.tree, expanded))
  const effectiveSelectedPath = $derived(
    selectedPath === undefined ? xrayState.selectedPath : selectedPath,
  )
  const isUrlBackedSelection = $derived(
    selectedPath !== undefined && effectiveSelectedPath !== null && effectiveSelectedPath !== '',
  )
  const rovingPath = $derived(
    visibleRows.some((row) => row.path === focusedPath)
      ? focusedPath
      : visibleRows.some((row) => row.path === effectiveSelectedPath)
        ? effectiveSelectedPath
        : (visibleRows[0]?.path ?? null),
  )
  const hasQuery = $derived(xrayState.query.trim().length > 0)
  const resultHeading = $derived.by(() => {
    if (!hasQuery) return 'XRay structure'
    const onlyRoot = filtered.tree.length === 1 ? filtered.tree[0] : undefined
    return `${onlyRoot?.label === 'body' ? 'Body' : 'XRay'} · contextual result`
  })
  const selectionHidden = $derived.by(() => {
    if (!effectiveSelectedPath) return false
    const selectionExists = xrayAncestorPaths(roots, effectiveSelectedPath) !== undefined
    const selectionIsFilteredOut =
      xrayAncestorPaths(filtered.tree, effectiveSelectedPath) === undefined
    return selectionExists && selectionIsFilteredOut
  })

  $effect(() => {
    if (source === previousSource) return
    previousSource = source
    xrayState.clearFilters()
    xrayState.manualExpanded.clear()
    xrayState.select(null)
    xrayState.expandAll(branchPaths(roots))
    focusedPath = roots[0]?.path ?? null
  })

  $effect(() => {
    const path = selectedPath
    const selectedSource = source
    const selectedRoots = roots
    if (path === undefined) return
    if (path === previousControlledPath && selectedSource === previousControlledSource) return
    previousControlledPath = path
    previousControlledSource = selectedSource
    const request = ++focusRequest
    if (!path) return
    const ancestors = xrayAncestorPaths(selectedRoots, path)
    if (!ancestors) return
    xrayState.expandAll(ancestors)
    focusedPath = path
    void focusSelectedRow(path, request)
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

  const registerRow = (path: string, element: HTMLButtonElement | null): void => {
    if (element) rowElements.set(path, element)
    else rowElements.delete(path)
  }

  const focusRow = async (path: string): Promise<void> => {
    focusedPath = path
    await tick()
    rowElements.get(path)?.focus()
  }

  const focusSelectedRow = async (path: string, request: number): Promise<void> => {
    await tick()
    if (request !== focusRequest) return
    const row = rowElements.get(path)
    row?.scrollIntoView?.({ block: 'nearest' })
    row?.focus()
  }

  const selectRow = (path: string): void => {
    focusedPath = path
    if (selectedPath === undefined) xrayState.select(path)
    onSelectedPath?.(path)
  }

  const handleRowKey = (event: KeyboardEvent, path: string): void => {
    const action = xrayKeyAction(visibleRows, path, event.key, expanded)
    if (action.kind === 'none') return
    event.preventDefault()
    if (action.kind === 'focus') {
      void focusRow(action.path)
    } else if (action.kind === 'expand') {
      xrayState.manualExpanded.add(action.path)
    } else if (action.kind === 'collapse') {
      xrayState.manualExpanded.delete(action.path)
    } else if (action.kind === 'select') {
      selectRow(action.path)
    }
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

    {#if selectionHidden}
      <p class="selection-hidden" role="status" aria-label="Selected XRay node hidden">
        The selected node is hidden by the current filters.
        <button type="button" onclick={() => xrayState.clearFilters()}>Clear filters</button>
      </p>
    {/if}

    <section class="xray-result" aria-label="XRay result">
      <h3>{resultHeading}</h3>
      {#if hasQuery && filtered.tree.length === 0}
        <div class="no-matches">
          <p>No matching nodes</p>
          <button type="button" onclick={() => (xrayState.query = '')}>Clear search</button>
        </div>
      {:else}
        <div class="xray-tree" role="tree" aria-label="XRay structure">
          {#each filtered.tree as node (node.path)}
            <XRayNode
              {node}
              {expanded}
              {directMatchPaths}
              selectedPath={effectiveSelectedPath}
              focusedPath={rovingPath}
              level={1}
              onToggle={(path) => xrayState.toggle(path)}
              onSelect={selectRow}
              onFocus={(path) => (focusedPath = path)}
              onKeyDown={handleRowKey}
              onRow={registerRow}
            />
          {/each}
        </div>
      {/if}
    </section>

    {#if isUrlBackedSelection}
      <section class="linked-selection" aria-label="Linked XRay selection">
        <h3>Linked selection</h3>
        <div class="linked-path">
          <span aria-hidden="true">→</span>
          <code>{effectiveSelectedPath}</code>
          <span>stored in URL</span>
        </div>
      </section>
    {/if}
  </section>
{:else}
  <p class="empty">This definition could not be decoded.</p>
{/if}

<style>
  .xray-canvas {
    overflow-x: auto;
    overflow-y: hidden;
  }
  .xray-result,
  .linked-selection {
    margin: 12px;
    border: 1px solid var(--panel-edge);
    border-radius: 7px;
    background: var(--panel);
  }
  .xray-result > h3,
  .linked-selection > h3 {
    margin: 0;
    padding: 8px 11px;
    border-bottom: 1px solid var(--row-edge);
    color: var(--muted);
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  .linked-selection {
    margin-top: 0;
  }
  .xray-tree {
    min-width: max-content;
    padding: 6px;
  }
  .linked-path {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    color: var(--muted);
    font-size: 11px;
  }
  .linked-path code {
    min-width: 0;
    overflow-wrap: anywhere;
    color: var(--accent-text);
    font-family: var(--mono);
    user-select: text;
  }
  .no-matches {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px;
    color: var(--muted);
    font-size: 13px;
  }
  .selection-hidden {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    padding: 8px 12px;
    border-bottom: 1px solid var(--panel-edge);
    color: var(--muted);
    font-size: 12px;
  }
  .selection-hidden button {
    padding: 3px 6px;
    border: 1px solid var(--panel-edge);
    border-radius: 4px;
    color: var(--accent-text);
    background: var(--panel);
    font: inherit;
    cursor: pointer;
  }
  .selection-hidden button:focus-visible {
    outline: 2px solid var(--accent2);
    outline-offset: 2px;
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
