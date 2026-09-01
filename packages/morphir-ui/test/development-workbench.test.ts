import { cleanup, render, screen } from '@testing-library/svelte'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  projectKey,
  sourceKey,
  type ProjectSnapshot,
  type WorkspaceSnapshot,
} from '@morphir/workspace'
import DevelopmentWorkbenchView from '../src/views/DevelopmentWorkbenchView.svelte'
import {
  legacySourceRef,
  makeAppServices,
  type DevelopmentNavigationState,
  type DevelopmentWorkbenchData,
} from '../src/index.ts'
import { makeFakeCore } from './support/fake-services.ts'

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

const workbench = (projects: ReadonlyArray<ProjectSnapshot>): DevelopmentWorkbenchData => ({
  kind: 'development',
  descriptor,
  snapshot: {
    id: descriptor.id,
    root: source,
    name: 'Development',
    configAnchor: 'morphir.toml',
    state: 'open',
    projects,
    modelSources: [],
    knowledgeBaseSources: [],
    diagnostics: [],
  } satisfies WorkspaceSnapshot,
})

const renderView = (
  projects: ReadonlyArray<ProjectSnapshot>,
  navigation: DevelopmentNavigationState,
  callbacks: {
    onSelectProject?: (projectId: string) => void
    onRetryProject?: (projectId: string) => void
    onSelectDefinition?: (projectId: string, definitionId: string | null) => void
  } = {},
) =>
  render(DevelopmentWorkbenchView, {
    props: {
      workbench: workbench(projects),
      navigation,
      onSelectProject: callbacks.onSelectProject ?? vi.fn(),
      onRetryProject: callbacks.onRetryProject ?? vi.fn(),
      onSelectDefinition: callbacks.onSelectDefinition ?? vi.fn(),
    },
  })

describe('DevelopmentWorkbenchView', () => {
  test('renders the empty project state', () => {
    renderView([], { activeProjectId: null, projects: [] })

    expect(screen.getByText('No projects discovered')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Projects' }).getAttribute('aria-expanded')).toBe(
      'true',
    )
  })

  test('renders loading and error states with project-local retry', async () => {
    const loading = renderView([orders], {
      activeProjectId: orders.id,
      projects: [{ projectId: orders.id, status: 'loading', selectedDefinitionId: null }],
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
            status: 'error',
            message: 'morphir-ir.json was not found',
            selectedDefinitionId: null,
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

    await userEvent.click(screen.getByRole('button', { name: 'Projects' }))
    expect(screen.getByRole('button', { name: 'Projects' }).getAttribute('aria-expanded')).toBe(
      'false',
    )
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
            status: 'ready',
            model,
            selectedDefinitionId: null,
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
})
