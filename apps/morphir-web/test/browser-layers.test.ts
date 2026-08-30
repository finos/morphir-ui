import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { Effect, Stream } from 'effect'
import {
  WorkbenchSourceService,
  DevelopmentWorkbenchService,
  defaultUiConfig,
  makeAppServices,
  type DevelopmentWorkbenchDescriptor,
} from '@morphir/ui'
import { sourceKey } from '@morphir/workspace'
import { browserCore } from '../src/layers/browser-layers.ts'

const COUNTER_KEY = 'morphir-ui.browser-local.model-source-counter.v1'
const LOCK_NAME = `${COUNTER_KEY}.lock`

const installSerialLocks = (afterRelease: () => void = () => undefined): string[] => {
  let queue: Promise<void> = Promise.resolve()
  const requestedNames: string[] = []
  vi.stubGlobal('navigator', {
    locks: {
      request: <T>(name: string, callback: () => T | PromiseLike<T>): Promise<T> => {
        requestedNames.push(name)
        const result = queue.then(callback)
        queue = result.then(afterRelease, afterRelease)
        return result
      },
    },
  })
  return requestedNames
}

describe('browserCore', () => {
  beforeEach(() => {
    localStorage.clear()
    installSerialLocks()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  test('config defaults when localStorage is empty', async () => {
    const services = await makeAppServices({ core: browserCore('1.0.0') })
    expect(await services.loadConfig()).toEqual(defaultUiConfig)
    expect(await services.version()).toBe('1.0.0')
  })

  test('config round-trips through localStorage', async () => {
    const services = await makeAppServices({ core: browserCore('1.0.0') })
    const cfg = { ...defaultUiConfig, github: { source: 'gh-cli' as const } }
    await services.saveConfig(cfg)
    expect(JSON.parse(localStorage.getItem('morphir-ui.config')!)).toEqual(cfg)
    expect(await services.loadConfig()).toEqual(cfg)
  })

  test('corrupt localStorage falls back to defaults', async () => {
    localStorage.setItem('morphir-ui.config', '{not json')
    const services = await makeAppServices({ core: browserCore('1.0.0') })
    expect(await services.loadConfig()).toEqual(defaultUiConfig)
  })

  test('web capabilities: no github, no reopen', async () => {
    const core = browserCore('1.0.0')
    const services = await makeAppServices({ core })
    expect(services.capabilities).toEqual({ github: false, reopenWorkspaces: false })
    expect(services.github).toBeNull()
    expect(services.readWorkspace).toBeNull()
    expect(await services.listWorkbenchProviders()).toEqual([
      {
        id: 'browser-local',
        name: 'This browser',
        kind: 'local',
        status: 'available',
        capabilities: [{ name: 'morphir/model/open', version: '1' }],
      },
    ])
    await expect(services.pickWorkbenchSource('folder')).rejects.toThrow(
      'Folder Workbenches are not available in the browser',
    )
    const folderError = await Effect.runPromise(
      Effect.flip(
        Effect.flatMap(WorkbenchSourceService, (service) => service.pick('folder')).pipe(
          Effect.provide(core),
        ),
      ),
    )
    expect(folderError.code).toBe('unsupported-capability')
  })

  test('keeps separate browser selections that share a file name', async () => {
    localStorage.setItem(COUNTER_KEY, 'not-a-counter')
    const selectedFiles = [
      new File(
        ['{"formatVersion":3,"distribution":["Library",[],[],{"modules":[]}]}'],
        'model.json',
      ),
      new File(
        ['{"formatVersion":3,"distribution":["Library",[],[],{"modules":[]}]}'],
        'model.json',
      ),
    ]
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (
      this: HTMLInputElement,
    ) {
      Object.defineProperty(this, 'files', {
        configurable: true,
        value: [selectedFiles.shift()],
      })
      this.onchange?.(new Event('change'))
    })
    const services = await makeAppServices({ core: browserCore('1.0.0') })

    const first = await services.pickWorkbenchSource('model-file')
    const second = await services.pickWorkbenchSource('model-file')

    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(first).toMatchObject({ locator: 'model:1', displayName: 'model.json' })
    expect(second).toMatchObject({ locator: 'model:2', displayName: 'model.json (2)' })
    expect(sourceKey(first!)).not.toBe(sourceKey(second!))
    const firstDescriptor = await services.inspectWorkbench(first!)
    const secondDescriptor = await services.inspectWorkbench(second!)
    expect(firstDescriptor).toMatchObject({
      id: sourceKey(first!),
      source: first,
      name: 'model.json',
    })
    expect(secondDescriptor).toMatchObject({
      id: sourceKey(second!),
      source: second,
      name: 'model.json (2)',
    })
    expect(first!.locator).not.toContain('model.json')
    expect(second!.locator).not.toContain('model.json')
  })

  test('allocates distinct locators across independent browser runtimes', async () => {
    const selectedFiles = [
      new File(['{}'], 'first.json'),
      new File(['{}'], 'second.json'),
    ]
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (
      this: HTMLInputElement,
    ) {
      Object.defineProperty(this, 'files', {
        configurable: true,
        value: [selectedFiles.shift()],
      })
      this.onchange?.(new Event('change'))
    })
    const firstRuntime = await makeAppServices({ core: browserCore('1.0.0') })
    const secondRuntime = await makeAppServices({ core: browserCore('1.0.0') })

    const first = await firstRuntime.pickWorkbenchSource('model-file')
    const second = await secondRuntime.pickWorkbenchSource('model-file')

    expect(first?.locator).toBe('model:1')
    expect(second?.locator).toBe('model:2')
  })

  test('seeds locator allocation above persisted browser Workbenches', async () => {
    localStorage.setItem(COUNTER_KEY, '12')
    const persistedSource = {
      providerId: 'browser-local',
      locator: 'model:41',
      displayName: 'persisted.json',
    }
    localStorage.setItem(
      'morphir-ui.config',
      JSON.stringify({
        ...defaultUiConfig,
        workbenches: {
          ...defaultUiConfig.workbenches,
          open: [
            {
              id: sourceKey(persistedSource),
              source: persistedSource,
              name: 'persisted.json',
              kind: 'model',
              distribution: 'single-file',
              route: 'overview',
              openedAt: '2026-08-29T12:00:00.000Z',
              lastUsedAt: '2026-08-29T12:00:00.000Z',
            },
          ],
        },
      }),
    )
    const selectedFile = new File(['{}'], 'new.json')
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (
      this: HTMLInputElement,
    ) {
      Object.defineProperty(this, 'files', { configurable: true, value: [selectedFile] })
      this.onchange?.(new Event('change'))
    })
    const services = await makeAppServices({ core: browserCore('1.0.0') })

    const selected = await services.pickWorkbenchSource('model-file')

    expect(selected?.locator).toBe('model:42')
  })

  test('serializes racing allocations across browser runtimes', async () => {
    let visibleCounter: string | null = null
    let pendingCounter: string | null = null
    const originalGetItem = Storage.prototype.getItem
    const originalSetItem = Storage.prototype.setItem
    const requestedLocks = installSerialLocks(() => {
      if (pendingCounter !== null) {
        visibleCounter = pendingCounter
        pendingCounter = null
      }
    })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (
      this: Storage,
      key: string,
    ) {
      return key === COUNTER_KEY ? visibleCounter : originalGetItem.call(this, key)
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === COUNTER_KEY) pendingCounter = value
      else originalSetItem.call(this, key, value)
    })
    const selectedFiles = [
      new File(['{}'], 'first.json'),
      new File(['{}'], 'second.json'),
    ]
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (
      this: HTMLInputElement,
    ) {
      Object.defineProperty(this, 'files', {
        configurable: true,
        value: [selectedFiles.shift()],
      })
      this.onchange?.(new Event('change'))
    })
    const firstRuntime = await makeAppServices({ core: browserCore('1.0.0') })
    const secondRuntime = await makeAppServices({ core: browserCore('1.0.0') })

    const [first, second] = await Promise.all([
      firstRuntime.pickWorkbenchSource('model-file'),
      secondRuntime.pickWorkbenchSource('model-file'),
    ])

    expect(new Set([first?.locator, second?.locator])).toEqual(
      new Set(['model:1', 'model:2']),
    )
    expect(requestedLocks).toEqual([LOCK_NAME, LOCK_NAME])
  })

  test('uses cryptographically random opaque locators when Web Locks are unavailable', async () => {
    vi.stubGlobal('navigator', {})
    const randomValues = vi.spyOn(globalThis.crypto, 'getRandomValues')
    const selectedFiles = [
      new File(['{}'], 'first.json'),
      new File(['{}'], 'second.json'),
    ]
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (
      this: HTMLInputElement,
    ) {
      Object.defineProperty(this, 'files', {
        configurable: true,
        value: [selectedFiles.shift()],
      })
      this.onchange?.(new Event('change'))
    })
    const firstRuntime = await makeAppServices({ core: browserCore('1.0.0') })
    const secondRuntime = await makeAppServices({ core: browserCore('1.0.0') })

    const first = await firstRuntime.pickWorkbenchSource('model-file')
    const second = await secondRuntime.pickWorkbenchSource('model-file')

    expect(randomValues).toHaveBeenCalledTimes(2)
    expect(first?.locator).toMatch(/^model:\d+$/)
    expect(second?.locator).toMatch(/^model:\d+$/)
    expect(first?.locator).not.toBe(second?.locator)
  })

  test('falls back to distinct opaque locators when counter storage is unavailable', async () => {
    const selectedFiles = [
      new File(['{}'], 'first.json'),
      new File(['{}'], 'second.json'),
    ]
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage unavailable')
    })
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (
      this: HTMLInputElement,
    ) {
      Object.defineProperty(this, 'files', {
        configurable: true,
        value: [selectedFiles.shift()],
      })
      this.onchange?.(new Event('change'))
    })
    const firstRuntime = await makeAppServices({ core: browserCore('1.0.0') })
    const secondRuntime = await makeAppServices({ core: browserCore('1.0.0') })

    const first = await firstRuntime.pickWorkbenchSource('model-file')
    const second = await secondRuntime.pickWorkbenchSource('model-file')

    expect(first?.locator).toMatch(/^model:\d+$/)
    expect(second?.locator).toMatch(/^model:\d+$/)
    expect(first?.locator).not.toBe(second?.locator)
    expect(first?.locator).not.toContain('first.json')
    expect(second?.locator).not.toContain('second.json')
  })

  test('does not reinterpret a source owned by another provider', async () => {
    const services = await makeAppServices({ core: browserCore('1.0.0') })

    await expect(
      services.inspectWorkbench({
        providerId: 'cli:session-1',
        locator: 'browser-model:1:model.json',
        displayName: 'model.json',
      }),
    ).rejects.toThrow('Workbench source belongs to provider cli:session-1')
  })

  test('rejects restored model and development descriptors owned by another provider', async () => {
    const selectedFile = new File(
      ['{"formatVersion":3,"distribution":["Library",[],[],{"modules":[]}]}'],
      'model.json',
    )
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (
      this: HTMLInputElement,
    ) {
      Object.defineProperty(this, 'files', { configurable: true, value: [selectedFile] })
      this.onchange?.(new Event('change'))
    })
    const services = await makeAppServices({ core: browserCore('1.0.0') })
    const browserSource = (await services.pickWorkbenchSource('model-file'))!
    const browserDescriptor = await services.inspectWorkbench(browserSource)
    if (browserDescriptor.kind !== 'model') throw new Error('Expected model descriptor')
    const foreignSource = { ...browserSource, providerId: 'cli:session-1' }
    const foreignModel = {
      ...browserDescriptor,
      id: sourceKey(foreignSource),
      source: foreignSource,
    }

    await expect(services.loadModelWorkbench(foreignModel)).rejects.toThrow(
      'Workbench source belongs to provider cli:session-1',
    )

    const foreignDevelopment: DevelopmentWorkbenchDescriptor = {
      id: sourceKey(foreignSource),
      source: foreignSource,
      name: 'workspace',
      kind: 'development',
      route: 'overview',
      openedAt: '2026-08-29T12:00:00.000Z',
      lastUsedAt: '2026-08-29T12:00:00.000Z',
    }
    await expect(services.loadDevelopmentWorkbench(foreignDevelopment)).rejects.toThrow(
      'Workbench source belongs to provider cli:session-1',
    )
    await expect(
      services.loadDevelopmentProjectModel(foreignDevelopment, 'orders'),
    ).rejects.toThrow('Workbench source belongs to provider cli:session-1')
    await expect(
      Effect.runPromise(Stream.runCollect(services.workspaceEvents(foreignDevelopment))),
    ).rejects.toThrow('Workbench source belongs to provider cli:session-1')
  })

  test('reports typed failures for its unsupported Development capabilities', async () => {
    const source = {
      providerId: 'browser-local',
      locator: 'directory:workspace',
      displayName: 'workspace',
    }
    const descriptor: DevelopmentWorkbenchDescriptor = {
      id: sourceKey(source),
      source,
      name: 'workspace',
      kind: 'development',
      route: 'overview',
      openedAt: '2026-08-29T12:00:00.000Z',
      lastUsedAt: '2026-08-29T12:00:00.000Z',
    }
    const core = browserCore('1.0.0')
    const loadError = await Effect.runPromise(
      Effect.flip(
        Effect.flatMap(DevelopmentWorkbenchService, (service) => service.load(descriptor)).pipe(
          Effect.provide(core),
        ),
      ),
    )
    const projectError = await Effect.runPromise(
      Effect.flip(
        Effect.flatMap(DevelopmentWorkbenchService, (service) =>
          service.loadProjectModel(descriptor, 'orders'),
        ).pipe(Effect.provide(core)),
      ),
    )
    const eventError = await Effect.runPromise(
      Effect.flip(
        Effect.flatMap(DevelopmentWorkbenchService, (service) =>
          Stream.runCollect(service.events(descriptor)),
        ).pipe(Effect.provide(core)),
      ),
    )

    expect(loadError.code).toBe('unsupported-capability')
    expect(projectError.code).toBe('unsupported-capability')
    expect(eventError.code).toBe('unsupported-capability')
  })
})
