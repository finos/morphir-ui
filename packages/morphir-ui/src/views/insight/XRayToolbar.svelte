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

  <div class="tree-actions">
    <button type="button" onclick={onExpandAll}>Expand all</button>
    <button type="button" onclick={onCollapseAll}>Collapse all</button>
  </div>

  <span class="match-count" role="status" aria-live="polite"
    >{matchCount} {matchCount === 1 ? 'match' : 'matches'}</span
  >
</div>

<style>
  .xray-toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 8px 12px;
    padding: 10px;
    border-bottom: 1px solid var(--row-edge);
    background: var(--panel);
  }
  .search {
    display: grid;
    gap: 3px;
    color: var(--muted2);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.04em;
  }
  input {
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
  button {
    padding: 4px 7px;
    border: 1px solid var(--panel-edge);
    border-radius: 4px;
    color: var(--muted2);
    background: var(--surface);
    font: inherit;
    font-size: 11px;
    cursor: pointer;
  }
  button[aria-pressed='true'] {
    border-color: var(--accent2);
    color: var(--accent-text);
    background: color-mix(in srgb, var(--accent) 20%, var(--surface));
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
