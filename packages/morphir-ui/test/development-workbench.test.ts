import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  projectKey,
  sourceKey,
  type ProjectSnapshot,
  type WorkspaceDiagnostic,
  type WorkspaceSnapshot,
} from '@morphir/workspace'
import DevelopmentWorkbenchView from '../src/views/DevelopmentWorkbenchView.svelte'
import {
  legacySourceRef,
  makeAppServices,
  type DevelopmentNavigationState,
  type DevelopmentWorkbenchData,
  type WorkbenchRecoveryReason,
} from '../src/index.ts'
import { makeFakeCore } from './support/fake-services.ts'
import type { DetailLocation } from '../src/views/insight/detail-location.ts'

afterEach(() => cleanup())

const irFixture = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../morphir-ir/test/fixtures/listType-ir.json'),
  'utf8',
)

const source = legacySourceRef('/development')
const timestamp = '2026-08-31T12:00:00.000Z'
const descriptor = {
  id: sourceKey(source),
  source,
  name: 'Development',
  kind: 'development' as const,
  route: 'overview' as const,
  openedAt: timestamp,
  lastUsedAt: timestamp,
}

const orders: ProjectSnapshot = {
  id: projectKey(source, 'packages/orders'),
  name: 'Orders',
  version: '1.0.0',
  relativePath: 'packages/orders',
  configAnchor: 'packages/orders/morphir.toml',
  sourceDirectory: 'src',
  state: 'unloaded',
  modelSources: [],
  knowledgeBaseSources: [],
  diagnostics: [],
}

const workbench = (
  projects: ReadonlyArray<ProjectSnapshot>,
  state: WorkspaceSnapshot['state'] = 'open',
  diagnostics: ReadonlyArray<WorkspaceDiagnostic> = [],
): DevelopmentWorkbenchData => ({
  kind: 'development',
  descriptor,
  snapshot: {
    id: descriptor.id,
    root: source,
    name: 'Development',
    configAnchor: 'morphir.toml',
    state,
    projects,
    modelSources: [],
    knowledgeBaseSources: [],
    diagnostics,
  } satisfies WorkspaceSnapshot,
})

const renderView = (
  projects: ReadonlyArray<ProjectSnapshot>,
  navigation: DevelopmentNavigationState,
  callbacks: {
    onSelectProject?: (projectId: string) => void
    onRetryProject?: (projectId: string) => void
    onSelectDefinition?: (projectId: string, definitionId: string | null) => void
    onRecoverWorkbench?: () => void
  } = {},
  options: {
    workspaceState?: WorkspaceSnapshot['state']
    workspaceDiagnostics?: ReadonlyArray<WorkspaceDiagnostic>
    unavailableReason?: WorkbenchRecoveryReason
    detailLocation?: DetailLocation
  } = {},
) =>
  render(DevelopmentWorkbenchView, {
    props: {
      workbench: workbench(projects, options.workspaceState, options.workspaceDiagnostics),
      navigation,
      onSelectProject: callbacks.onSelectProject ?? vi.fn(),
      onRetryProject: callbacks.onRetryProject ?? vi.fn(),
      onSelectDefinition: callbacks.onSelectDefinition ?? vi.fn(),
      onRecoverWorkbench: callbacks.onRecoverWorkbench ?? vi.fn(),
      unavailableReason: options.unavailableReason,
      detailLocation: options.detailLocation,
    },
  })

