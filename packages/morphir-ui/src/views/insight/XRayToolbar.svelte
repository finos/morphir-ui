<script lang="ts">
  import type { XRaySearchScope } from './xray-tree.ts'

  type Props = {
    query: string
    scopes: ReadonlySet<XRaySearchScope>
    matchCount: number
    onQuery: (query: string) => void
    onScope: (scope: XRaySearchScope | 'all') => void
    onExpandAll: () => void
    onCollapseAll: () => void
  }

  let { query, scopes, matchCount, onQuery, onScope, onExpandAll, onCollapseAll }: Props = $props()

  const allScopes = () => scopes.size === 0
  const selected = (scope: XRaySearchScope) => scopes.has(scope)
</script>

<div class="xray-toolbar">
  <div class="xray-toolbar-primary">
    <label class="search">
      <span>Search XRay</span>
      <input
        type="search"
        aria-label="Search XRay"
        placeholder="Search fields, values, and types"
        value={query}
        oninput={(event) => onQuery(event.currentTarget.value)}
      />
    </label>

    <div class="tree-actions">
      <button type="button" onclick={onExpandAll}>Expand all</button>
      <button type="button" onclick={onCollapseAll}>Collapse all</button>
    </div>

    <span class="match-count" role="status" aria-live="polite"
      >{matchCount} {matchCount === 1 ? 'match' : 'matches'}</span
    >
  </div>

  <div class="xray-toolbar-filters">
    <span class="filter-label">Filter</span>
    <div class="scopes" role="group" aria-label="XRay search scopes">
      <button type="button" aria-pressed={allScopes()} onclick={() => onScope('all')}>All</button>
      <button type="button" aria-pressed={selected('kinds')} onclick={() => onScope('kinds')}
        >Kinds</button
      >
      <button type="button" aria-pressed={selected('fields')} onclick={() => onScope('fields')}
        >Fields</button
      >
      <button type="button" aria-pressed={selected('values')} onclick={() => onScope('values')}
        >Values</button
      >
      <button type="button" aria-pressed={selected('types')} onclick={() => onScope('types')}
        >Types</button
      >
    </div>
    {#if query.trim().length > 0}
      <span class="filter-hint">matching paths auto-expanded</span>
    {/if}
  </div>
</div>

<style>
  .xray-toolbar {
    display: grid;
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--row-edge);
    background: var(--panel);
  }
  .xray-toolbar-primary,
  .xray-toolbar-filters {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .xray-toolbar-primary {
    align-items: end;
  }
  .xray-toolbar-filters {
    align-items: center;
    padding-top: 8px;
    border-top: 1px solid var(--panel-edge);
  }
  .search {
    display: grid;
    flex: 1 1 280px;
    gap: 3px;
    color: var(--muted);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
  }
  input {
    width: 100%;
    min-width: 210px;
    padding: 5px 7px;
    border: 1px solid var(--panel-edge);
    border-radius: 4px;
    color: var(--text);
    background: var(--surface);
    font: inherit;
  }
  .scopes,
  .tree-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .filter-label {
    color: var(--muted);
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  .filter-hint {
    color: var(--muted);
    font-size: 11px;
  }
  button {
    padding: 4px 7px;
    border: 1px solid var(--panel-edge);
    border-radius: 999px;
    color: var(--muted);
    background: var(--surface);
    font: inherit;
    font-size: 11px;
    cursor: pointer;
  }
  button[aria-pressed='true'] {
    border-color: var(--accent2);
    color: var(--accent-text);
    background: color-mix(in srgb, var(--accent2) 20%, var(--surface));
  }
  button:focus-visible,
  input:focus-visible {
    outline: 2px solid var(--accent2);
    outline-offset: 2px;
  }
  .match-count {
    margin-left: auto;
    color: var(--muted);
    font-family: var(--mono);
    font-size: 11px;
  }
</style>
