<script lang="ts">
  import {
    projectModelForDisplay,
    projectModelSelection,
    recoveryActionLabel,
    type WorkbenchRecoveryReason,
  } from '../workbench/project-model-state.ts'
  import type { WorkspaceDiagnostic } from '@morphir/workspace'
  import type { DevelopmentNavigationState, DevelopmentWorkbenchData } from '../workbench/types.ts'
  import type { InspectMeta } from './insight/insight-context.ts'
  import IrExplorerView from './IrExplorerView.svelte'
  import ProjectNavigation from './development/ProjectNavigation.svelte'
  import LifecycleNotice from './development/LifecycleNotice.svelte'
  import type { DetailLocation, DetailResolution } from './insight/detail-location.ts'

  let {
    workbench,
    navigation,
    onSelectProject,
    onRetryProject,
    onSelectDefinition,
    onInspect,
    unavailableReason,
    onRecoverWorkbench,
    detailLocation,
    onDetailLocation,
    onDetailResolution,
  }: {
    workbench: DevelopmentWorkbenchData
    navigation: DevelopmentNavigationState
    onSelectProject?: (projectId: string) => void
    onRetryProject?: (projectId: string) => void
    onSelectDefinition?: (projectId: string, definitionId: string | null) => void
    onInspect?: (meta: InspectMeta) => void
    unavailableReason?: WorkbenchRecoveryReason
    onRecoverWorkbench?: () => void
    detailLocation?: DetailLocation
    onDetailLocation?: (location: DetailLocation) => void
    onDetailResolution?: (resolution: DetailResolution) => void
  } = $props()

  const activeProject = $derived(
    workbench.snapshot.projects.find((project) => project.id === navigation.activeProjectId) ??
      null,
  )
  const activeModel = $derived(
    navigation.projects.find((project) => project.projectId === navigation.activeProjectId) ?? null,
  )
  const displayModel = $derived(activeModel ? projectModelForDisplay(activeModel.modelState) : null)
  const selectedDefinitionId = $derived(
    activeModel ? projectModelSelection(activeModel.modelState) : null,
  )
  const diagnostics = $derived<ReadonlyArray<WorkspaceDiagnostic>>([
    ...workbench.snapshot.diagnostics,
    ...(activeProject?.diagnostics ?? []),
  ])
  const notice = $derived.by(() => {
    if (displayModel && unavailableReason) {
      return {
        tag: 'recovery' as const,
        title: `${workbench.descriptor.name} is unavailable`,
        reason: unavailableReason,
      }
    }
    if (displayModel && activeModel?.modelState.tag === 'failed' && activeProject) {
      return {
        tag: 'recovery' as const,
        title: `Unable to refresh ${activeProject.name}`,
        reason: activeModel.modelState.failure,
      }
    }
    if (displayModel && activeModel?.modelState.tag === 'loading' && activeProject) {
      return { tag: 'model-refresh' as const, title: `Refreshing ${activeProject.name}` }
    }
    if (activeProject?.state === 'stale') {
      return {
        tag: 'provider-state' as const,
        state: activeProject.state,
        title: `${activeProject.name} is stale`,
      }
    }
    if (activeProject?.state === 'error') {
      return {
        tag: 'provider-state' as const,
        state: activeProject.state,
        title: `${activeProject.name} has errors`,
      }
    }
    if (activeProject?.state === 'loading') {
      return {
        tag: 'provider-state' as const,
        state: activeProject.state,
        title: `${activeProject.name} is loading`,
      }
    }
    if (workbench.snapshot.state !== 'open') {
      return {
        tag: 'provider-state' as const,
        state: workbench.snapshot.state,
        title: `${workbench.descriptor.name} is ${workbench.snapshot.state}`,
      }
    }
    if (diagnostics.length > 0) {
      return {
        tag: 'diagnostics' as const,
        title: activeProject ? `${activeProject.name} diagnostics` : 'Workspace diagnostics',
      }
    }
    return null
  })

  const recover = () => {
    if (unavailableReason) {
      onRecoverWorkbench?.()
    } else if (activeProject) {
      onRetryProject?.(activeProject.id)
    }
  }
</script>

