import { describe, expect, test } from 'vitest'
import {
  WorkbenchStore,
  defaultUiConfig,
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

describe('WorkbenchStore', () => {
  test('restoration deduplicates canonical command-line sources and activates the first', async () => {
    const { core } = makeFakeCore({ canonicalSources: { '/alias.json': '/real/model.json' } })
    const services = await makeAppServices({ core })
    const descriptor = await services.inspectWorkbench('/real/model.json')
    const store = new WorkbenchStore(services, {
      open: [descriptor],
      recent: [],
      activeId: descriptor.id,
      reopenOnLaunch: true,
    })

    await store.restore(['/alias.json', '/dev'])

    expect(store.openEntries.map((entry) => entry.descriptor.source)).toEqual([
      '/dev',
      '/real/model.json',
    ])
    expect(store.activeId).toBe('/real/model.json')
  })

  test('reopen disabled retains prior entries as Recent without loading them', async () => {
    const { core } = makeFakeCore({ failingLoads: ['/old.json'] })
    const services = await makeAppServices({ core })
    const descriptor = await services.inspectWorkbench('/old.json')
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

    expect(store.openEntries.map((entry) => entry.descriptor.source)).toEqual(['/dev', '/a.json'])
    expect(store.activeId).toBe('/a.json')
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
        source: 'Open folder',
        message: 'Folder Workbenches are not available in the browser',
      },
    ])
  })

  test('keeps route state on each descriptor', async () => {
    const store = await makeStore()
    await store.open('/a.json')
    await store.open('/b.json')

    store.selectRoute('/a.json', 'explorer')
    store.activate('/b.json')
    store.activate('/a.json')

    expect(store.active?.descriptor.route).toBe('explorer')
  })

  test('closing moves a descriptor to Recent and reopening preserves its id', async () => {
    const store = await makeStore()
    await store.open('/a.json')

    store.close('/a.json')

    expect(store.openEntries).toHaveLength(0)
    expect(store.recent[0]?.id).toBe('/a.json')

    await store.reopen('/a.json')

    expect(store.activeId).toBe('/a.json')
    expect(store.recent).toHaveLength(0)
  })

  test('one failed source request leaves another ready Workbench intact', async () => {
    const store = await makeStore(['/missing'])
    await store.open('/good.json')

    await store.open('/missing')

    expect(
      store.openEntries.find((entry) => entry.descriptor.source === '/good.json')?.status,
    ).toBe('ready')
    expect(store.failedRequests).toEqual([
      { source: '/missing', message: 'Workbench source not found: /missing' },
    ])
  })

  test('a failed restored load remains attached to its descriptor', async () => {
    const descriptor: ModelWorkbenchDescriptor = {
      id: '/bad.json',
      source: '/bad.json',
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

  test('search filters open and Recent by name or source', async () => {
    const store = await makeStore()
    await store.open('/models/acme.json')
    await store.open('/knowledge')
    store.close('/knowledge')

    store.query = 'acme'
    expect(store.filteredOpen.map((entry) => entry.descriptor.source)).toEqual([
      '/models/acme.json',
    ])
    expect(store.filteredRecent).toEqual([])

    store.query = 'knowledge'
    expect(store.filteredOpen).toEqual([])
    expect(store.filteredRecent.map((entry) => entry.source)).toEqual(['/knowledge'])
  })
})
