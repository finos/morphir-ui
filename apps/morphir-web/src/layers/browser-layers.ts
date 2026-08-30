import { Effect, Layer, Option } from 'effect'
import {
  AppInfoService,
  ConfigService,
  ModelWorkbenchService,
  WorkbenchError,
  unsupportedProviderError,
  WorkspaceError,
  WorkspaceService,
  decodeUiConfig,
  defaultUiConfig,
  type CoreServices,
  type PickedWorkspace,
} from '@morphir/ui'
import { decodeMorphirIr, toWorkspaceIr } from '@morphir/ir'
import {
  makeWorkspaceDiscoveryEngine,
  type WorkspaceDiscoveryEngine,
} from '@morphir/workspace-engine'
import workspaceWasmUrl from '@morphir/workspace-engine/wasm?url'
import { sourceKey, type WorkbenchSourceRef } from '@morphir/workspace'
import {
  makeBrowserWorkbenchLayers,
  pickBrowserDirectory,
  type BrowserWorkspaceDependencies,
} from '../workspace/browser-provider.ts'
import { makeBrowserMorphirHome } from '../workspace/browser-home.ts'
import {
  makeDirectoryHandleStore,
  makeIndexedDbWorkspaceStorage,
  type WorkspaceStorage,
} from '../workspace/handle-store.ts'

export type { BrowserWorkspaceDependencies } from '../workspace/browser-provider.ts'

const CONFIG_KEY = 'morphir-ui.config'
const MODEL_SOURCE_COUNTER_KEY = 'morphir-ui.browser-local.model-source-counter.v1'
const MODEL_SOURCE_COUNTER_LOCK = `${MODEL_SOURCE_COUNTER_KEY}.lock`
const MODEL_LOCATOR_PATTERN = /^model:(\d+)$/
const fallbackModelLocators = new Set<string>()

const recordOf = (value: unknown): Readonly<Record<string, unknown>> | null =>
  typeof value === 'object' && value !== null ? (value as Readonly<Record<string, unknown>>) : null

const counterValue = (value: string | null): bigint | null => {
  if (value === null || !/^\d+$/.test(value)) return null
  try {
    return BigInt(value)
  } catch {
    return null
  }
}

const locatorCounter = (value: unknown): bigint | null => {
  if (typeof value !== 'string') return null
  const match = MODEL_LOCATOR_PATTERN.exec(value)
  return match ? counterValue(match[1] ?? null) : null
}

const persistedBrowserModelCounter = (storage: Storage): bigint => {
  const raw = storage.getItem(CONFIG_KEY)
  if (raw === null) return 0n
  const config = recordOf(JSON.parse(raw))
  const workbenches = recordOf(config?.['workbenches'])
  const entries = [workbenches?.['open'], workbenches?.['recent']].flatMap((value) =>
    Array.isArray(value) ? value : [],
  )
  return entries.reduce((maximum, entry) => {
    const source = recordOf(recordOf(entry)?.['source'])
    if (source?.['providerId'] !== 'browser-local') return maximum
    const candidate = locatorCounter(source['locator'])
    return candidate !== null && candidate > maximum ? candidate : maximum
  }, 0n)
}

const fallbackModelLocator = (): string => {
  let locator: string
  do {
    const values = new Uint32Array(4)
    globalThis.crypto.getRandomValues(values)
    const token = values.reduce((value, part) => (value << 32n) | BigInt(part), 0n)
    locator = `model:${token}`
  } while (fallbackModelLocators.has(locator))
  fallbackModelLocators.add(locator)
  return locator
}

const allocatePersistentBrowserModelLocator = (): string => {
  const storage = globalThis.localStorage
  const storedCounter = counterValue(storage.getItem(MODEL_SOURCE_COUNTER_KEY)) ?? 0n
  const persistedCounter = persistedBrowserModelCounter(storage)
  const nextCounter = (storedCounter > persistedCounter ? storedCounter : persistedCounter) + 1n
  storage.setItem(MODEL_SOURCE_COUNTER_KEY, nextCounter.toString())
  return `model:${nextCounter}`
}

const allocateBrowserModelLocator = async (): Promise<string> => {
  try {
    const locks = globalThis.navigator?.locks
    if (!locks) return fallbackModelLocator()
    return await locks.request(MODEL_SOURCE_COUNTER_LOCK, () => {
      // Keep the lock around only this synchronous storage transaction.
      return allocatePersistentBrowserModelLocator()
    })
  } catch {
    return fallbackModelLocator()
  }
}

