<script lang="ts">
  import type { DefinitionInfo, WorkspaceIr } from '@morphir/ir'
  import { tick, type Snippet } from 'svelte'
  import Icon from '../../icons/Icon.svelte'
  import ResizeHandle from '../../shell/ResizeHandle.svelte'
  import {
    TREE_PANE_DEFAULT_WIDTH,
    TREE_PANE_BOUNDS,
    clampTreePaneWidth,
    defaultExpandedIds,
    effectiveExpandedIds,
    filterModelTree,
    flattenVisibleTree,
    isTreeBranch,
    projectModelTree,
    type ModelTreeNode,
    type VisibleTreeRow,
  } from './model-tree.ts'

  let {
    ir,
    selectedId = null,
    onSelect,
    leading,
  }: {
    ir: WorkspaceIr
    selectedId?: string | null
    onSelect?: (definition: DefinitionInfo) => void
    leading?: Snippet
  } = $props()

  let query = $state('')
  let showTypes = $state(true)
  let showValues = $state(true)
  let expanded = $state(true)
  let paneWidth = $state(TREE_PANE_DEFAULT_WIDTH)
  let normalExpandedIds = $state(new Set<string>())
  let searchCollapsedIds = $state(new Set<string>())
  let focusedId = $state('')
  let treeRoot: HTMLElement | undefined = $state()
  let collapseButton: HTMLButtonElement | undefined = $state()
  let expandButton: HTMLButtonElement | undefined = $state()

  let roots = $derived(projectModelTree(ir))
  let activeSearch = $derived(query.trim().length > 0)
  let hasRawQuery = $derived(query.length > 0)
  let filtered = $derived(filterModelTree(roots, { query, showTypes, showValues }))
  let effectiveExpanded = $derived(
    effectiveExpandedIds(query, normalExpandedIds, searchCollapsedIds, filtered.autoExpandedIds),
  )
  let visibleRows = $derived(flattenVisibleTree(filtered.roots, effectiveExpanded))
  let rovingId = $derived(
    visibleRows.some((row) => row.node.id === focusedId)
      ? focusedId
      : (visibleRows[0]?.node.id ?? ''),
  )

  $effect(() => {
    normalExpandedIds = new Set(defaultExpandedIds(roots))
    searchCollapsedIds = new Set()
    focusedId = roots[0]?.id ?? ''
  })

  const replaceInSet = (source: ReadonlySet<string>, id: string, include: boolean): Set<string> => {
    if (include) return new Set([...source, id])
    return new Set([...source].filter((candidate) => candidate !== id))
  }

  function setQuery(value: string): void {
    if (value !== query) searchCollapsedIds = new Set()
    query = value
  }

  function clearSearch(): void {
    setQuery('')
  }

  function resetSearchAndFilters(): void {
    setQuery('')
    showTypes = true
    showValues = true
  }

  function toggleBranch(id: string): void {
    if (activeSearch) {
      searchCollapsedIds = replaceInSet(searchCollapsedIds, id, effectiveExpanded.has(id))
    } else {
      normalExpandedIds = replaceInSet(normalExpandedIds, id, !normalExpandedIds.has(id))
    }
  }

  function activate(node: ModelTreeNode): void {
    focusedId = node.id
    if (isTreeBranch(node)) toggleBranch(node.id)
    else onSelect?.(node.info)
  }

  async function focusRow(id: string): Promise<void> {
    focusedId = id
    await tick()
    treeRoot?.querySelector<HTMLElement>(`[data-tree-id="${CSS.escape(id)}"]`)?.focus()
  }

  async function clearSearchFromTree(): Promise<void> {
    clearSearch()
    await tick()
    const targetId = visibleRows.some((row) => row.node.id === focusedId)
      ? focusedId
      : visibleRows[0]?.node.id
    if (targetId) await focusRow(targetId)
  }

  async function collapsePane(): Promise<void> {
    expanded = false
    await tick()
    expandButton?.focus()
  }

  async function expandPane(): Promise<void> {
    expanded = true
    await tick()
    collapseButton?.focus()
  }

  function parentRow(row: VisibleTreeRow): VisibleTreeRow | undefined {
    return visibleRows.find((candidate) => candidate.node.id === row.node.parentId)
  }

  function firstChildRow(row: VisibleTreeRow, index: number): VisibleTreeRow | undefined {
    const candidate = visibleRows[index + 1]
    return candidate?.level === row.level + 1 ? candidate : undefined
  }

  function handleTreeKey(event: KeyboardEvent, row: VisibleTreeRow, index: number): void {
    const node = row.node
    let handled = false

    if (event.key === 'Home' && visibleRows[0]) {
      handled = true
      void focusRow(visibleRows[0].node.id)
    } else if (event.key === 'End' && visibleRows.at(-1)) {
      handled = true
      void focusRow(visibleRows.at(-1)!.node.id)
    } else if (event.key === 'ArrowUp' && visibleRows[index - 1]) {
      handled = true
      void focusRow(visibleRows[index - 1]!.node.id)
    } else if (event.key === 'ArrowDown' && visibleRows[index + 1]) {
      handled = true
      void focusRow(visibleRows[index + 1]!.node.id)
    } else if (event.key === 'ArrowRight' && isTreeBranch(node)) {
      if (!effectiveExpanded.has(node.id)) {
        handled = true
        toggleBranch(node.id)
      } else {
        const child = firstChildRow(row, index)
        if (child) {
          handled = true
          void focusRow(child.node.id)
        }
      }
    } else if (event.key === 'ArrowLeft') {
      if (isTreeBranch(node) && effectiveExpanded.has(node.id)) {
        handled = true
        toggleBranch(node.id)
      } else {
        const parent = parentRow(row)
        if (parent) {
          handled = true
          void focusRow(parent.node.id)
        }
      }
    } else if (event.key === 'Enter' || event.key === ' ') {
      handled = true
      activate(node)
    } else if (event.key === 'Escape' && hasRawQuery) {
      handled = true
      void clearSearchFromTree()
    }

    if (handled) event.preventDefault()
  }

  function highlightedLabel(
    label: string,
  ): { before: string; match: string; after: string } | null {
    const needle = query.trim()
    const start = label.toLowerCase().indexOf(needle.toLowerCase())
    if (!needle || start < 0) return null
    return {
      before: label.slice(0, start),
      match: label.slice(start, start + needle.length),
      after: label.slice(start + needle.length),
    }
  }

  function branchCount(node: ModelTreeNode): string {
    if (!isTreeBranch(node)) return node.kind
    if (activeSearch) return String(filtered.countById.get(node.id) ?? 0)
    if (node.kind === 'package') return `${node.moduleCount} modules`
    return `${node.typeCount} T / ${node.valueCount} V`
  }
