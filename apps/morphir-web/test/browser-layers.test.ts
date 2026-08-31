import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { Effect, Stream } from 'effect'
import {
  DevelopmentWorkbenchService,
  WorkbenchSourceService,
  defaultUiConfig,
  makeAppServices,
  type DevelopmentWorkbenchDescriptor,
} from '@morphir/ui'
import { projectKey, sourceKey, type DiscoveryRequest } from '@morphir/workspace'
import {
  browserCore,
  browserCoreWith,
  makeLazyWorkspaceEngine,
  type BrowserWorkspaceDependencies,
} from '../src/layers/browser-layers.ts'
import type { DirectoryPermissionHandle } from '../src/workspace/browser-directory.ts'
import { pickBrowserDirectory } from '../src/workspace/browser-provider.ts'

const COUNTER_KEY = 'morphir-ui.browser-local.model-source-counter.v1'
const LOCK_NAME = `${COUNTER_KEY}.lock`
const directoryLocator = (suffix: number): string =>
  `directory:${'00000000'.repeat(3)}${suffix.toString(16).padStart(8, '0')}`

const installDirectoryIds = (...suffixes: ReadonlyArray<number>) => {
  const remaining = [...suffixes]
  const getRandomValues = vi.fn((values: Uint32Array) => {
    values.fill(0)
    values[3] = remaining.shift() ?? suffixes.at(-1) ?? 0
    return values
  })
  vi.stubGlobal('crypto', { getRandomValues })
  return getRandomValues
}

const emptyDiscoveryRequest: DiscoveryRequest = {
  protocolVersion: 1,
  developmentRoot: { entries: { '.': { kind: 'directory' } } },
  morphirHome: null,
  systemConfig: null,
  environment: {},
  cliOverlay: {},
}

const emptyDiscoveryResponse = {
  status: 'success' as const,
  snapshot: {
    protocolVersion: 1 as const,
    configAnchor: 'morphir.toml',
    name: null,
    state: 'open' as const,
    projects: [],
    diagnostics: [],
  },
}

