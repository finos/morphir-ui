<script lang="ts">
  import type { WorkspaceSnapshot } from '@morphir/workspace'

  let {
    snapshot,
    activeProjectId,
    onSelect,
  }: {
    snapshot: WorkspaceSnapshot
    activeProjectId: string | null
    onSelect?: (projectId: string) => void
  } = $props()

  let expanded = $state(true)
</script>

<section class="projects">
  <button
    class="projects-toggle"
    type="button"
    aria-label={`Projects, workspace ${snapshot.state}, ${snapshot.projects.length} ${snapshot.projects.length === 1 ? 'project' : 'projects'}`}
    aria-expanded={expanded}
    onclick={() => (expanded = !expanded)}
  >
    <span class="disclosure" aria-hidden="true">{expanded ? '⌄' : '›'}</span>
    <span>Projects</span>
    <span class={`workspace-state state-${snapshot.state}`} aria-hidden="true"
      >{snapshot.state}</span
    >
    <span class="count">{snapshot.projects.length}</span>
  </button>
  {#if expanded}
    <div class="project-list">
      {#each snapshot.projects as project (project.id)}
        <button
          class="project"
          class:active={project.id === activeProjectId}
          type="button"
          aria-label={`Project ${project.name}, ${project.relativePath}, ${project.state}`}
          aria-current={project.id === activeProjectId ? 'page' : undefined}
          onclick={() => onSelect?.(project.id)}
        >
          <span class="project-name">{project.name}</span>
          <span class="project-path">{project.relativePath}</span>
          <span class={`project-state state-${project.state}`}>{project.state}</span>
          {#if project.version}<span class="project-version">v{project.version}</span>{/if}
        </button>
      {:else}
        <p class="empty">No workspace projects</p>
      {/each}
    </div>
  {/if}
</section>

<style>
  .projects {
    border-bottom: 1px solid var(--edge);
  }
  button {
    color: inherit;
    font: inherit;
  }
  .projects-toggle {
    width: 100%;
    min-height: 36px;
    display: grid;
    grid-template-columns: 14px 1fr auto auto;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border: 0;
    background: transparent;
    color: var(--muted2);
    font-family: var(--mono);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-align: left;
    text-transform: uppercase;
  }
  .projects-toggle:hover,
  .projects-toggle:focus-visible {
    background: var(--hover);
  }
  .disclosure,
  .count {
    color: var(--muted);
  }
  .count {
    font-size: 10px;
    letter-spacing: normal;
  }
  .workspace-state {
    font-size: 9px;
    letter-spacing: normal;
  }
  .project-list {
    display: grid;
    gap: 2px;
    padding: 0 8px 8px;
  }
  .project {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 2px 8px;
    padding: 7px 8px 7px 12px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    text-align: left;
  }
  .project::before {
    position: absolute;
    inset: 6px auto 6px 3px;
    width: 2px;
    border-radius: 999px;
    background: transparent;
    content: '';
  }
  .project:hover,
  .project:focus-visible,
  .project.active {
    background: var(--hover);
  }
  .project.active::before {
    background: var(--accent2);
  }
  .project-name,
  .project-path {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .project-name {
    color: var(--text-strong);
    font-size: 12px;
    font-weight: 600;
  }
  .project-path,
  .project-version,
  .project-state,
  .empty {
    color: var(--muted);
    font-family: var(--mono);
    font-size: 10px;
  }
  .project-state {
    grid-column: 2;
    grid-row: 1;
    align-self: center;
    text-transform: uppercase;
  }
  .project-version {
    grid-column: 2;
  }
  .state-error {
    color: var(--status-error);
  }
  .state-ready {
    color: var(--status-ready);
  }
  .state-loading {
    color: var(--status-loading);
  }
  .state-stale {
    color: var(--status-stale);
  }
  .state-unloaded,
  .state-closed {
    color: var(--status-unloaded);
  }
  .state-initializing {
    color: var(--status-loading);
  }
  .state-open {
    color: var(--status-ready);
  }
  .empty {
    margin: 4px 8px 8px;
  }
</style>
