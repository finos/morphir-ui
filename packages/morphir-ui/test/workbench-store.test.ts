import { Effect, Stream } from 'effect'
import { describe, expect, test, vi } from 'vitest'
import {
  projectKey,
  sourceKey,
  type ProjectSnapshot,
  type WorkspaceEvent,
  type WorkspaceSnapshot,
} from '@morphir/workspace'
import {
  WorkbenchStore,
  WorkbenchError,
  defaultUiConfig,
  legacyModelDescriptor,
  legacySourceRef,
  makeAppServices,
  projectModelForDisplay,
  type ModelWorkbenchDescriptor,
} from '../src/index.ts'
import { makeFakeCore } from './support/fake-services.ts'

const makeStore = async (
  failingSources: ReadonlyArray<string> = [],
  failingLoads: ReadonlyArray<string> = [],
): Promise<WorkbenchStore> => {
  const { core } = makeFakeCore({ failingSources, failingLoads })
  return new WorkbenchStore(await makeAppServices({ core }), defaultUiConfig.workbenches)
}

const workbenchId = (locator: string): string =>
  sourceKey({ providerId: 'legacy-local', locator, displayName: locator })

const project = (
  source: ReturnType<typeof legacySourceRef>,
  relativePath: string,
  name: string,
): ProjectSnapshot => ({
  id: projectKey(source, relativePath),
  name,
  version: '1.0.0',
  relativePath,
  configAnchor: `${relativePath}/morphir.toml`,
  sourceDirectory: 'src',
  state: 'unloaded',
  modelSources: [],
  knowledgeBaseSources: [],
  diagnostics: [],
})

const developmentSnapshot = (
  source: ReturnType<typeof legacySourceRef>,
  projects: ReadonlyArray<ProjectSnapshot>,
): WorkspaceSnapshot => ({
  id: sourceKey(source),
  root: source,
  name: source.displayName,
  configAnchor: 'morphir.toml',
  state: 'open',
  projects,
  modelSources: [],
  knowledgeBaseSources: [],
  diagnostics: [],
})