const directoryHandle = (
  name: string,
  entries: Readonly<Record<string, string>>,
): DirectoryPermissionHandle => ({
  kind: 'directory',
  name,
  queryPermission: vi.fn(async (): Promise<PermissionState> => 'granted'),
  requestPermission: vi.fn(async (): Promise<PermissionState> => 'granted'),
  entries: () =>
    (async function* () {
      for (const [entryName, text] of Object.entries(entries)) {
        yield [
          entryName,
          {
            kind: 'file' as const,
            name: entryName,
            getFile: async () =>
              ({ size: new TextEncoder().encode(text).byteLength, text: async () => text }) as File,
          },
        ] as const
      }
    })(),
})

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

  test('treats File System Access picker cancellation as no selected directory', async () => {
    const picker = vi.fn(async () => {
      throw new DOMException('cancelled', 'AbortError')
    })
    vi.stubGlobal('showDirectoryPicker', picker)

    await expect(pickBrowserDirectory()).resolves.toBeNull()
    expect(picker).toHaveBeenCalledWith({ mode: 'read' })
  })

  test('retries lazy workspace engine initialization after one failed attempt', async () => {
    const engine = { discover: vi.fn(async () => emptyDiscoveryResponse) }
    const initialize = vi
      .fn<() => Promise<typeof engine>>()
      .mockRejectedValueOnce(new Error('first load failed'))
      .mockResolvedValue(engine)
    const lazy = makeLazyWorkspaceEngine(initialize)

    const failed = await Promise.allSettled([
      lazy.discover(emptyDiscoveryRequest),
      lazy.discover(emptyDiscoveryRequest),
    ])
    expect(failed).toMatchObject([
      { status: 'rejected', reason: { message: 'first load failed' } },
      { status: 'rejected', reason: { message: 'first load failed' } },
    ])
    expect(initialize).toHaveBeenCalledOnce()

    await expect(lazy.discover(emptyDiscoveryRequest)).resolves.toEqual(emptyDiscoveryResponse)

    expect(initialize).toHaveBeenCalledTimes(2)
    expect(engine.discover).toHaveBeenCalledOnce()
  })

  test('shares concurrent workspace engine initialization and keeps a successful engine cached', async () => {
    let resolveInitialization!: (engine: {
      readonly discover: (request: DiscoveryRequest) => Promise<typeof emptyDiscoveryResponse>
    }) => void
    const pending = new Promise<{
      readonly discover: (request: DiscoveryRequest) => Promise<typeof emptyDiscoveryResponse>
    }>((resolve) => {
      resolveInitialization = resolve
    })
    const engine = { discover: vi.fn(async () => emptyDiscoveryResponse) }
    const initialize = vi.fn(() => pending)
    const lazy = makeLazyWorkspaceEngine(initialize)

    const first = lazy.discover(emptyDiscoveryRequest)
    const second = lazy.discover(emptyDiscoveryRequest)
    expect(initialize).toHaveBeenCalledOnce()
    resolveInitialization(engine)

    await expect(Promise.all([first, second])).resolves.toEqual([
      emptyDiscoveryResponse,
      emptyDiscoveryResponse,
    ])
    await expect(lazy.discover(emptyDiscoveryRequest)).resolves.toEqual(emptyDiscoveryResponse)
    expect(initialize).toHaveBeenCalledOnce()
    expect(engine.discover).toHaveBeenCalledTimes(3)
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

  test('web capabilities include local model and Development Workbench operations', async () => {
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
        capabilities: [
          { name: 'morphir/model/open', version: '1' },
          { name: 'morphir/development/inspect', version: '1' },
          { name: 'morphir/workspace/open', version: '1' },
        ],
      },
    ])
  })

  test('picks, inspects, and loads a local Development Workbench with Browser Morphir Home', async () => {
    const rootHandle = directoryHandle('orders-workspace', {
      'morphir.toml': '[workspace]\nmembers = ["packages/*"]',
    })
    const handles = new Map<string, FileSystemDirectoryHandle>()
    const requests: DiscoveryRequest[] = []
    const dependencies: BrowserWorkspaceDependencies = {
      engine: {
        discover: async (request) => {
          requests.push(request)
          return {
            status: 'success',
            snapshot: {
              protocolVersion: 1,
              configAnchor: 'morphir.toml',
              name: 'Orders workspace',
              state: 'open',
              projects: [
                {
                  name: 'root',
                  version: '1.0.0',
                  relativePath: '.',
                  configAnchor: 'morphir.toml',
                  sourceDirectory: 'src',
                  state: 'unloaded',
                  diagnostics: [],
                },
                {
                  name: 'orders',
                  version: null,
                  relativePath: 'packages/orders',
                  configAnchor: 'packages/orders/morphir.toml',
                  sourceDirectory: 'packages/orders/src',
                  state: 'unloaded',
                  diagnostics: [],
                },
              ],
              diagnostics: [],
            },
          }
        },
      },
      handles: {
        has: async (key) => handles.has(key),
        put: async (key, handle) => {
          handles.set(key, handle)
        },
        get: async (key) => handles.get(key) ?? null,
        delete: async (key) => {
          handles.delete(key)
        },
      },
      home: {
        read: async () => ({
          entries: {
            '.': { kind: 'directory' },
            'morphir.toml': { kind: 'file', text: '[project]\nversion = "1.0.0"' },
          },
        }),
        writeConfig: async () => undefined,
      },
      pickDirectory: async () => ({ kind: 'handle', handle: rootHandle }),
    }
    const services = await makeAppServices({ core: browserCoreWith('1.0.0', dependencies) })

    const source = await services.pickWorkbenchSource('folder')
    expect(source).toMatchObject({
      providerId: 'browser-local',
      locator: expect.stringMatching(/^directory:/),
      displayName: 'orders-workspace',
    })
    const descriptor = await services.inspectWorkbench(source!)
    expect(descriptor).toMatchObject({
      id: sourceKey(source!),
      source,
      name: 'orders-workspace',
      kind: 'development',
      route: 'overview',
    })
    if (descriptor.kind !== 'development') throw new Error('Expected Development Workbench')

    const loaded = await services.loadDevelopmentWorkbench(descriptor)
    expect(loaded.snapshot).toMatchObject({
      id: sourceKey(source!),
      root: source,
      name: 'Orders workspace',
      projects: [
        { id: projectKey(source!, '.'), relativePath: '.' },
        { id: projectKey(source!, 'packages/orders'), relativePath: 'packages/orders' },
      ],
    })
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      protocolVersion: 1,
      developmentRoot: {
        entries: {
          '.': { kind: 'directory' },
          'morphir.toml': {
            kind: 'file',
            text: '[workspace]\nmembers = ["packages/*"]',
          },
        },
      },
      morphirHome: {
        entries: {
          '.': { kind: 'directory' },
          'morphir.toml': { kind: 'file', text: '[project]\nversion = "1.0.0"' },
        },
      },
    })
  })

  test('keeps a directory-upload fallback available for the provider session', async () => {
    vi.stubGlobal('showDirectoryPicker', undefined)
    const selectedFile = new File(['[project]\nname = "uploaded"'], 'morphir.toml')
    Object.defineProperty(selectedFile, 'webkitRelativePath', {
      configurable: true,
      value: 'uploaded-workspace/morphir.toml',
    })
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (
      this: HTMLInputElement,
    ) {
      expect(this.multiple).toBe(true)
      expect(this.hasAttribute('webkitdirectory')).toBe(true)
      Object.defineProperty(this, 'files', { configurable: true, value: [selectedFile] })
      this.onchange?.(new Event('change'))
    })
    const handleLookup = vi.fn(async () => null)
    const requests: DiscoveryRequest[] = []
    const services = await makeAppServices({
      core: browserCoreWith('1.0.0', {
        engine: {
          discover: async (request) => {
            requests.push(request)
            return {
              status: 'success',
              snapshot: {
                protocolVersion: 1,
                configAnchor: 'morphir.toml',
                name: null,
                state: 'open',
                projects: [
                  {
                    name: 'uploaded',
                    version: null,
                    relativePath: '.',
                    configAnchor: 'morphir.toml',
                    sourceDirectory: 'src',
                    state: 'unloaded',
                    diagnostics: [],
                  },
                ],
                diagnostics: [],
              },
            }
          },
        },
        handles: {
          has: async () => false,
          put: async () => undefined,
          get: handleLookup,
          delete: async () => undefined,
        },
        home: {
          read: async () => ({ entries: { '.': { kind: 'directory' } } }),
          writeConfig: async () => undefined,
        },
        pickDirectory: pickBrowserDirectory,
      }),
    })

    const source = await services.pickWorkbenchSource('folder')
    const descriptor = await services.inspectWorkbench(source!)
    if (descriptor.kind !== 'development') throw new Error('Expected Development Workbench')
    const loaded = await services.loadDevelopmentWorkbench(descriptor)

    expect(source?.displayName).toBe('uploaded-workspace')
    expect(loaded.snapshot.name).toBe('uploaded-workspace')
    expect(requests[0]?.developmentRoot).toEqual({
      entries: {
        '.': { kind: 'directory' },
        'morphir.toml': { kind: 'file', text: '[project]\nname = "uploaded"' },
      },
    })
    expect(handleLookup).not.toHaveBeenCalled()
  })

  test('maps a canonical discovery failure to a typed Workbench error', async () => {
    const handle = directoryHandle('ambiguous-workspace', {
      'morphir.toml': '[project]',
      'morphir.yaml': 'project: {}',
    })
    const handles = new Map<string, FileSystemDirectoryHandle>()
    const core = browserCoreWith('1.0.0', {
      engine: {
        discover: async () => ({
          status: 'failure',
          error: {
            code: 'workspace.config.ambiguous',
            message: 'Found multiple primary configurations',
            path: null,
          },
        }),
      },
      handles: {
        has: async (key) => handles.has(key),
        put: async (key, selected) => {
          handles.set(key, selected)
        },
        get: async (key) => handles.get(key) ?? null,
        delete: async (key) => {
          handles.delete(key)
        },
      },
      home: {
        read: async () => ({ entries: { '.': { kind: 'directory' } } }),
        writeConfig: async () => undefined,
      },
      pickDirectory: async () => ({ kind: 'handle', handle }),
    })
    const services = await makeAppServices({ core })
    const source = await services.pickWorkbenchSource('folder')
    const descriptor = await services.inspectWorkbench(source!)
    if (descriptor.kind !== 'development') throw new Error('Expected Development Workbench')

    const failure = await Effect.runPromise(
      Effect.flip(
        Effect.flatMap(DevelopmentWorkbenchService, (service) => service.load(descriptor)).pipe(
          Effect.provide(core),
        ),
      ),
    )

    expect(failure).toMatchObject({
      _tag: 'WorkbenchError',
      code: 'detection-failed',
      source,
      message: 'workspace.config.ambiguous: Found multiple primary configurations',
    })
  })

  test('retries a persisted handle locator collision without reading or replacing it', async () => {
    installDirectoryIds(1, 2)
    const existingLocator = directoryLocator(1)
    const existingHandle = directoryHandle('existing', { 'morphir.toml': '[project]' })
    const selectedHandle = directoryHandle('selected', { 'morphir.toml': '[project]' })
    const handles = new Map<string, FileSystemDirectoryHandle>([
      [existingLocator, existingHandle as unknown as FileSystemDirectoryHandle],
    ])
    const get = vi.fn(async (key: string) => handles.get(key) ?? null)
    const put = vi.fn(async (key: string, handle: FileSystemDirectoryHandle) => {
      if (handles.has(key)) throw new Error(`Would replace ${key}`)
      handles.set(key, handle)
    })
    const services = await makeAppServices({
      core: browserCoreWith('1.0.0', {
        engine: { discover: async () => Promise.reject(new Error('not used')) },
        handles: {
          has: async (key: string) => handles.has(key),
          put,
          get,
          delete: async (key: string) => {
            handles.delete(key)
          },
        },
        home: {
          read: async () => ({ entries: { '.': { kind: 'directory' } } }),
          writeConfig: async () => undefined,
        },
        pickDirectory: async () => ({ kind: 'handle', handle: selectedHandle }),
      }),
    })

    const selected = await services.pickWorkbenchSource('folder')

    expect(selected?.locator).toBe(directoryLocator(2))
    expect(handles.get(existingLocator)).toBe(existingHandle)
    expect(put).toHaveBeenCalledOnce()
    expect(put).toHaveBeenCalledWith(
      directoryLocator(2),
      selectedHandle as unknown as FileSystemDirectoryHandle,
    )
    expect(get).not.toHaveBeenCalled()
  })

  test('retries an uploaded-tree locator collision and preserves the first source', async () => {
    installDirectoryIds(1, 1, 2)
    const uploads = [
      {
        kind: 'upload' as const,
        name: 'first',
        files: [
          {
            relativePath: 'first/morphir.toml',
            size: 24,
            text: async () => '[project]\nname = "first"',
          },
        ],
      },
      {
        kind: 'upload' as const,
        name: 'second',
        files: [
          {
            relativePath: 'second/morphir.toml',
            size: 25,
            text: async () => '[project]\nname = "second"',
          },
        ],
      },
    ]
    const requests: DiscoveryRequest[] = []
    const services = await makeAppServices({
      core: browserCoreWith('1.0.0', {
        engine: {
          discover: async (request) => {
            requests.push(request)
            const config = request.developmentRoot.entries['morphir.toml']
            const name =
              config?.kind === 'file' && config.text.includes('second') ? 'second' : 'first'
            return {
              status: 'success',
              snapshot: {
                protocolVersion: 1,
                configAnchor: 'morphir.toml',
                name,
                state: 'open',
                projects: [],
                diagnostics: [],
              },
            }
          },
        },
        handles: {
          has: async () => false,
          put: async () => undefined,
          get: async () => null,
          delete: async () => undefined,
        },
        home: {
          read: async () => ({ entries: { '.': { kind: 'directory' } } }),
          writeConfig: async () => undefined,
        },
        pickDirectory: async () => uploads.shift() ?? null,
      }),
    })

    const first = await services.pickWorkbenchSource('folder')
    const second = await services.pickWorkbenchSource('folder')
    const firstDescriptor = await services.inspectWorkbench(first!)
    const secondDescriptor = await services.inspectWorkbench(second!)
    if (firstDescriptor.kind !== 'development' || secondDescriptor.kind !== 'development') {
      throw new Error('Expected Development Workbenches')
    }
    const firstLoaded = await services.loadDevelopmentWorkbench(firstDescriptor)
    const secondLoaded = await services.loadDevelopmentWorkbench(secondDescriptor)

    expect(first?.locator).toBe(directoryLocator(1))
    expect(second?.locator).toBe(directoryLocator(2))
    expect(firstLoaded.snapshot.name).toBe('first')
    expect(secondLoaded.snapshot.name).toBe('second')
    expect(requests.map((request) => request.developmentRoot.entries['morphir.toml'])).toEqual([
      { kind: 'file', text: '[project]\nname = "first"' },
      { kind: 'file', text: '[project]\nname = "second"' },
    ])
  })

  test('reserves opaque directory IDs across concurrent upload selections', async () => {
    installDirectoryIds(201, 201, 202)
    const uploads = ['first', 'second'].map((name) => ({
      kind: 'upload' as const,
      name,
      files: [
        {
          relativePath: `${name}/morphir.toml`,
          size: 25,
          text: async () => `[project]\nname = "${name}"`,
        },
      ],
    }))
    const services = await makeAppServices({
      core: browserCoreWith('1.0.0', {
        engine: { discover: async () => Promise.reject(new Error('not used')) },
        handles: {
          has: async () => false,
          put: async () => undefined,
          get: async () => null,
          delete: async () => undefined,
        },
        home: {
          read: async () => ({ entries: { '.': { kind: 'directory' } } }),
          writeConfig: async () => undefined,
        },
        pickDirectory: async () => uploads.shift() ?? null,
      }),
    })

    const [first, second] = await Promise.all([
      services.pickWorkbenchSource('folder'),
      services.pickWorkbenchSource('folder'),
    ])

    expect(new Set([first?.locator, second?.locator])).toEqual(
      new Set([directoryLocator(201), directoryLocator(202)]),
    )
  })

  test('serializes handle source allocation across independent provider Layers', async () => {
    installDirectoryIds(401, 401, 402)
    const firstHandle = directoryHandle('first-handle', { 'morphir.toml': '[project]' })
    const secondHandle = directoryHandle('second-handle', { 'morphir.toml': '[project]' })
    const handles = new Map<string, FileSystemDirectoryHandle>()
    const sharedHandles = {
      has: async (key: string) => handles.has(key),
      put: async (key: string, handle: FileSystemDirectoryHandle) => {
        handles.set(key, handle)
      },
      get: async (key: string) => handles.get(key) ?? null,
      delete: async (key: string) => {
        handles.delete(key)
      },
    }
    const dependencies = (handle: DirectoryPermissionHandle): BrowserWorkspaceDependencies => ({
      engine: { discover: async () => Promise.reject(new Error('not used')) },
      handles: sharedHandles,
      home: {
        read: async () => ({ entries: { '.': { kind: 'directory' } } }),
        writeConfig: async () => undefined,
      },
      pickDirectory: async () => ({ kind: 'handle', handle }),
    })
    const firstServices = await makeAppServices({
      core: browserCoreWith('1.0.0', dependencies(firstHandle)),
    })
    const secondServices = await makeAppServices({
      core: browserCoreWith('1.0.0', dependencies(secondHandle)),
    })

    const [first, second] = await Promise.all([
      firstServices.pickWorkbenchSource('folder'),
      secondServices.pickWorkbenchSource('folder'),
    ])

    expect(new Set([first?.locator, second?.locator])).toEqual(
      new Set([directoryLocator(401), directoryLocator(402)]),
    )
    expect(handles).toEqual(
      new Map([
        [directoryLocator(401), firstHandle],
        [directoryLocator(402), secondHandle],
      ]),
    )
  })

  test('serializes upload source allocation across independent provider Layers', async () => {
    installDirectoryIds(501, 501, 502)
    const upload = (name: string) => ({
      kind: 'upload' as const,
      name,
      files: [
        {
          relativePath: `${name}/morphir.toml`,
          size: 25,
          text: async () => `[project]\nname = "${name}"`,
        },
      ],
    })
    const sharedHandles = {
      has: async () => false,
      put: async () => undefined,
      get: async () => null,
      delete: async () => undefined,
    }
    const dependencies = (name: string): BrowserWorkspaceDependencies => ({
      engine: { discover: async () => Promise.reject(new Error('not used')) },
      handles: sharedHandles,
      home: {
        read: async () => ({ entries: { '.': { kind: 'directory' } } }),
        writeConfig: async () => undefined,
      },
      pickDirectory: async () => upload(name),
    })
    const firstServices = await makeAppServices({
      core: browserCoreWith('1.0.0', dependencies('first-upload')),
    })
    const secondServices = await makeAppServices({
      core: browserCoreWith('1.0.0', dependencies('second-upload')),
    })

    const [first, second] = await Promise.all([
      firstServices.pickWorkbenchSource('folder'),
      secondServices.pickWorkbenchSource('folder'),
    ])

    expect(new Set([first?.locator, second?.locator])).toEqual(
      new Set([directoryLocator(501), directoryLocator(502)]),
    )
    expect((await firstServices.inspectWorkbench(first!)).name).toBe('first-upload')
    expect((await secondServices.inspectWorkbench(second!)).name).toBe('second-upload')
  })

  test('returns a typed failure when opaque directory IDs remain exhausted', async () => {
    installDirectoryIds(301)
    const upload = {
      kind: 'upload' as const,
      name: 'workspace',
      files: [{ relativePath: 'workspace/morphir.toml', size: 9, text: async () => '[project]' }],
    }
    const core = browserCoreWith('1.0.0', {
      engine: { discover: async () => Promise.reject(new Error('not used')) },
      handles: {
        has: async () => false,
        put: async () => undefined,
        get: async () => null,
        delete: async () => undefined,
      },
      home: {
        read: async () => ({ entries: { '.': { kind: 'directory' } } }),
        writeConfig: async () => undefined,
      },
      pickDirectory: async () => upload,
    })
    const services = await makeAppServices({ core })
    await services.pickWorkbenchSource('folder')

    const failure = await Effect.runPromise(
      Effect.flip(
        Effect.flatMap(WorkbenchSourceService, (service) => service.pick('folder')).pipe(
          Effect.provide(core),
        ),
      ),
    )

    expect(failure).toMatchObject({
      _tag: 'WorkbenchError',
      code: 'read-failed',
      source: '<browser-folder>',
      message: 'Unable to allocate a unique browser directory source after 32 attempts',
    })

    installDirectoryIds(302)
    await expect(services.pickWorkbenchSource('folder')).resolves.toMatchObject({
      locator: directoryLocator(302),
    })
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

  test('keeps a lone morphir-ir.json as a single-file Model Workbench', async () => {
    const selectedFile = new File(
      ['{"formatVersion":3,"distribution":["Library",[],[],{"modules":[]}]}'],
      'morphir-ir.json',
    )
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (
      this: HTMLInputElement,
    ) {
      Object.defineProperty(this, 'files', { configurable: true, value: [selectedFile] })
      this.onchange?.(new Event('change'))
    })
    const services = await makeAppServices({ core: browserCore('1.0.0') })

    const source = await services.pickWorkbenchSource('model-file')
    const descriptor = await services.inspectWorkbench(source!)

    expect(descriptor).toMatchObject({
      source,
      name: 'morphir-ir.json',
      kind: 'model',
      distribution: 'single-file',
    })
  })

  test('allocates distinct locators across independent browser runtimes', async () => {
    const selectedFiles = [new File(['{}'], 'first.json'), new File(['{}'], 'second.json')]
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
    const selectedFiles = [new File(['{}'], 'first.json'), new File(['{}'], 'second.json')]
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

    expect(new Set([first?.locator, second?.locator])).toEqual(new Set(['model:1', 'model:2']))
    expect(requestedLocks).toEqual([LOCK_NAME, LOCK_NAME])
  })

  test('uses cryptographically random opaque locators when Web Locks are unavailable', async () => {
    vi.stubGlobal('navigator', {})
    const randomValues = vi.spyOn(globalThis.crypto, 'getRandomValues')
    const selectedFiles = [new File(['{}'], 'first.json'), new File(['{}'], 'second.json')]
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
    const selectedFiles = [new File(['{}'], 'first.json'), new File(['{}'], 'second.json')]
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

  test('reports a typed failure for unsupported project models and leaves events empty', async () => {
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
    const projectError = await Effect.runPromise(
      Effect.flip(
        Effect.flatMap(DevelopmentWorkbenchService, (service) =>
          service.loadProjectModel(descriptor, 'orders'),
        ).pipe(Effect.provide(core)),
      ),
    )
    const events = await Effect.runPromise(
      Effect.flatMap(DevelopmentWorkbenchService, (service) =>
        Stream.runCollect(service.events(descriptor)),
      ).pipe(Effect.provide(core)),
    )

    expect(projectError.code).toBe('unsupported-capability')
    expect([...events]).toEqual([])
  })
})
