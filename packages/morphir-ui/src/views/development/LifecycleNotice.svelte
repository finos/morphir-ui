<script lang="ts">
  import type { ProjectState, WorkspaceDiagnostic, WorkspaceState } from '@morphir/workspace'
  import {
    recoveryActionLabel,
    type WorkbenchRecoveryReason,
  } from '../../workbench/project-model-state.ts'

  type ProviderNotice = {
    readonly tag: 'provider-state'
    readonly state: ProjectState | WorkspaceState
    readonly title: string
  }

  type RefreshNotice = {
    readonly tag: 'model-refresh'
    readonly title: string
  }

  type RecoveryNotice = {
    readonly tag: 'recovery'
    readonly title: string
    readonly reason: WorkbenchRecoveryReason
  }

  type DiagnosticsNotice = {
    readonly tag: 'diagnostics'
    readonly title: string
  }

  let {
    notice,
    diagnostics = [],
    onRecover,
  }: {
    notice: ProviderNotice | RefreshNotice | RecoveryNotice | DiagnosticsNotice
    diagnostics?: ReadonlyArray<WorkspaceDiagnostic>
    onRecover?: () => void
  } = $props()

  const isAlert = $derived(
    notice.tag === 'recovery' ||
      (notice.tag === 'provider-state' && notice.state === 'error') ||
      diagnostics.some((diagnostic) => diagnostic.severity === 'error'),
  )
  const hasWarning = $derived(diagnostics.some((diagnostic) => diagnostic.severity === 'warning'))
</script>

<section
  class="lifecycle-notice"
  class:alert={isAlert}
  class:stale={notice.tag === 'provider-state' && notice.state === 'stale'}
  class:loading={notice.tag === 'model-refresh' ||
    (notice.tag === 'provider-state' && notice.state === 'loading')}
  class:warning={!isAlert && hasWarning}
  class:disconnected={notice.tag === 'recovery' && notice.reason.tag === 'provider-disconnected'}
  role={isAlert ? 'alert' : 'status'}
>
  <strong>{notice.title}</strong>
  {#if notice.tag === 'recovery'}
    <span>{notice.reason.message}</span>
    <button type="button" onclick={() => onRecover?.()}>{recoveryActionLabel(notice.reason)}</button
    >
  {/if}
  {#if diagnostics.length > 0}
    <ul aria-label="Diagnostics">
      {#each diagnostics as diagnostic, index (index)}
        <li class:diagnostic-error={diagnostic.severity === 'error'}>
          <span>{diagnostic.message}</span>
          {#if diagnostic.code || diagnostic.path}
            <small>{[diagnostic.code, diagnostic.path].filter(Boolean).join(' · ')}</small>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .lifecycle-notice {
    display: grid;
    gap: 4px;
    margin: 8px;
    padding: 8px 10px;
    border: 1px solid color-mix(in srgb, var(--status-loading) 40%, var(--panel-edge));
    border-radius: 7px;
    color: var(--status-loading);
    background: color-mix(in srgb, var(--status-loading) 8%, var(--panel));
    font-size: 11px;
  }
  .lifecycle-notice.stale {
    border-color: color-mix(in srgb, var(--status-stale) 40%, var(--panel-edge));
    color: var(--status-stale);
    background: color-mix(in srgb, var(--status-stale) 8%, var(--panel));
  }
  .lifecycle-notice.warning {
    border-color: color-mix(in srgb, var(--status-stale) 40%, var(--panel-edge));
    color: var(--status-stale);
    background: color-mix(in srgb, var(--status-stale) 8%, var(--panel));
  }
  .lifecycle-notice.alert {
    border-color: color-mix(in srgb, var(--status-error) 40%, var(--panel-edge));
    color: var(--status-error);
    background: color-mix(in srgb, var(--status-error) 8%, var(--panel));
  }
  .lifecycle-notice.disconnected {
    border-color: color-mix(in srgb, var(--status-disconnected) 40%, var(--panel-edge));
    color: var(--status-disconnected);
    background: color-mix(in srgb, var(--status-disconnected) 8%, var(--panel));
  }
  span {
    color: var(--muted);
  }
  ul {
    display: grid;
    gap: 5px;
    margin: 2px 0 0;
    padding: 0;
    list-style: none;
  }
  li {
    display: grid;
    gap: 1px;
  }
  li.diagnostic-error span {
    color: var(--status-error);
  }
  small {
    color: var(--muted2);
    font-family: var(--mono);
    font-size: 9px;
  }
  button {
    justify-self: start;
    margin-top: 3px;
    padding: 4px 8px;
    border: 1px solid currentColor;
    border-radius: 6px;
    color: inherit;
    background: transparent;
    font: inherit;
    cursor: pointer;
  }
</style>