describe('WorkbenchStore', () => {
  test('restoration deduplicates canonical command-line sources and activates the first', async () => {
    const { core } = makeFakeCore({ canonicalSources: { '/alias.json': '/real/model.json' } })
    const services = await makeAppServices({ core })
    const descriptor = await services.inspectWorkbench(legacySourceRef('/real/model.json'))
    const store = new WorkbenchStore(services, {
      open: [descriptor],
      recent: [],
      activeId: descriptor.id,
      reopenOnLaunch: true,
    })

    await store.restore(['/alias.json', '/dev'])

    expect(store.openEntries.map((entry) => entry.descriptor.source.locator)).toEqual([
      '/dev',
      '/real/model.json',
    ])
    expect(store.activeId).toBe(workbenchId('/real/model.json'))
  })

  test('reopen disabled retains prior entries as Recent without loading them', async () => {
    const { core } = makeFakeCore({ failingLoads: ['/old.json'] })
    const services = await makeAppServices({ core })
    const descriptor = await services.inspectWorkbench(legacySourceRef('/old.json'))
    const store = new WorkbenchStore(services, {
      open: [descriptor],
      recent: [],
      activeId: descriptor.id,
      reopenOnLaunch: false,
    })

    await store.restore()

    expect(store.openEntries).toEqual([])
    expect(store.recent).toEqual([descriptor])
    expect(store.activeId).toBeNull()
  })

  test('opening two paths and reopening the first keeps stable order and activates the first', async () => {
    const store = await makeStore()

    await store.open('/a.json')
    await store.open('/dev')
    await store.open('/a.json')

    expect(store.openEntries.map((entry) => entry.descriptor.source.locator)).toEqual([
      '/dev',
      '/a.json',
    ])
    expect(store.activeId).toBe(workbenchId('/a.json'))
  })

  test('keeps session-only Workbenches out of persisted open and Recent config', async () => {
    const sessionSource = {
      ...legacySourceRef('/uploaded-workspace'),
      persistence: 'session' as const,
    }
    const { core, store: configStore } = makeFakeCore({ inspectResultSource: sessionSource })
    const releaseWorkbenchSource = vi.fn(async () => undefined)
    const services = { ...(await makeAppServices({ core })), releaseWorkbenchSource }
    const store = new WorkbenchStore(services, defaultUiConfig.workbenches)

    await store.open(sessionSource)

    expect(store.openEntries[0]?.descriptor.source).toEqual(sessionSource)
    await vi.waitFor(() => {
      expect(configStore.config.workbenches.open).toEqual([])
      expect(configStore.config.workbenches.activeId).toBeNull()
    })

    store.close(sourceKey(sessionSource))

    expect(store.recent[0]?.source).toEqual(sessionSource)
    await vi.waitFor(() => expect(configStore.config.workbenches.recent).toEqual([]))

    store.clearRecent()
    await vi.waitFor(() => expect(releaseWorkbenchSource).toHaveBeenCalledWith(sessionSource))

    const restored = new WorkbenchStore(services, configStore.config.workbenches)
    await restored.restore()
    expect(restored.openEntries).toEqual([])
    expect(restored.recent).toEqual([])
    expect(restored.activeId).toBeNull()
  })

  test('releases a session-only source when inspection fails', async () => {
    const sessionSource = {
      ...legacySourceRef('/missing-upload'),
      persistence: 'session' as const,
    }
    const { core } = makeFakeCore({ failingSources: [sessionSource.locator] })
    const releaseWorkbenchSource = vi.fn(async () => undefined)
    const store = new WorkbenchStore(
      { ...(await makeAppServices({ core })), releaseWorkbenchSource },
      defaultUiConfig.workbenches,
    )

    await expect(store.open(sessionSource)).resolves.toBeNull()
    expect(releaseWorkbenchSource).toHaveBeenCalledWith(sessionSource)
  })

  test('releases a durable source removed from Recent history', async () => {
    const source = legacySourceRef('/persistent-workspace')
    const { core } = makeFakeCore()
    const releaseWorkbenchSource = vi.fn(async () => undefined)
    const store = new WorkbenchStore(
      { ...(await makeAppServices({ core })), releaseWorkbenchSource },
      defaultUiConfig.workbenches,
    )

    await store.open(source)
    store.close(sourceKey(source))
    store.clearRecent()

    await vi.waitFor(() => expect(releaseWorkbenchSource).toHaveBeenCalledWith(source))
  })

  test('session-only Recent entries do not evict durable persisted history', async () => {
    const durableRecent = Array.from({ length: 20 }, (_, index) =>
      legacyModelDescriptor(`/recent-${index}.json`),
    )
    const sessionSource = {
      ...legacySourceRef('/uploaded-workspace'),
      persistence: 'session' as const,
    }
    const { core, store: configStore } = makeFakeCore({ inspectResultSource: sessionSource })
    const store = new WorkbenchStore(await makeAppServices({ core }), {
      open: [],
      recent: durableRecent,
      activeId: null,
      reopenOnLaunch: true,
    })

    await store.open(sessionSource)
    store.close(sourceKey(sessionSource))

    expect(store.recent).toHaveLength(21)
    await vi.waitFor(() => {
      expect(configStore.config.workbenches.recent.map(({ id }) => id)).toEqual(
        durableRecent.map(({ id }) => id),
      )
    })
  })

  test('releases session-only sources evicted from Recent history', async () => {
    const { core } = makeFakeCore()
    const baseServices = await makeAppServices({ core })
    const releaseWorkbenchSource = vi.fn(async () => undefined)
    const services = {
      ...baseServices,
      inspectWorkbench: async (source: ReturnType<typeof legacySourceRef>) => ({
        ...legacyModelDescriptor(source.locator),
        id: sourceKey(source),
        source,
      }),
      releaseWorkbenchSource,
    }
    const store = new WorkbenchStore(services, defaultUiConfig.workbenches)
    const sources = Array.from({ length: 21 }, (_, index) => ({
      ...legacySourceRef(`/upload-${index}.json`),
      persistence: 'session' as const,
    }))

    for (const source of sources) {
      await store.open(source)
      store.close(sourceKey(source))
    }

    expect(store.recent).toHaveLength(20)
    await vi.waitFor(() => expect(releaseWorkbenchSource).toHaveBeenCalledWith(sources[0]))
  })

  test('keeps Workbenches with the same locator from different providers', async () => {
    const { core } = makeFakeCore()
    const services = await makeAppServices({ core })
    const browser = {
      providerId: 'browser-local',
      locator: '/shared/model.json',
      displayName: 'Browser model',
    }
    const cli = {
      providerId: 'cli:one',
      locator: '/shared/model.json',
      displayName: 'CLI model',
    }
    const descriptors = {
      browser: {
        id: '/shared/model.json',
        source: browser,
        name: 'Browser model',
        kind: 'model' as const,
        distribution: 'single-file' as const,
        route: 'overview' as const,
        openedAt: '2026-08-29T12:00:00.000Z',
        lastUsedAt: '2026-08-29T12:00:00.000Z',
      },
      cli: {
        id: '/shared/model.json',
        source: cli,
        name: 'CLI model',
        kind: 'model' as const,
        distribution: 'single-file' as const,
        route: 'overview' as const,
        openedAt: '2026-08-29T12:00:00.000Z',
        lastUsedAt: '2026-08-29T12:00:00.000Z',
      },
    }
    const store = new WorkbenchStore(
      {
        ...services,
        inspectWorkbench: async (source) => descriptors[source.locator as 'browser' | 'cli'],
      },
      defaultUiConfig.workbenches,
    )

    await store.open('browser')
    await store.open('cli')

    expect(store.openEntries.map((entry) => entry.descriptor.id)).toEqual([
      sourceKey(cli),
      sourceKey(browser),
    ])
  })

  test('opening an errored Workbench retries its load', async () => {
    const { core } = makeFakeCore()
    const services = await makeAppServices({ core })
    let loadFails = true
    const store = new WorkbenchStore(
      {
        ...services,
        loadModelWorkbench: async (descriptor) => {
          if (loadFails) throw new Error('temporary read failure')
          return services.loadModelWorkbench(descriptor)
        },
      },
      defaultUiConfig.workbenches,
    )

    await store.open('/retry.json')
    expect(store.active?.status).toBe('error')

    loadFails = false
    await store.open('/retry.json')

    expect(store.active?.status).toBe('ready')
  })

  test('picker failures are recorded instead of rejecting the UI event', async () => {
    const { core } = makeFakeCore()
    const services = await makeAppServices({ core })
    const store = new WorkbenchStore(
      {
        ...services,
        pickWorkbenchSource: async () => {
          throw new Error('Folder Workbenches are not available in the browser')
        },
      },
      defaultUiConfig.workbenches,
    )

    await expect(store.openPicked('folder')).resolves.toBeUndefined()
    expect(store.failedRequests).toEqual([
      {
        kind: 'picker',
        key: 'picker:folder',
        source: 'Open folder',
        message: 'Folder Workbenches are not available in the browser',
      },
    ])
  })

  test('keeps route state on each descriptor', async () => {
    const store = await makeStore()
    await store.open('/a.json')
    await store.open('/b.json')

    store.selectRoute(workbenchId('/a.json'), 'explorer')
    store.activate(workbenchId('/b.json'))
    store.activate(workbenchId('/a.json'))

    expect(store.active?.descriptor.route).toBe('explorer')
  })

  test('closing moves a descriptor to Recent and reopening preserves its id', async () => {
    const store = await makeStore()
    await store.open('/a.json')

    store.close(workbenchId('/a.json'))

    expect(store.openEntries).toHaveLength(0)
    expect(store.recent[0]?.id).toBe(workbenchId('/a.json'))

    await store.reopen(workbenchId('/a.json'))

    expect(store.activeId).toBe(workbenchId('/a.json'))
    expect(store.recent).toHaveLength(0)
  })

  test('one failed source request leaves another ready Workbench intact', async () => {
    const store = await makeStore(['/missing'])
    await store.open('/good.json')

    await store.open('/missing')

    expect(
      store.openEntries.find((entry) => entry.descriptor.source.locator === '/good.json')?.status,
    ).toBe('ready')
    expect(store.failedRequests).toEqual([
      {
        kind: 'source',
        key: sourceKey(legacySourceRef('/missing')),
        source: legacySourceRef('/missing'),
        message: 'Workbench source not found: /missing',
      },
    ])
  })

  test('keeps failed requests with the same locator from different providers', async () => {
    const { core } = makeFakeCore()
    const services = await makeAppServices({ core })
    const store = new WorkbenchStore(
      {
        ...services,
        inspectWorkbench: async (source) => {
          throw new WorkbenchError({
            code: 'not-found',
            source,
            message: `Missing from ${source.providerId}`,
          })
        },
      },
      defaultUiConfig.workbenches,
    )
    const browser = {
      providerId: 'browser-local',
      locator: '/shared/model.json',
      displayName: 'Browser model',
    }
    const cli = { ...browser, providerId: 'cli:one', displayName: 'CLI model' }

    await store.open(browser)
    await store.open(cli)

    expect(store.failedRequests).toEqual([
      {
        kind: 'source',
        key: sourceKey(cli),
        source: cli,
        message: 'Missing from cli:one',
      },
      {
        kind: 'source',
        key: sourceKey(browser),
        source: browser,
        message: 'Missing from browser-local',
      },
    ])
  })

  test('a failed restored load remains attached to its descriptor', async () => {
    const descriptor: ModelWorkbenchDescriptor = {
      id: workbenchId('/bad.json'),
      source: { providerId: 'legacy-local', locator: '/bad.json', displayName: 'bad.json' },
      name: 'bad.json',
      kind: 'model',
      distribution: 'single-file',
      route: 'overview',
      openedAt: '2026-08-29T12:00:00.000Z',
      lastUsedAt: '2026-08-29T12:00:00.000Z',
    }
    const { core } = makeFakeCore({ failingLoads: ['/bad.json'] })
    const store = new WorkbenchStore(await makeAppServices({ core }), {
      open: [descriptor],
      recent: [],
      activeId: descriptor.id,
      reopenOnLaunch: true,
    })

    await store.restore()

    expect(store.openEntries[0]).toMatchObject({
      descriptor,
      status: 'error',
      reason: { tag: 'load-failed', message: 'Invalid Morphir distribution: /bad.json' },
    })
  })

  test('an initial permission failure keeps its typed recovery action', async () => {
    const source = legacySourceRef('/dev')
    const { core } = makeFakeCore()
    const base = await makeAppServices({ core })
    const store = new WorkbenchStore(
      {
        ...base,
        loadDevelopmentWorkbench: async (descriptor) => {
          throw new WorkbenchError({
            code: 'permission-denied',
            source: descriptor.source,
            message: 'Directory access was revoked',
          })
        },
      },
      defaultUiConfig.workbenches,
    )

    await store.open(source)

    expect(store.active).toMatchObject({
      status: 'error',
      reason: { tag: 'permission-required', message: 'Directory access was revoked' },
    })
  })

  test('a restored foreign descriptor cannot load through the local provider', async () => {
    const local = legacySourceRef('/good.json')
    const foreign = { providerId: 'cli:session-1', locator: '/good.json', displayName: 'good.json' }
    const descriptor = (source: typeof local): ModelWorkbenchDescriptor => ({
      id: sourceKey(source),
      source,
      name: source.displayName,
      kind: 'model',
      distribution: 'single-file',
      route: 'overview',
      openedAt: '2026-08-29T12:00:00.000Z',
      lastUsedAt: '2026-08-29T12:00:00.000Z',
    })
    const { core } = makeFakeCore()
    const services = await makeAppServices({ core })
    let localLoads = 0
    const store = new WorkbenchStore(
      {
        ...services,
        loadModelWorkbench: async (candidate) => {
          if (candidate.source.providerId !== 'legacy-local') {
            throw new WorkbenchError({
              code: 'unsupported-capability',
              source: candidate.source,
              message: `Workbench source belongs to provider ${candidate.source.providerId}`,
            })
          }
          localLoads += 1
          return services.loadModelWorkbench(candidate)
        },
      },
      {
        open: [descriptor(local), descriptor(foreign)],
        recent: [],
        activeId: sourceKey(foreign),
        reopenOnLaunch: true,
      },
    )

    await store.restore()

    expect(localLoads).toBe(1)
    expect(
      store.openEntries.find((entry) => entry.descriptor.id === sourceKey(local))?.status,
    ).toBe('ready')
    expect(
      store.openEntries.find((entry) => entry.descriptor.id === sourceKey(foreign)),
    ).toMatchObject({
      status: 'error',
      reason: {
        tag: 'load-failed',
        message: 'Workbench source belongs to provider cli:session-1',
      },
    })
  })

  test('search filters open and Recent by name or source', async () => {
    const store = await makeStore()
    await store.open('/models/acme.json')
    await store.open('/knowledge')
    store.close(workbenchId('/knowledge'))

    store.query = 'acme'
    expect(store.filteredOpen.map((entry) => entry.descriptor.source.locator)).toEqual([
      '/models/acme.json',
    ])
    expect(store.filteredRecent).toEqual([])

    store.query = 'knowledge'
    expect(store.filteredOpen).toEqual([])
    expect(store.filteredRecent.map((entry) => entry.source.locator)).toEqual(['/knowledge'])
  })

  test('keeps project and definition navigation independent per Development Workbench', async () => {
    const { core } = makeFakeCore()
    const base = await makeAppServices({ core })
    const services = {
      ...base,
      loadDevelopmentWorkbench: async (
        descriptor: Parameters<typeof base.loadDevelopmentWorkbench>[0],
      ) => {
        const orders = project(descriptor.source, 'packages/orders', 'Orders')
        const pricing = project(descriptor.source, 'packages/pricing', 'Pricing')
        return {
          kind: 'development' as const,
          descriptor,
          snapshot: developmentSnapshot(descriptor.source, [orders, pricing]),
        }
      },
    }
    const store = new WorkbenchStore(services, defaultUiConfig.workbenches)

    const firstId = (await store.open('/dev-a'))!
    const secondId = (await store.open('/dev-b'))!
    const firstSource = legacySourceRef('/dev-a')
    const secondSource = legacySourceRef('/dev-b')
    const firstOrders = projectKey(firstSource, 'packages/orders')
    const firstPricing = projectKey(firstSource, 'packages/pricing')
    const secondOrders = projectKey(secondSource, 'packages/orders')

    await store.selectDevelopmentProject(firstId, firstOrders)
    store.selectDevelopmentDefinition(firstId, firstOrders, 'definition:value:A:B:c')
    await store.selectDevelopmentProject(firstId, firstPricing)
    store.selectDevelopmentDefinition(firstId, firstPricing, 'definition:type:A:B:T')
    await store.selectDevelopmentProject(secondId, secondOrders)

    expect(store.developmentNavigation(firstId)).toMatchObject({
      activeProjectId: firstPricing,
      projects: [
        {
          projectId: firstOrders,
          modelState: {
            tag: 'ready',
            current: { selectedDefinitionId: 'definition:value:A:B:c' },
          },
        },
        {
          projectId: firstPricing,
          modelState: {
            tag: 'ready',
            current: { selectedDefinitionId: 'definition:type:A:B:T' },
          },
        },
      ],
    })
    expect(store.developmentNavigation(secondId)).toMatchObject({
      activeProjectId: secondOrders,
      projects: [
        {
          projectId: secondOrders,
          modelState: { tag: 'ready', current: { selectedDefinitionId: null } },
        },
      ],
    })
  })

  test('exposes loading and error states, retries, and ignores project loads after close', async () => {
    const source = legacySourceRef('/dev')
    const orders = project(source, 'packages/orders', 'Orders')
    const { core } = makeFakeCore({
      development: { snapshot: developmentSnapshot(source, [orders]) },
    })
    const base = await makeAppServices({ core })
    let finishLoad!: () => void
    let attempts = 0
    const store = new WorkbenchStore(
      {
        ...base,
        loadDevelopmentProjectModel: async (descriptor, projectId) => {
          attempts += 1
          if (attempts === 1) throw new Error('morphir-ir.json was not found')
          await new Promise<void>((resolve) => void (finishLoad = resolve))
          return base.loadDevelopmentProjectModel(descriptor, projectId)
        },
      },
      defaultUiConfig.workbenches,
    )

    const id = (await store.open(source))!
    await store.selectDevelopmentProject(id, orders.id)
    expect(store.developmentNavigation(id)).toMatchObject({
      activeProjectId: orders.id,
      projects: [
        {
          projectId: orders.id,
          modelState: {
            tag: 'failed',
            failure: { tag: 'load-failed', message: 'morphir-ir.json was not found' },
          },
        },
      ],
    })

    const retry = store.retryDevelopmentProject(id, orders.id)
    await vi.waitFor(() =>
      expect(store.developmentNavigation(id).projects[0]?.modelState.tag).toBe('loading'),
    )
    store.close(id)
    finishLoad()
    await retry

    expect(store.developmentNavigation(id)).toEqual({ activeProjectId: null, projects: [] })
    expect(store.openEntries).toEqual([])
  })

  test('keeps the newest active project when an earlier project load finishes later', async () => {
    const source = legacySourceRef('/dev')
    const orders = project(source, 'packages/orders', 'Orders')
    const pricing = project(source, 'packages/pricing', 'Pricing')
    const { core } = makeFakeCore({
      development: { snapshot: developmentSnapshot(source, [orders, pricing]) },
    })
    const base = await makeAppServices({ core })
    let finishOrders!: () => void
    const store = new WorkbenchStore(
      {
        ...base,
        loadDevelopmentProjectModel: async (descriptor, projectId) => {
          if (projectId === orders.id) {
            await new Promise<void>((resolve) => void (finishOrders = resolve))
          }
          return base.loadDevelopmentProjectModel(descriptor, projectId)
        },
      },
      defaultUiConfig.workbenches,
    )

    const id = (await store.open(source))!
    const first = store.selectDevelopmentProject(id, orders.id)
    await vi.waitFor(() =>
      expect(store.developmentNavigation(id).projects[0]?.modelState.tag).toBe('loading'),
    )
    await store.selectDevelopmentProject(id, pricing.id)
    finishOrders()
    await first

    expect(store.developmentNavigation(id)).toMatchObject({
      activeProjectId: pricing.id,
      projects: [
        { projectId: orders.id, modelState: { tag: 'ready' } },
        { projectId: pricing.id, modelState: { tag: 'ready' } },
      ],
    })
  })

  test('keeps the last usable model when a project refresh loses browser permission', async () => {
    const source = legacySourceRef('/dev')
    const orders = project(source, 'packages/orders', 'Orders')
    const { core } = makeFakeCore({
      development: { snapshot: developmentSnapshot(source, [orders]) },
    })
    const base = await makeAppServices({ core })
    let permissionDenied = false
    const store = new WorkbenchStore(
      {
        ...base,
        loadDevelopmentProjectModel: async (descriptor, projectId) => {
          if (permissionDenied) {
            throw new WorkbenchError({
              code: 'permission-denied',
              source: descriptor.source,
              message: 'Read permission was revoked',
            })
          }
          return base.loadDevelopmentProjectModel(descriptor, projectId)
        },
      },
      defaultUiConfig.workbenches,
    )

    const id = (await store.open(source))!
    await store.selectDevelopmentProject(id, orders.id)
    const firstState = store.developmentNavigation(id).projects[0]!.modelState
    const firstModel = projectModelForDisplay(firstState)
    expect(firstState.tag).toBe('ready')

    permissionDenied = true
    await store.retryDevelopmentProject(id, orders.id)
    const failed = store.developmentNavigation(id).projects[0]!.modelState

    expect(failed).toMatchObject({
      tag: 'failed',
      failure: { tag: 'permission-required', message: 'Read permission was revoked' },
    })
    expect(projectModelForDisplay(failed)).toBe(firstModel)

    permissionDenied = false
    await store.retryDevelopmentProject(id, orders.id)
    expect(store.developmentNavigation(id).projects[0]?.modelState.tag).toBe('ready')
  })

  test('keeps cached models while provider snapshots move through every project lifecycle state', async () => {
    const source = legacySourceRef('/dev')
    const orders = project(source, 'packages/orders', 'Orders')
    let publish!: (event: WorkspaceEvent) => void
    const events = Stream.async<WorkspaceEvent>((emit) => {
      publish = (event) => emit.single(event)
      return Effect.void
    })
    const { core } = makeFakeCore({
      development: { snapshot: developmentSnapshot(source, [orders]), events },
    })
    const store = new WorkbenchStore(await makeAppServices({ core }), defaultUiConfig.workbenches)

    const id = (await store.open(source))!
    await vi.waitFor(() => expect(publish).toBeTypeOf('function'))
    await store.selectDevelopmentProject(id, orders.id)
    const firstModel = projectModelForDisplay(
      store.developmentNavigation(id).projects[0]!.modelState,
    )

    for (const state of ['loading', 'ready', 'stale', 'error', 'unloaded'] as const) {
      const snapshot = developmentSnapshot(source, [{ ...orders, state }])
      publish({ tag: 'snapshot', snapshot })
      await vi.waitFor(() => {
        const active = store.active
        expect(active?.status).toBe('ready')
        if (active?.status === 'ready' && active.data.kind === 'development') {
          expect(active.data.snapshot.projects[0]?.state).toBe(state)
        }
      })
      expect(projectModelForDisplay(store.developmentNavigation(id).projects[0]!.modelState)).toBe(
        firstModel,
      )
    }
  })

  test('makes a project load retryable when a parent Workbench reload overtakes it', async () => {
    const source = legacySourceRef('/dev')
    const orders = project(source, 'packages/orders', 'Orders')
    const { core } = makeFakeCore({
      development: { snapshot: developmentSnapshot(source, [orders]) },
    })
    const base = await makeAppServices({ core })
    let finishProject!: () => void
    let finishParentReload!: () => void
    let parentLoads = 0
    let projectLoads = 0
    const store = new WorkbenchStore(
      {
        ...base,
        loadDevelopmentWorkbench: async (descriptor) => {
          parentLoads += 1
          if (parentLoads > 1) {
            await new Promise<void>((resolve) => void (finishParentReload = resolve))
          }
          return base.loadDevelopmentWorkbench(descriptor)
        },
        loadDevelopmentProjectModel: async (descriptor, projectId) => {
          projectLoads += 1
          if (projectLoads === 1) {
            await new Promise<void>((resolve) => void (finishProject = resolve))
          }
          return base.loadDevelopmentProjectModel(descriptor, projectId)
        },
      },
      defaultUiConfig.workbenches,
    )

    const id = (await store.open(source))!
    const projectLoad = store.selectDevelopmentProject(id, orders.id)
    await vi.waitFor(() =>
      expect(store.developmentNavigation(id).projects[0]?.modelState.tag).toBe('loading'),
    )
    const parentReload = store.retry(id)
    await vi.waitFor(() => expect(store.active?.status).toBe('loading'))
    finishProject()
    await projectLoad

    expect(store.developmentNavigation(id).projects[0]?.modelState.tag).toBe('failed')

    finishParentReload()
    await parentReload
    await store.retryDevelopmentProject(id, orders.id)

    expect(projectLoads).toBe(2)
    expect(store.developmentNavigation(id).projects[0]?.modelState.tag).toBe('ready')
  })

  test('ignores a project ID that is absent from the current Development snapshot', async () => {
    const source = legacySourceRef('/dev')
    const { core } = makeFakeCore({
      development: { snapshot: developmentSnapshot(source, []) },
    })
    const base = await makeAppServices({ core })
    const loadDevelopmentProjectModel = vi.fn(base.loadDevelopmentProjectModel)
    const store = new WorkbenchStore(
      { ...base, loadDevelopmentProjectModel },
      defaultUiConfig.workbenches,
    )

    const id = (await store.open(source))!
    await store.selectDevelopmentProject(id, 'unknown-project')

    expect(store.developmentNavigation(id)).toEqual({ activeProjectId: null, projects: [] })
    expect(loadDevelopmentProjectModel).not.toHaveBeenCalled()
  })

  test('applies watched snapshots to an open Development Workbench', async () => {
    const source = legacySourceRef('/dev')
    const snapshot: WorkspaceSnapshot = {
      id: sourceKey(source),
      root: source,
      name: 'Updated workspace',
      configAnchor: '/dev/morphir.json',
      state: 'open',
      projects: [],
      modelSources: [],
      knowledgeBaseSources: [],
      diagnostics: [
        {
          severity: 'warning',
          code: 'workspace.changed',
          message: 'Workspace files changed',
          path: '/dev/morphir.json',
          projectId: null,
        },
      ],
    }
    const { core } = makeFakeCore({
      development: { events: Stream.make({ tag: 'snapshot' as const, snapshot }) },
    })
    const store = new WorkbenchStore(await makeAppServices({ core }), defaultUiConfig.workbenches)

    await store.open(source)

    await vi.waitFor(() => {
      expect(store.active).toMatchObject({ status: 'ready', data: { snapshot } })
    })
  })

  test('marks an open Development Workbench when its provider disconnects', async () => {
    const source = legacySourceRef('/dev')
    const { core } = makeFakeCore({
      development: {
        events: Stream.make({
          tag: 'provider-disconnected' as const,
          providerId: source.providerId,
          message: 'CLI connection closed',
        }),
      },
    })
    const store = new WorkbenchStore(await makeAppServices({ core }), defaultUiConfig.workbenches)

    await store.open(source)

    await vi.waitFor(() => {
      expect(store.active).toMatchObject({
        status: 'unavailable',
        reason: { tag: 'provider-disconnected', message: 'CLI connection closed' },
        data: { kind: 'development' },
      })
    })
  })

  test('applies a restored watch snapshot after its provider reconnects', async () => {
    const source = legacySourceRef('/dev')
    const snapshot: WorkspaceSnapshot = {
      id: sourceKey(source),
      root: source,
      name: 'Reconnected workspace',
      configAnchor: '/dev/morphir.json',
      state: 'open',
      projects: [],
      modelSources: [],
      knowledgeBaseSources: [],
      diagnostics: [],
    }
    const { core } = makeFakeCore({
      development: {
        events: Stream.make(
          {
            tag: 'provider-disconnected' as const,
            providerId: source.providerId,
            message: 'CLI connection closed',
          },
          { tag: 'snapshot' as const, snapshot },
        ),
      },
    })
    const store = new WorkbenchStore(await makeAppServices({ core }), defaultUiConfig.workbenches)

    await store.open(source)

    await vi.waitFor(() => {
      expect(store.active).toMatchObject({ status: 'ready', data: { snapshot } })
    })
  })

  test('reconnects without discarding the selected project model or definition', async () => {
    const source = legacySourceRef('/dev')
    const orders = project(source, 'packages/orders', 'Orders')
    const snapshot = developmentSnapshot(source, [orders])
    let publish!: (event: WorkspaceEvent) => void
    const events = Stream.async<WorkspaceEvent>((emit) => {
      publish = (event) => emit.single(event)
      return Effect.void
    })
    const { core } = makeFakeCore({ development: { snapshot, events } })
    const store = new WorkbenchStore(await makeAppServices({ core }), defaultUiConfig.workbenches)

    const id = (await store.open(source))!
    await vi.waitFor(() => expect(publish).toBeTypeOf('function'))
    await store.selectDevelopmentProject(id, orders.id)
    store.selectDevelopmentDefinition(id, orders.id, 'definition:orders')
    const firstModel = projectModelForDisplay(
      store.developmentNavigation(id).projects[0]!.modelState,
    )

    publish({
      tag: 'provider-disconnected',
      providerId: source.providerId,
      message: 'CLI connection closed',
    })
    await vi.waitFor(() => expect(store.active?.status).toBe('unavailable'))

    expect(projectModelForDisplay(store.developmentNavigation(id).projects[0]!.modelState)).toBe(
      firstModel,
    )

    publish({ tag: 'snapshot', snapshot })
    await vi.waitFor(() => expect(store.active?.status).toBe('ready'))
    expect(store.developmentNavigation(id)).toMatchObject({
      activeProjectId: orders.id,
      projects: [
        {
          projectId: orders.id,
          modelState: {
            tag: 'ready',
            current: { selectedDefinitionId: 'definition:orders' },
          },
        },
      ],
    })
  })

  test('switches among cached projects while their provider is disconnected', async () => {
    const source = legacySourceRef('/dev')
    const orders = project(source, 'packages/orders', 'Orders')
    const pricing = project(source, 'packages/pricing', 'Pricing')
    let publish!: (event: WorkspaceEvent) => void
    const events = Stream.async<WorkspaceEvent>((emit) => {
      publish = (event) => emit.single(event)
      return Effect.void
    })
    const { core } = makeFakeCore({
      development: { snapshot: developmentSnapshot(source, [orders, pricing]), events },
    })
    const services = await makeAppServices({ core })
    const loadDevelopmentProjectModel = vi.spyOn(services, 'loadDevelopmentProjectModel')
    const store = new WorkbenchStore(services, defaultUiConfig.workbenches)

    const id = (await store.open(source))!
    await vi.waitFor(() => expect(publish).toBeTypeOf('function'))
    await store.selectDevelopmentProject(id, orders.id)
    await store.selectDevelopmentProject(id, pricing.id)
    publish({
      tag: 'provider-disconnected',
      providerId: source.providerId,
      message: 'CLI connection closed',
    })
    await vi.waitFor(() => expect(store.active?.status).toBe('unavailable'))
    const callsBeforeOfflineSelection = loadDevelopmentProjectModel.mock.calls.length

    await store.selectDevelopmentProject(id, orders.id)

    expect(loadDevelopmentProjectModel).toHaveBeenCalledTimes(callsBeforeOfflineSelection)
    expect(store.developmentNavigation(id).activeProjectId).toBe(orders.id)
    expect(
      projectModelForDisplay(
        store.developmentNavigation(id).projects.find((entry) => entry.projectId === orders.id)!
          .modelState,
      ),
    ).not.toBeNull()
  })

  test('reconciles removed projects when reconnect succeeds through a Workbench reload', async () => {
    const source = legacySourceRef('/dev')
    const orders = project(source, 'packages/orders', 'Orders')
    const pricing = project(source, 'packages/pricing', 'Pricing')
    const initial = developmentSnapshot(source, [orders, pricing])
    const recovered = developmentSnapshot(source, [orders])
    let publish!: (event: WorkspaceEvent) => void
    const events = Stream.async<WorkspaceEvent>((emit) => {
      publish = (event) => emit.single(event)
      return Effect.void
    })
    const { core } = makeFakeCore({ development: { snapshot: initial, events } })
    const base = await makeAppServices({ core })
    let reconnecting = false
    const store = new WorkbenchStore(
      {
        ...base,
        loadDevelopmentWorkbench: async (descriptor) => ({
          kind: 'development',
          descriptor,
          snapshot: reconnecting ? recovered : initial,
        }),
      },
      defaultUiConfig.workbenches,
    )

    const id = (await store.open(source))!
    await vi.waitFor(() => expect(publish).toBeTypeOf('function'))
    await store.selectDevelopmentProject(id, pricing.id)
    publish({
      tag: 'provider-disconnected',
      providerId: source.providerId,
      message: 'CLI connection closed',
    })
    await vi.waitFor(() => expect(store.active?.status).toBe('unavailable'))
    reconnecting = true

    await store.retry(id)

    expect(store.active?.status).toBe('ready')
    expect(store.developmentNavigation(id)).toEqual({ activeProjectId: null, projects: [] })
  })

  test('ignores a superseded workspace watch after a reload starts', async () => {
    const source = legacySourceRef('/dev')
    const orders = project(source, 'packages/orders', 'Orders')
    const snapshot = developmentSnapshot(source, [orders])
    let publishOld!: (event: WorkspaceEvent) => void
    const oldEvents = Stream.async<WorkspaceEvent>((emit) => {
      publishOld = (event) => emit.single(event)
      return Effect.void
    })
    const { core } = makeFakeCore({ development: { snapshot } })
    const base = await makeAppServices({ core })
    let loads = 0
    let finishReload!: () => void
    const store = new WorkbenchStore(
      {
        ...base,
        loadDevelopmentWorkbench: async (descriptor) => {
          loads += 1
          if (loads > 1) await new Promise<void>((resolve) => void (finishReload = resolve))
          return { kind: 'development', descriptor, snapshot }
        },
        workspaceEvents: () => (loads === 1 ? oldEvents : Stream.never),
      },
      defaultUiConfig.workbenches,
    )

    const id = (await store.open(source))!
    await vi.waitFor(() => expect(publishOld).toBeTypeOf('function'))

    const reload = store.retry(id)
    expect(store.active?.status).toBe('loading')
    publishOld({
      tag: 'provider-disconnected',
      providerId: source.providerId,
      message: 'late disconnect from old watch',
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(store.active?.status).toBe('loading')
    finishReload()
    await reload
    expect(store.active?.status).toBe('ready')
  })

  test('prunes project navigation when a disconnected workspace recovers', async () => {
    const source = legacySourceRef('/dev')
    const orders = project(source, 'packages/orders', 'Orders')
    const initial = developmentSnapshot(source, [orders])
    const recovered = developmentSnapshot(source, [])
    let emitDisconnect!: () => void
    let emitRecovery!: () => void
    const nextEvent = (register: (emit: () => void) => void, event: WorkspaceEvent) =>
      Stream.fromEffect(
        Effect.promise(
          () => new Promise<WorkspaceEvent>((resolve) => register(() => resolve(event))),
        ),
      )
    const events = Stream.concat(
      nextEvent((emit) => void (emitDisconnect = emit), {
        tag: 'provider-disconnected',
        providerId: source.providerId,
        message: 'CLI connection closed',
      }),
      nextEvent((emit) => void (emitRecovery = emit), { tag: 'snapshot', snapshot: recovered }),
    )
    const { core } = makeFakeCore({ development: { snapshot: initial, events } })
    const store = new WorkbenchStore(await makeAppServices({ core }), defaultUiConfig.workbenches)

    const id = (await store.open(source))!
    await vi.waitFor(() => expect(emitDisconnect).toBeTypeOf('function'))
    await store.selectDevelopmentProject(id, orders.id)
    expect(store.developmentNavigation(id).activeProjectId).toBe(orders.id)

    emitDisconnect()
    await vi.waitFor(() => expect(store.active?.status).toBe('unavailable'))
    await vi.waitFor(() => expect(emitRecovery).toBeTypeOf('function'))
    emitRecovery()

    await vi.waitFor(() => expect(store.active?.status).toBe('ready'))
    expect(store.developmentNavigation(id)).toEqual({ activeProjectId: null, projects: [] })
  })

  test('stops watching a Development Workbench when it closes or the store disposes', async () => {
    let subscriptions = 0
    let finalizations = 0
    const events = Stream.never.pipe(
      Stream.tap(() => Effect.void),
      Stream.ensuring(Effect.sync(() => void (finalizations += 1))),
    )
    const { core } = makeFakeCore({
      development: {
        events,
        onEvents: () => void (subscriptions += 1),
      },
    })
    const store = new WorkbenchStore(await makeAppServices({ core }), defaultUiConfig.workbenches)

    await store.open('/dev')
    await vi.waitFor(() => expect(subscriptions).toBe(1))
    store.close(workbenchId('/dev'))
    await vi.waitFor(() => expect(finalizations).toBe(1))

    await store.reopen(workbenchId('/dev'))
    await vi.waitFor(() => expect(subscriptions).toBe(2))
    store.dispose()
    await vi.waitFor(() => expect(finalizations).toBe(2))
  })

  test('does not start a workspace watch when a Workbench closes during loading', async () => {
    const { core } = makeFakeCore()
    const services = await makeAppServices({ core })
    let finishLoad!: () => void
    const loadMayFinish = new Promise<void>((resolve) => void (finishLoad = resolve))
    const workspaceEvents = vi.fn(services.workspaceEvents)
    const store = new WorkbenchStore(
      {
        ...services,
        loadDevelopmentWorkbench: async (descriptor) => {
          await loadMayFinish
          return services.loadDevelopmentWorkbench(descriptor)
        },
        workspaceEvents,
      },
      defaultUiConfig.workbenches,
    )

    const opening = store.open('/dev')
    await vi.waitFor(() => expect(store.active?.status).toBe('loading'))
    store.close(workbenchId('/dev'))
    finishLoad()
    await opening

    expect(store.openEntries).toEqual([])
    expect(workspaceEvents).not.toHaveBeenCalled()
  })
})