{#snippet projects()}
  <ProjectNavigation
    snapshot={workbench.snapshot}
    activeProjectId={navigation.activeProjectId}
    onSelect={onSelectProject}
  />
  {#if notice}<LifecycleNotice {notice} {diagnostics} onRecover={recover} />{/if}
{/snippet}

{#if activeProject && displayModel}
  <IrExplorerView
    model={displayModel}
    treeLeading={projects}
    {selectedDefinitionId}
    onSelectedDefinition={(definitionId) => onSelectDefinition?.(activeProject.id, definitionId)}
    {onInspect}
    {detailLocation}
    {onDetailLocation}
    {onDetailResolution}
  />
{:else}
  <section class="development-workbench">
    <aside class="project-pane">
      <header>
        <h2>{workbench.snapshot.name ?? workbench.descriptor.name}</h2>
        <span>{workbench.descriptor.source.providerId}</span>
      </header>
      {@render projects()}
    </aside>
    <main>
      {#if workbench.snapshot.projects.length === 0}
        <div class="state-card">
          <h1>No projects discovered</h1>
          <p>
            Check the workspace members in {workbench.snapshot.configAnchor ??
              'Morphir configuration'}.
          </p>
        </div>
      {:else if !activeProject}
        <div class="state-card">
          <h1>Select a project</h1>
          <p>Choose a project to explore its model.</p>
        </div>
      {:else if unavailableReason}
        <div class="state-card error" role="alert">
          <h1>{workbench.descriptor.name} is unavailable</h1>
          <p>{unavailableReason.message}</p>
          <button type="button" onclick={() => onRecoverWorkbench?.()}
            >{recoveryActionLabel(unavailableReason)}</button
          >
        </div>
      {:else if activeModel?.modelState.tag === 'loading'}
        <div class="state-card" role="status">
          <h1>Loading {activeProject.name}…</h1>
          <p>Opening the project model through {workbench.descriptor.source.providerId}.</p>
        </div>
      {:else if activeModel?.modelState.tag === 'failed'}
        <div class="state-card error" role="alert">
          <h1>Unable to open {activeProject.name}</h1>
          <p>{activeModel.modelState.failure.message}</p>
          <button
            type="button"
            aria-label={recoveryActionLabel(activeModel.modelState.failure) === 'Retry'
              ? `Retry ${activeProject.name}`
              : recoveryActionLabel(activeModel.modelState.failure)}
            onclick={() => onRetryProject?.(activeProject.id)}
            >{recoveryActionLabel(activeModel.modelState.failure)}</button
          >
        </div>
      {:else}
        <div class="state-card">
          <h1>Select {activeProject.name} again</h1>
          <p>The project model has not been requested.</p>
        </div>
      {/if}
    </main>
  </section>
{/if}

<style>
  .development-workbench {
    display: flex;
    flex: 1;
    width: 100%;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: var(--bg);
  }
  .project-pane {
    flex: 0 0 280px;
    min-width: 0;
    height: 100%;
    overflow: auto;
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
    padding: 0 12px 0 14px;
    border-bottom: 1px solid var(--head-edge);
  }
  header h2,
  header span {
    min-width: 0;
    margin: 0;
    overflow: hidden;
    color: var(--muted2);
    font-family: var(--mono);
    font-size: 10px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  header h2 {
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  header span {
    color: var(--muted);
  }
  main {
    flex: 1;
    min-width: 0;
    overflow: auto;
    padding: 16px;
  }
  .state-card {
    box-sizing: border-box;
    width: min(100%, 620px);
    margin: 8vh auto;
    padding: 20px;
    border: 1px solid var(--panel-edge);
    border-radius: 10px;
    background: var(--panel);
  }
  .state-card.error {
    border-color: color-mix(in srgb, var(--accent) 40%, var(--panel-edge));
  }
  .state-card h1 {
    margin: 0 0 4px;
    color: var(--text-strong);
    font-size: 16px;
  }
  .state-card p {
    margin: 0;
    color: var(--muted);
    font-size: 13px;
  }
  .state-card button {
    margin-top: 14px;
    padding: 6px 12px;
    border: 1px solid var(--panel-edge);
    border-radius: 7px;
    color: var(--text-strong);
    background: var(--surface);
    font: inherit;
  }
</style>
