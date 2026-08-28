<script lang="ts">
  import type { Capabilities } from '../services/services.ts'
  import type { WorkspaceState } from '../state/workspace-state.svelte.ts'
  let {
    workspace,
    capabilities,
    onOpen,
  }: { workspace: WorkspaceState; capabilities: Capabilities; onOpen: () => void } = $props()
</script>

<section class="card">
  <h2 class="card-title">Workspace</h2>
  {#if workspace.current}
    <div class="row">
      <span class="label">Path</span><span class="value">{workspace.current.ref.path}</span>
    </div>
    <div class="row">
      <span class="label">Package</span><span class="value"
        >{workspace.current.ir.package.name}</span
      >
    </div>
    <div class="row">
      <span class="label">Modules</span><span class="value"
        >{workspace.current.ir.package.moduleCount}</span
      >
    </div>
  {:else}
    <p class="muted">No workspace open.</p>
  {/if}
  {#if workspace.error}<p class="error">{workspace.error}</p>{/if}
  <button class="action" onclick={onOpen}>Open workspace…</button>
</section>

{#if capabilities.reopenWorkspaces && workspace.recents.length > 0}
  <section class="card">
    <h2 class="card-title">Recent workspaces</h2>
    {#each workspace.recents as path (path)}
      <button class="recent" onclick={() => workspace.reopen(path)}>{path}</button>
    {/each}
  </section>
{/if}

<style>
  .card {
    background: var(--panel);
    border: 1px solid var(--panel-edge);
    border-radius: 10px;
    padding: 16px;
  }
  .card-title {
    font-family: var(--mono);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--muted2);
    margin-bottom: 10px;
  }
  .row {
    display: flex;
    justify-content: space-between;
    padding: 6px 0;
    border-bottom: 1px solid var(--row-edge);
  }
  .label {
    color: var(--muted);
  }
  .value {
    font-family: var(--mono);
    font-size: 12.5px;
    color: var(--accent-text);
  }
  .muted {
    color: var(--muted);
  }
  .error {
    color: var(--accent);
    font-size: 13px;
    margin-top: 8px;
  }
  .action {
    margin-top: 12px;
    padding: 7px 14px;
    border-radius: 8px;
    border: 1px solid var(--panel-edge);
    background: var(--hover-soft);
    color: var(--text);
    cursor: pointer;
  }
  .action:hover {
    background: var(--hover);
  }
  .recent {
    display: block;
    width: 100%;
    text-align: left;
    padding: 7px 10px;
    border-radius: 8px;
    background: none;
    border: none;
    color: var(--nav);
    font-family: var(--mono);
    font-size: 12.5px;
    cursor: pointer;
  }
  .recent:hover {
    background: var(--hover-soft);
    color: var(--text);
  }
</style>