</script>

{#if expanded}
  <div class="model-tree-frame">
    <aside class="model-tree-pane" style:--tree-pane-width={`${paneWidth}px`}>
      <header>
        <h2>Model hierarchy</h2>
        <button
          bind:this={collapseButton}
          class="icon-button"
          type="button"
          aria-label="Collapse model hierarchy"
          onclick={() => void collapsePane()}
        >
          <Icon name="sidebar" />
        </button>
      </header>

      {#if leading}
        {@render leading()}
      {/if}

      <div class="controls">
        <input
          type="search"
          aria-label="Search model"
          placeholder="Search model"
          value={query}
          oninput={(event) => setQuery(event.currentTarget.value)}
          onkeydown={(event) => {
            if (event.key === 'Escape' && hasRawQuery) {
              event.preventDefault()
              clearSearch()
            }
          }}
        />
        <div class="filters" aria-label="Definition filters">
          <button
            type="button"
            class:pressed={showTypes}
            aria-pressed={showTypes}
            onclick={() => (showTypes = !showTypes)}>Types</button
          >
          <button
            type="button"
            class:pressed={showValues}
            aria-pressed={showValues}
            onclick={() => (showValues = !showValues)}>Values</button
          >
        </div>
        {#if activeSearch}
          <p class="summary">
            {filtered.matchCount}
            {filtered.matchCount === 1 ? 'result' : 'results'} across
            {filtered.moduleCount}
            {filtered.moduleCount === 1 ? 'module' : 'modules'}
          </p>
        {/if}
      </div>

      {#if activeSearch && filtered.roots.length === 0}
        <div class="no-matches">
          <strong>No matches</strong>
          <button type="button" onclick={resetSearchAndFilters}>Reset search and filters</button>
        </div>
      {:else}
        <div bind:this={treeRoot} class="tree" role="tree" aria-label="Model hierarchy">
          {#each visibleRows as row, index (row.node.id)}
            {@const node = row.node}
            {@const highlight = highlightedLabel(node.label)}
            <button
              type="button"
              class="tree-row"
              class:selected={!isTreeBranch(node) && node.id === selectedId}
              role="treeitem"
              aria-label={node.label}
              aria-level={row.level}
              aria-expanded={isTreeBranch(node) ? effectiveExpanded.has(node.id) : undefined}
              aria-selected={!isTreeBranch(node) ? node.id === selectedId : undefined}
              tabindex={node.id === rovingId ? 0 : -1}
              data-tree-id={node.id}
              style:--tree-level={row.level}
              onclick={() => activate(node)}
              onfocus={() => (focusedId = node.id)}
              onkeydown={(event) => handleTreeKey(event, row, index)}
            >
              <span class="disclosure" aria-hidden="true">
                {isTreeBranch(node) ? (effectiveExpanded.has(node.id) ? '⌄' : '›') : '·'}
              </span>
              <span class="label">
                {#if highlight}
                  {highlight.before}<mark>{highlight.match}</mark>{highlight.after}
                {:else}
                  {node.label}
                {/if}
              </span>
              <span class="count">{branchCount(node)}</span>
            </button>
          {/each}
          {#if roots.some((root) => root.children.length === 0)}
            <p class="empty-package">This package has no modules.</p>
          {/if}
        </div>
      {/if}
    </aside>
    <ResizeHandle
      edge="left"
      label="Resize model hierarchy"
      min={TREE_PANE_BOUNDS.min}
      max={TREE_PANE_BOUNDS.max}
      currentSize={paneWidth}
      onResize={(width) => (paneWidth = clampTreePaneWidth(width))}
    />
  </div>
{:else}
  <aside class="collapsed-rail">
    <button
      bind:this={expandButton}
      type="button"
      aria-label="Expand model hierarchy"
      onclick={() => void expandPane()}
    >
      <Icon name="sidebar" />
      <span class="vertical-label" aria-hidden="true">Model</span>
    </button>
  </aside>
{/if}

<style>
  .model-tree-frame {
    display: flex;
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }
  .model-tree-pane {
    flex: 0 0 auto;
    width: var(--tree-pane-width);
    min-width: 0;
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    color: var(--text);
    background: var(--panel);
    border-right: 1px solid var(--panel-edge);
  }
  header {
    min-height: 42px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 0 10px 0 14px;
    border-bottom: 1px solid var(--head-edge);
  }
  h2 {
    margin: 0;
    font-family: var(--mono);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  button,
  input {
    font: inherit;
  }
  button {
    color: inherit;
  }
  .icon-button {
    width: 30px;
    height: 30px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 6px;
    background: transparent;
  }
  .icon-button:hover,
  .icon-button:focus-visible {
    background: var(--hover);
  }
  .controls {
    display: grid;
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--edge);
  }
  input[type='search'] {
    width: 100%;
    min-width: 0;
    height: 32px;
    padding: 0 9px;
    border: 1px solid var(--panel-edge);
    border-radius: 7px;
    outline: 0;
    color: var(--text);
    background: var(--code-bg);
  }
  input[type='search']:focus {
    border-color: var(--accent2);
  }
  .filters {
    display: flex;
    gap: 6px;
  }
  .filters button,
  .no-matches button {
    padding: 4px 9px;
    border: 1px solid var(--panel-edge);
    border-radius: 999px;
    color: var(--muted);
    background: var(--surface);
  }
  .filters button.pressed {
    border-color: var(--accent2);
    color: var(--accent-text);
    background: var(--hover);
  }
  .filters button:focus-visible,
  .no-matches button:focus-visible {
    outline: 2px solid var(--accent2);
    outline-offset: 1px;
  }
  .summary {
    margin: 0;
    color: var(--muted);
    font-size: 11px;
  }
  .tree {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 6px 0;
  }
  .tree-row {
    width: 100%;
    min-width: 0;
    height: 30px;
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 0 10px 0 calc(7px + (var(--tree-level) - 1) * 16px);
    border: 0;
    border-radius: 0;
    text-align: left;
    background: transparent;
  }
  .tree-row:hover {
    background: var(--hover-soft);
  }
  .tree-row:focus-visible {
    outline: 2px solid var(--accent2);
    outline-offset: -2px;
    background: var(--hover);
  }
  .tree-row.selected {
    color: var(--text-strong);
    background: var(--hover);
    box-shadow: inset 2px 0 var(--accent);
  }
  .disclosure {
    flex: 0 0 12px;
    color: var(--muted2);
    text-align: center;
  }
  .label {
    min-width: 0;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  mark {
    color: var(--text-strong);
    background: color-mix(in srgb, var(--accent) 30%, transparent);
  }
  .count {
    flex: 0 0 auto;
    color: var(--muted2);
    font-family: var(--mono);
    font-size: 9px;
  }
  .no-matches {
    flex: 1;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 10px;
    padding: 20px;
    color: var(--muted);
    text-align: center;
  }
  .empty-package {
    margin: 8px 12px 8px 35px;
    color: var(--muted);
    font-size: 11px;
  }
  .collapsed-rail {
    flex: 0 0 32px;
    width: 32px;
    height: 100%;
    overflow: hidden;
    background: var(--panel);
    border-right: 1px solid var(--panel-edge);
  }
  .collapsed-rail button {
    width: 32px;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 9px 7px;
    border: 0;
    background: transparent;
  }
  .collapsed-rail button:hover,
  .collapsed-rail button:focus-visible {
    background: var(--hover);
  }
  .vertical-label {
    font-family: var(--mono);
    font-size: 9px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    writing-mode: vertical-rl;
  }
</style>
