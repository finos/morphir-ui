<script lang="ts">
  import type { WorkbenchStore } from '../workbench/workbench-store.svelte.ts'
  import { recoveryActionLabel } from '../workbench/project-model-state.ts'

  let {
    store,
    onOpenSettings,
    onOpenPlayground,
  }: {
    store: WorkbenchStore
    onOpenSettings: () => void
    onOpenPlayground: () => void
  } = $props()
</script>

<nav class="workbench-rail" aria-label="Workbenches">
  <div class="rail-tools">
    <label class="search">
      <span aria-hidden="true">⌕</span>
      <input
        aria-label="Search Workbenches"
        type="search"
        placeholder="Search"
        bind:value={store.query}
      />
    </label>
    <div class="open-actions">
      <button type="button" onclick={() => void store.openPicked('model-file')}
        >Open model file</button
      >
      <button type="button" onclick={() => void store.openPicked('folder')}>Open folder</button>
    </div>
  </div>

  <div class="group-heading">
    <span>Open</span><span class="count">{store.openEntries.length}</span>
  </div>
  <div class="workbench-list">
    {#each store.filteredOpen as entry (entry.descriptor.id)}
      <div class="workbench-row" class:active={entry.descriptor.id === store.activeId}>
        <button
          type="button"
          class="workbench-select"
          aria-label={`${entry.descriptor.name}, ${entry.descriptor.kind} Workbench, ${entry.descriptor.source.displayName} (${entry.descriptor.source.providerId})`}
          onclick={() => store.activate(entry.descriptor.id)}
        >
          <span class="row-top">
            <span class="source"
              >{entry.descriptor.source.displayName} ({entry.descriptor.source.providerId})</span
            >
            <span
              class="status"
              class:error={entry.status === 'error'}
              class:unavailable={entry.status === 'unavailable'}
            >
              {entry.status === 'error' || entry.status === 'unavailable'
                ? entry.reason.tag
                : entry.status}
            </span>
          </span>
          <span class="name">{entry.descriptor.name}</span>
          <span class="row-meta">
            <span class:model={entry.descriptor.kind === 'model'} class="kind-dot"></span>
            <span>{entry.descriptor.kind === 'model' ? 'Model' : 'Development'}</span>
            {#if entry.descriptor.kind === 'model'}
              <span
                >· {entry.descriptor.distribution === 'single-file'
                  ? 'Single file'
                  : 'Document Tree'}</span
              >
            {/if}
          </span>
        </button>
        <div class="row-actions">
          {#if entry.status === 'error' || entry.status === 'unavailable'}
            <button
              type="button"
              aria-label={`${recoveryActionLabel(entry.reason)} ${entry.descriptor.name}`}
              title={recoveryActionLabel(entry.reason)}
              onclick={() => void store.retry(entry.descriptor.id)}>↻</button
            >
          {/if}
          <button
            type="button"
            aria-label={`Reveal ${entry.descriptor.name}`}
            title="Reveal source"
            onclick={() => void store.reveal(entry.descriptor.id)}>↗</button
          >
          <button
            type="button"
            aria-label={`Close ${entry.descriptor.name}`}
            title={`Close ${entry.descriptor.name}`}
            onclick={() => store.close(entry.descriptor.id)}>×</button
          >
        </div>
      </div>
    {:else}
      <div class="empty">No open Workbenches</div>
    {/each}

    {#each store.failedRequests as failure (failure.key)}
      <div class="failed-request">
        <span
          >{failure.kind === 'source'
            ? `${failure.source.displayName} (${failure.source.providerId})`
            : failure.source}</span
        >
        <small>{failure.message}</small>
        <button type="button" onclick={() => store.removeFailedRequest(failure.key)}>Remove</button>
      </div>
    {/each}
  </div>

  <div class="recent-group">
    <button
      type="button"
      class="recent-toggle"
      aria-expanded={store.recentExpanded}
      aria-label={`Recent, ${store.recent.length} ${store.recent.length === 1 ? 'Workbench' : 'Workbenches'}`}
      onclick={() => (store.recentExpanded = !store.recentExpanded)}
    >
      <span>{store.recentExpanded ? '⌄' : '›'} Recent</span><span class="rule"></span><span
        >{store.recent.length}</span
      >
    </button>
    {#if store.recentExpanded}
      <div class="recent-list">
        {#each store.filteredRecent as descriptor (descriptor.id)}
          <button
            type="button"
            class="recent-row"
            aria-label={`Reopen ${descriptor.name}`}
            onclick={() => void store.reopen(descriptor.id)}
          >
            <span>{descriptor.name}</span><small
              >{descriptor.source.displayName} ({descriptor.source.providerId})</small
            >
          </button>
        {:else}
          <div class="empty">No Recent Workbenches</div>
        {/each}
      </div>
    {/if}
  </div>

  <div class="rail-footer">
    <!-- The two session-wide destinations, as opposed to everything above, which acts on
         an open Workbench. -->
    <button type="button" onclick={onOpenPlayground}
      ><span aria-hidden="true">▶</span> <span>Playground</span></button
    >
    <button type="button" onclick={onOpenSettings}
      ><span aria-hidden="true">⚙</span> <span>Settings</span></button
    >
  </div>
</nav>

<style>
  .workbench-rail {
    width: 100%;
    min-width: 0;
    height: 100%;
    display: flex;
    flex-direction: column;
    color: var(--text);
    background: var(--rail);
    overflow: hidden;
  }
  button,
  input {
    font: inherit;
  }
  .rail-tools {
    padding: 10px 12px 8px;
    border-bottom: 1px solid var(--edge);
  }
  .search {
    height: 32px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 9px;
    border: 1px solid var(--panel-edge);
    border-radius: 8px;
    color: var(--muted);
    background: var(--code-bg);
  }
  .search input {
    min-width: 0;
    flex: 1;
    border: 0;
    outline: 0;
    color: var(--text);
    background: transparent;
  }
  .open-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    margin-top: 8px;
  }
  .open-actions button,
  .rail-footer button {
    padding: 6px 8px;
    border: 1px solid var(--panel-edge);
    border-radius: 7px;
    color: var(--nav);
    background: var(--surface);
    cursor: pointer;
    font-size: 11.5px;
  }
  .open-actions button:hover,
  .rail-footer button:hover {
    color: var(--text);
    background: var(--hover);
  }
  .group-heading {
    display: flex;
    align-items: center;
    padding: 12px 20px 5px;
    color: var(--muted2);
    font-family: var(--mono);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }
  .count {
    margin-left: auto;
  }
  .workbench-list {
    padding: 0 10px;
    overflow: auto;
  }
  .workbench-row {
    position: relative;
    display: flex;
    margin: 2px 0;
    border: 1px solid transparent;
    border-radius: 9px;
    overflow: hidden;
  }
  .workbench-row:hover {
    background: var(--hover-soft);
  }
  .workbench-row.active {
    border-color: var(--panel-edge);
    background: linear-gradient(to right, rgba(214, 64, 159, 0.16), rgba(139, 92, 246, 0.1));
    box-shadow: inset 3px 0 0 var(--accent);
  }
  .workbench-select {
    min-width: 0;
    flex: 1;
    display: block;
    padding: 9px 76px 9px 11px;
    border: 0;
    color: inherit;
    text-align: left;
    background: transparent;
    cursor: pointer;
  }
  .row-top,
  .row-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    color: var(--muted2);
    font-size: 10.5px;
  }
  .source {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .status {
    margin-left: auto;
  }
  .status.error {
    color: var(--status-error);
  }
  .status.unavailable {
    color: var(--status-disconnected);
  }
  .name {
    display: block;
    margin: 5px 0 4px;
    overflow: hidden;
    color: var(--text);
    font-size: 13px;
    font-weight: 550;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .kind-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
  }
  .kind-dot.model {
    background: var(--accent2);
  }
  .row-actions {
    position: absolute;
    top: 25px;
    right: 7px;
    display: flex;
    opacity: 0;
  }
  .row-actions button {
    width: 22px;
    height: 22px;
    border: 0;
    border-radius: 6px;
    color: var(--muted2);
    background: transparent;
    cursor: pointer;
  }
  .workbench-row:hover .row-actions,
  .row-actions:focus-within {
    opacity: 1;
  }
  .row-actions button:hover {
    color: var(--text);
    background: var(--hover);
  }
  .failed-request {
    display: grid;
    gap: 3px;
    padding: 9px 11px;
    color: var(--accent-text);
    font-size: 11px;
  }
  .failed-request small {
    color: var(--muted);
  }
  .failed-request button {
    justify-self: start;
    border: 0;
    color: var(--accent-text);
    background: transparent;
    cursor: pointer;
  }
  .recent-group {
    padding: 5px 10px;
  }
  .recent-toggle {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    border: 0;
    color: var(--muted2);
    background: transparent;
    cursor: pointer;
    font-size: 11px;
  }
  .rule {
    height: 1px;
    flex: 1;
    background: var(--edge);
  }
  .recent-row {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 7px 10px;
    border: 0;
    border-radius: 7px;
    color: var(--nav);
    text-align: left;
    background: transparent;
    cursor: pointer;
  }
  .recent-row:hover {
    color: var(--text);
    background: var(--hover-soft);
  }
  .recent-row small {
    overflow: hidden;
    color: var(--muted2);
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .empty {
    padding: 10px;
    color: var(--muted2);
    font-size: 11px;
  }
  .rail-footer {
    margin-top: auto;
    display: grid;
    gap: 6px;
    padding: 10px 12px;
    border-top: 1px solid var(--edge);
  }
  .rail-footer button {
    width: 100%;
    text-align: left;
  }
</style>