describe('DevelopmentWorkbenchView', () => {
  test('resolves a deep-linked definition through the project selection callback', async () => {
    const { core } = makeFakeCore({ workspaceContent: irFixture })
    const services = await makeAppServices({ core })
    const model = await services.loadDevelopmentProjectModel(descriptor, orders.id)
    const onSelectDefinition = vi.fn()
    renderView(
      [orders],
      {
        activeProjectId: orders.id,
        projects: [
          {
            projectId: orders.id,
            modelState: { tag: 'ready', current: { model, selectedDefinitionId: null } },
          },
        ],
      },
      { onSelectDefinition },
      {
        detailLocation: {
          definition: 'Morphir.Example.App.Forecast.listExample',
          view: 'xray',
        },
      },
    )

    await waitFor(() =>
      expect(onSelectDefinition).toHaveBeenCalledWith(
        orders.id,
        'definition:value:Morphir.Example.App:Forecast:listExample',
      ),
    )
  })

  test('renders the empty project state', () => {
    renderView([], { activeProjectId: null, projects: [] })

    expect(screen.getByText('No projects discovered')).toBeTruthy()
    expect(
      screen
        .getByRole('button', { name: 'Projects, workspace open, 0 projects' })
        .getAttribute('aria-expanded'),
    ).toBe('true')
  })

  test('renders loading and error states with project-local retry', async () => {
    const loading = renderView([orders], {
      activeProjectId: orders.id,
      projects: [{ projectId: orders.id, modelState: { tag: 'loading', lastUsable: null } }],
    })
    expect(screen.getByRole('status').textContent).toContain('Loading Orders')
    loading.unmount()

    const onRetryProject = vi.fn()
    renderView(
      [orders],
      {
        activeProjectId: orders.id,
        projects: [
          {
            projectId: orders.id,
            modelState: {
              tag: 'failed',
              failure: { tag: 'load-failed', message: 'morphir-ir.json was not found' },
              lastUsable: null,
            },
          },
        ],
      },
      { onRetryProject },
    )

    expect(screen.getByRole('alert').textContent).toContain('morphir-ir.json was not found')
    await userEvent.click(screen.getByRole('button', { name: 'Retry Orders' }))
    expect(onRetryProject).toHaveBeenCalledWith(orders.id)
  })

  test('selects a project and lets the Projects section collapse', async () => {
    const onSelectProject = vi.fn()
    renderView([orders], { activeProjectId: null, projects: [] }, { onSelectProject })

    await userEvent.click(screen.getByRole('button', { name: /Orders/ }))
    expect(onSelectProject).toHaveBeenCalledWith(orders.id)

    await userEvent.click(
      screen.getByRole('button', { name: 'Projects, workspace open, 1 project' }),
    )
    expect(
      screen
        .getByRole('button', { name: 'Projects, workspace open, 1 project' })
        .getAttribute('aria-expanded'),
    ).toBe('false')
    expect(screen.queryByRole('button', { name: /Orders/ })).toBeNull()
  })

  test('reuses the searchable model hierarchy and reports controlled definition selection', async () => {
    const { core } = makeFakeCore({ workspaceContent: irFixture })
    const services = await makeAppServices({ core })
    const model = await services.loadDevelopmentProjectModel(descriptor, orders.id)
    const onSelectDefinition = vi.fn()
    renderView(
      [orders],
      {
        activeProjectId: orders.id,
        projects: [
          {
            projectId: orders.id,
            modelState: {
              tag: 'ready',
              current: { model, selectedDefinitionId: null },
            },
          },
        ],
      },
      { onSelectDefinition },
    )

    expect(screen.getByRole('tree', { name: 'Model hierarchy' })).toBeTruthy()
    expect(screen.getByRole('treeitem', { name: 'Morphir.Example.App' })).toBeTruthy()
    expect(screen.getByRole('searchbox', { name: 'Search model' })).toBeTruthy()
    await userEvent.click(screen.getByRole('treeitem', { name: 'listExample' }))
    expect(onSelectDefinition).toHaveBeenCalledWith(
      orders.id,
      'definition:value:Morphir.Example.App:Forecast:listExample',
    )
  })

  test('renders every provider-owned lifecycle state without dropping its diagnostics', () => {
    for (const state of ['closed', 'initializing', 'open', 'error'] as const) {
      const message = `Workspace ${state} diagnostic`
      const view = renderView(
        [],
        { activeProjectId: null, projects: [] },
        {},
        {
          workspaceState: state,
          workspaceDiagnostics: [
            {
              severity: 'warning',
              code: `workspace.${state}`,
              message,
              path: 'morphir.toml',
              projectId: null,
            },
          ],
        },
      )
      expect(
        screen.getByRole('button', { name: `Projects, workspace ${state}, 0 projects` }),
      ).toBeTruthy()
      expect(screen.getByText(message)).toBeTruthy()
      view.unmount()
    }

    const projects = (['unloaded', 'loading', 'ready', 'stale', 'error'] as const).map(
      (state, index) => ({
        ...orders,
        id: `${orders.id}:${state}`,
        name: `Project ${index}`,
        relativePath: `packages/${state}`,
        state,
      }),
    )
    const projectList = renderView(projects, { activeProjectId: null, projects: [] })
    for (const project of projects) {
      expect(
        screen.getByLabelText(`Project ${project.name}, ${project.relativePath}, ${project.state}`),
      ).toBeTruthy()
    }
    projectList.unmount()

    for (const project of projects) {
      const message = `Project ${project.state} diagnostic`
      const view = renderView(
        [
          {
            ...project,
            diagnostics: [
              {
                severity: 'warning',
                code: `project.${project.state}`,
                message,
                path: project.relativePath,
                projectId: project.id,
              },
            ],
          },
        ],
        {
          activeProjectId: project.id,
          projects: [{ projectId: project.id, modelState: { tag: 'unloaded' } }],
        },
      )
      expect(screen.getByText(message)).toBeTruthy()
      view.unmount()
    }
  })

  test('shows every diagnostic for a ready project without requiring a loaded model', () => {
    renderView(
      [
        {
          ...orders,
          state: 'ready',
          diagnostics: [
            {
              severity: 'warning',
              code: 'project.source',
              message: 'A source directory is outside the project root',
              path: '../shared',
              projectId: orders.id,
            },
            {
              severity: 'info',
              code: 'project.version',
              message: 'No project version was declared',
              path: 'morphir.toml',
              projectId: orders.id,
            },
          ],
        },
      ],
      {
        activeProjectId: orders.id,
        projects: [{ projectId: orders.id, modelState: { tag: 'unloaded' } }],
      },
    )

    expect(screen.getByText('A source directory is outside the project root')).toBeTruthy()
    expect(screen.getByText('No project version was declared')).toBeTruthy()
  })

  test('keeps the last model visible while stale, refreshing, or failed', async () => {
    const { core } = makeFakeCore({ workspaceContent: irFixture })
    const services = await makeAppServices({ core })
    const model = await services.loadDevelopmentProjectModel(descriptor, orders.id)
    const usable = { model, selectedDefinitionId: null }

    const staleView = renderView([{ ...orders, state: 'stale' }], {
      activeProjectId: orders.id,
      projects: [{ projectId: orders.id, modelState: { tag: 'ready', current: usable } }],
    })
    expect(screen.getByRole('tree', { name: 'Model hierarchy' })).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('Orders is stale')
    staleView.unmount()

    const loadingView = renderView([orders], {
      activeProjectId: orders.id,
      projects: [{ projectId: orders.id, modelState: { tag: 'loading', lastUsable: usable } }],
    })
    expect(screen.getByRole('tree', { name: 'Model hierarchy' })).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('Refreshing Orders')
    loadingView.unmount()

    const onRetryProject = vi.fn()
    renderView(
      [orders],
      {
        activeProjectId: orders.id,
        projects: [
          {
            projectId: orders.id,
            modelState: {
              tag: 'failed',
              failure: { tag: 'load-failed', message: 'Compilation failed' },
              lastUsable: usable,
            },
          },
        ],
      },
      { onRetryProject },
    )
    expect(screen.getByRole('tree', { name: 'Model hierarchy' })).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('Compilation failed')
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetryProject).toHaveBeenCalledWith(orders.id)
  })

  test('offers permission and provider-specific recovery without hiding the model', async () => {
    const { core } = makeFakeCore({ workspaceContent: irFixture })
    const services = await makeAppServices({ core })
    const model = await services.loadDevelopmentProjectModel(descriptor, orders.id)
    const usable = { model, selectedDefinitionId: null }
    const onRetryProject = vi.fn()

    const permissionView = renderView(
      [orders],
      {
        activeProjectId: orders.id,
        projects: [
          {
            projectId: orders.id,
            modelState: {
              tag: 'failed',
              failure: { tag: 'permission-required', message: 'Directory access was revoked' },
              lastUsable: usable,
            },
          },
        ],
      },
      { onRetryProject },
    )
    expect(screen.getByRole('tree', { name: 'Model hierarchy' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Grant access' }))
    expect(onRetryProject).toHaveBeenCalledWith(orders.id)
    permissionView.unmount()

    const onRecoverWorkbench = vi.fn()
    renderView(
      [orders],
      {
        activeProjectId: orders.id,
        projects: [{ projectId: orders.id, modelState: { tag: 'ready', current: usable } }],
      },
      { onRecoverWorkbench },
      {
        unavailableReason: {
          tag: 'provider-disconnected',
          message: 'CLI connection closed',
        },
      },
    )
    expect(screen.getByRole('tree', { name: 'Model hierarchy' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Reconnect' }))
    expect(onRecoverWorkbench).toHaveBeenCalledOnce()
  })
})
