import { describe, expect, test } from 'vitest'
import { sourceKey } from '@morphir/workspace'
import {
  WorkbenchStore,
  WorkbenchError,
  defaultUiConfig,
  legacySourceRef,
  makeAppServices,
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
      message: 'Invalid Morphir distribution: /bad.json',
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
      message: 'Workbench source belongs to provider cli:session-1',
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
})