const makeBrowserCoreLayers = (
  version: string,
  dependencies: BrowserWorkspaceDependencies,
): Layer.Layer<CoreServices> => {
  const selectedModels = new Map<string, { name: string; content: string }>()
  const selectedModelNameCounts = new Map<string, number>()
  const providerError = (source: WorkbenchSourceRef): WorkbenchError =>
    unsupportedProviderError('browser-local', source)
  const browserWorkbenchLayers = makeBrowserWorkbenchLayers(dependencies, {
    inspect: (source) => {
      const selectedModel = selectedModels.get(sourceKey(source))
      if (!selectedModel) {
        return Effect.fail(
          new WorkbenchError({
            code: 'not-found',
            source,
            message: `Workbench source not found in this browser session: ${source.locator}`,
          }),
        )
      }
      const timestamp = new Date().toISOString()
      const sourceRef = {
        providerId: 'browser-local',
        locator: source.locator,
        displayName: selectedModel.name,
      }
      return Effect.succeed({
        id: sourceKey(sourceRef),
        source: sourceRef,
        name: selectedModel.name,
        kind: 'model' as const,
        distribution: 'single-file' as const,
        route: 'overview' as const,
        openedAt: timestamp,
        lastUsedAt: timestamp,
      })
    },
    pick: () =>
      Effect.async<Option.Option<WorkbenchSourceRef>, WorkbenchError>((resume) => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = 'application/json,.json'
        input.onchange = () => {
          const file = input.files?.[0]
          if (!file) return resume(Effect.succeed(Option.none()))
          void file
            .text()
            .then(async (content) => {
              const source = await allocateBrowserModelLocator()
              const nameCount = (selectedModelNameCounts.get(file.name) ?? 0) + 1
              selectedModelNameCounts.set(file.name, nameCount)
              const name = nameCount === 1 ? file.name : `${file.name} (${nameCount})`
              const sourceRef = {
                providerId: 'browser-local',
                locator: source,
                displayName: name,
              }
              selectedModels.set(sourceKey(sourceRef), { name, content })
              resume(Effect.succeed(Option.some(sourceRef)))
            })
            .catch((error) =>
              resume(
                Effect.fail(
                  new WorkbenchError({
                    code: 'read-failed',
                    source: file.name,
                    message: String(error),
                  }),
                ),
              ),
            )
        }
        input.oncancel = () => resume(Effect.succeed(Option.none()))
        input.click()
        return Effect.sync(() => {
          input.onchange = null
          input.oncancel = null
        })
      }),
  })

  return Layer.mergeAll(
    Layer.succeed(ConfigService, {
      load: Effect.sync(() => {
        try {
          return decodeUiConfig(JSON.parse(localStorage.getItem(CONFIG_KEY) ?? '{}'), {
            legacyProviderId: 'browser-local',
          })
        } catch {
          return defaultUiConfig
        }
      }),
      save: (config) => Effect.sync(() => localStorage.setItem(CONFIG_KEY, JSON.stringify(config))),
    }),
    Layer.succeed(WorkspaceService, {
      pickAndRead: Effect.async<Option.Option<PickedWorkspace>, WorkspaceError>((resume) => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = 'application/json,.json'
        input.onchange = () => {
          const file = input.files?.[0]
          if (!file) return resume(Effect.succeed(Option.none()))
          file.text().then(
            (content) => resume(Effect.succeed(Option.some({ ref: { path: file.name }, content }))),
            (e) => resume(Effect.fail(new WorkspaceError({ message: String(e) }))),
          )
        }
        input.oncancel = () => resume(Effect.succeed(Option.none()))
        input.click()
        return Effect.sync(() => {
          input.onchange = null
          input.oncancel = null
        })
      }),
      read: Option.none(),
    }),
    browserWorkbenchLayers,
    Layer.succeed(ModelWorkbenchService, {
      load: (descriptor) => {
        if (descriptor.source.providerId !== 'browser-local') {
          return Effect.fail(providerError(descriptor.source))
        }
        const selectedModel = selectedModels.get(sourceKey(descriptor.source))
        if (!selectedModel) {
          return Effect.fail(
            new WorkbenchError({
              code: 'not-found',
              source: descriptor.source,
              message: `Workbench source not found in this browser session: ${descriptor.source.locator}`,
            }),
          )
        }
        return decodeMorphirIr(selectedModel.content).pipe(
          Effect.map((library) => ({
            kind: 'model' as const,
            descriptor,
            library,
            ir: toWorkspaceIr(library),
            manifest: null,
          })),
          Effect.mapError(
            (error) =>
              new WorkbenchError({
                code: 'invalid-distribution',
                source: descriptor.source,
                message: error.message,
              }),
          ),
        )
      },
    }),
    Layer.succeed(AppInfoService, { version: Effect.succeed(version) }),
  )
}

export const browserCoreWith = (
  version: string,
  dependencies: BrowserWorkspaceDependencies,
): Layer.Layer<CoreServices> => makeBrowserCoreLayers(version, dependencies)

export const makeLazyWorkspaceEngine = (
  initialize: () => Promise<WorkspaceDiscoveryEngine>,
): WorkspaceDiscoveryEngine => {
  let initialized: Promise<WorkspaceDiscoveryEngine> | undefined
  return {
    discover: async (request) => {
      const pending = (initialized ??= initialize())
      let engine: WorkspaceDiscoveryEngine
      try {
        engine = await pending
      } catch (cause) {
        if (initialized === pending) initialized = undefined
        throw cause
      }
      return engine.discover(request)
    },
  }
}

const lazyWorkspaceEngine = (): WorkspaceDiscoveryEngine =>
  makeLazyWorkspaceEngine(() =>
    fetch(workspaceWasmUrl)
      .then((response) => {
        if (!response.ok) {
          throw new Error(
            `Unable to load workspace discovery WebAssembly: ${response.status} ${response.statusText}`,
          )
        }
        return response.arrayBuffer()
      })
      .then(makeWorkspaceDiscoveryEngine),
  )

export const browserCore = (version: string): Layer.Layer<CoreServices> => {
  let storage: WorkspaceStorage | undefined
  const getStorage = (): WorkspaceStorage =>
    (storage ??= makeIndexedDbWorkspaceStorage(globalThis.indexedDB))
  return makeBrowserCoreLayers(version, {
    engine: lazyWorkspaceEngine(),
    handles: {
      has: (key) => makeDirectoryHandleStore(getStorage()).has(key),
      put: (key, handle) => makeDirectoryHandleStore(getStorage()).put(key, handle),
      get: (key) => makeDirectoryHandleStore(getStorage()).get(key),
      delete: (key) => makeDirectoryHandleStore(getStorage()).delete(key),
    },
    home: {
      read: () => makeBrowserMorphirHome(getStorage()).read(),
      writeConfig: (name, text) => makeBrowserMorphirHome(getStorage()).writeConfig(name, text),
    },
    pickDirectory: pickBrowserDirectory,
  })
}
