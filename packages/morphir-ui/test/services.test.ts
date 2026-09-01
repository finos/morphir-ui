import { describe, expect, test } from 'vitest'
import { Effect, Layer, Stream } from 'effect'
import { projectKey, sourceKey, type WorkspaceSnapshot } from '@morphir/workspace'
import {
  ConfigService,
  decodeUiConfig,
  defaultUiConfig,
  makeAppServices,
  withSnapshot,
  configToSnapshot,
  legacySourceRef,
  type DevelopmentWorkbenchDescriptor,
  type ModelWorkbenchDescriptor,
  type UiConfig,
} from '../src/index.ts'
import { makeFakeCore, makeFakeGitHub, makeFakePipeline } from './support/fake-services.ts'

describe('UiConfig', () => {
  test('empty input decodes to defaults', () => {
    expect(decodeUiConfig({})).toEqual(defaultUiConfig)
    expect(defaultUiConfig.appearance.colorScheme).toBe('dark')
    expect(defaultUiConfig.github.source).toBe('none')
    expect(defaultUiConfig.workbenches.reopenOnLaunch).toBe(true)
  })
  test('invalid input falls back to defaults', () => {
    expect(decodeUiConfig({ appearance: { colorScheme: 'sepia' } })).toEqual(defaultUiConfig)
    expect(decodeUiConfig('garbage')).toEqual(defaultUiConfig)
  })
  test('snapshot round-trip', () => {
    const snap = configToSnapshot(defaultUiConfig)
    expect(snap.shell.leftWidth).toBe(320)
    const updated = withSnapshot(defaultUiConfig, {
      ...snap,
      appearance: { ...snap.appearance, colorScheme: 'light' },
    })
    expect(updated.appearance.colorScheme).toBe('light')
    expect(updated.github).toEqual(defaultUiConfig.github)
  })
})

describe('makeAppServices', () => {
  test('rejects an inspection descriptor whose id does not match its canonical source', async () => {
    const source = legacySourceRef('/fake/model.json', 'browser-local')
    const { core } = makeFakeCore({
      providers: [
        {
          id: 'browser-local',
          name: 'This browser',
          kind: 'local',
          status: 'available',
          capabilities: [],
        },
      ],
      inspectResultId: 'stale-id',
    })
    const services = await makeAppServices({ core })

    await expect(services.inspectWorkbench(source)).rejects.toThrow(
      'descriptor identity does not match its source',
    )
  })

  test('allows inspection to canonicalize a locator with a matching canonical id', async () => {
    const requested = legacySourceRef('/alias.json', 'browser-local')
    const { core } = makeFakeCore({
      providers: [
        {
          id: 'browser-local',
          name: 'This browser',
          kind: 'local',
          status: 'available',
          capabilities: [],
        },
      ],
      canonicalSources: { '/alias.json': '/canonical/model.json' },
    })
    const services = await makeAppServices({ core })

    const descriptor = await services.inspectWorkbench(requested)
    expect(descriptor.source.locator).toBe('/canonical/model.json')
    expect(descriptor.id).toBe(sourceKey(descriptor.source))
  })

  test('rejects a project model descriptor whose id does not match its source', async () => {
    const source = legacySourceRef('/fake/workspace', 'browser-local')
    const descriptor: DevelopmentWorkbenchDescriptor = {
      id: sourceKey(source),
      source,
      name: 'workspace',
      kind: 'development',
      route: 'overview',
      openedAt: '2026-08-29T12:00:00.000Z',
      lastUsedAt: '2026-08-29T12:00:00.000Z',
    }
    const { core } = makeFakeCore({
      providers: [
        {
          id: 'browser-local',
          name: 'This browser',
          kind: 'local',
          status: 'available',
          capabilities: [],
        },
      ],
      development: { projectResultId: 'stale-project-id' },
    })
    const services = await makeAppServices({ core })

    await expect(services.loadDevelopmentProjectModel(descriptor, 'orders')).rejects.toThrow(
      'descriptor identity does not match its source',
    )
  })

  test('rejects malformed requested model and development descriptors', async () => {
    const modelSource = legacySourceRef('/fake/model.json', 'browser-local')
    const developmentSource = legacySourceRef('/fake/workspace', 'browser-local')
    const modelDescriptor: ModelWorkbenchDescriptor = {
      id: 'stale-model-id',
      source: modelSource,
      name: 'model.json',
      kind: 'model',
      distribution: 'single-file',
      route: 'overview',
      openedAt: '2026-08-29T12:00:00.000Z',
      lastUsedAt: '2026-08-29T12:00:00.000Z',
    }
    const developmentDescriptor: DevelopmentWorkbenchDescriptor = {
      id: 'stale-development-id',
      source: developmentSource,
      name: 'workspace',
      kind: 'development',
      route: 'overview',
      openedAt: '2026-08-29T12:00:00.000Z',
      lastUsedAt: '2026-08-29T12:00:00.000Z',
    }
    const { core } = makeFakeCore({
      providers: [
        {
          id: 'browser-local',
          name: 'This browser',
          kind: 'local',
          status: 'available',
          capabilities: [],
        },
      ],
    })
    const services = await makeAppServices({ core })

    await expect(services.loadModelWorkbench(modelDescriptor)).rejects.toThrow(
      'descriptor identity does not match its source',
    )
    await expect(services.loadDevelopmentWorkbench(developmentDescriptor)).rejects.toThrow(
      'descriptor identity does not match its source',
    )
  })

  test('rejects a malformed project-load descriptor before invoking its provider', async () => {
    const source = legacySourceRef('/fake/workspace', 'browser-local')
    const descriptor: DevelopmentWorkbenchDescriptor = {
      id: 'stale-development-id',
      source,
      name: 'workspace',
      kind: 'development',
      route: 'overview',
      openedAt: '2026-08-29T12:00:00.000Z',
      lastUsedAt: '2026-08-29T12:00:00.000Z',
    }
    let providerCalls = 0
    const { core } = makeFakeCore({
      providers: [
        {
          id: 'browser-local',
          name: 'This browser',
          kind: 'local',
          status: 'available',
          capabilities: [],
        },
      ],
      development: { onProjectModelLoad: () => void (providerCalls += 1) },
    })
    const services = await makeAppServices({ core })

    await expect(services.loadDevelopmentProjectModel(descriptor, 'orders')).rejects.toThrow(
      'descriptor identity does not match its source',
    )
    expect(providerCalls).toBe(0)
  })

  test('rejects malformed workspace events before invoking an empty provider stream', async () => {
    const source = legacySourceRef('/fake/workspace', 'browser-local')
    const descriptor: DevelopmentWorkbenchDescriptor = {
      id: 'stale-development-id',
      source,
      name: 'workspace',
      kind: 'development',
      route: 'overview',
      openedAt: '2026-08-29T12:00:00.000Z',
      lastUsedAt: '2026-08-29T12:00:00.000Z',
    }
    let providerCalls = 0
    const { core } = makeFakeCore({
      providers: [
        {
          id: 'browser-local',
          name: 'This browser',
          kind: 'local',
          status: 'available',
          capabilities: [],
        },
      ],
      development: {
        events: Stream.empty,
        onEvents: () => void (providerCalls += 1),
      },
    })
    const services = await makeAppServices({ core })

    await expect(
      Effect.runPromise(Stream.runCollect(services.workspaceEvents(descriptor))),
    ).rejects.toThrow('descriptor identity does not match its source')
    expect(providerCalls).toBe(0)
  })

  test('rejects a model result that switches same-provider workbench identity', async () => {
    const source = legacySourceRef('/fake/model-a.json', 'browser-local')
    const switched = legacySourceRef('/fake/model-b.json', 'browser-local')
    const descriptor: ModelWorkbenchDescriptor = {
      id: sourceKey(source),
      source,
      name: 'model-a.json',
      kind: 'model',
      distribution: 'single-file',
      route: 'overview',
      openedAt: '2026-08-29T12:00:00.000Z',
      lastUsedAt: '2026-08-29T12:00:00.000Z',
    }
    const { core } = makeFakeCore({
      providers: [
        {
          id: 'browser-local',
          name: 'This browser',
          kind: 'local',
          status: 'available',
          capabilities: [],
        },
      ],
      modelResultSource: switched,
    })
    const services = await makeAppServices({ core })

    await expect(services.loadModelWorkbench(descriptor)).rejects.toThrow('workbench identity')
  })

  test('rejects a development result that switches same-provider workbench identity', async () => {
    const source = legacySourceRef('/fake/workspace-a', 'browser-local')
    const switched = legacySourceRef('/fake/workspace-b', 'browser-local')
    const descriptor: DevelopmentWorkbenchDescriptor = {
      id: sourceKey(source),
      source,
      name: 'workspace-a',
      kind: 'development',
      route: 'overview',
      openedAt: '2026-08-29T12:00:00.000Z',
      lastUsedAt: '2026-08-29T12:00:00.000Z',
    }
    const { core } = makeFakeCore({
      providers: [
        {
          id: 'browser-local',
          name: 'This browser',
          kind: 'local',
          status: 'available',
          capabilities: [],
        },
      ],
      development: { resultSource: switched },
    })
    const services = await makeAppServices({ core })

    await expect(services.loadDevelopmentWorkbench(descriptor)).rejects.toThrow(
      'workbench identity',
    )
  })

  test('rejects a snapshot event that switches same-provider workspace identity', async () => {
    const source = legacySourceRef('/fake/workspace-a', 'browser-local')
    const switched = legacySourceRef('/fake/workspace-b', 'browser-local')
    const descriptor: DevelopmentWorkbenchDescriptor = {
      id: sourceKey(source),
      source,
      name: 'workspace-a',
      kind: 'development',
      route: 'overview',
      openedAt: '2026-08-29T12:00:00.000Z',
      lastUsedAt: '2026-08-29T12:00:00.000Z',
    }
    const snapshot: WorkspaceSnapshot = {
      id: sourceKey(switched),
      root: switched,
      name: 'workspace-b',
      configAnchor: null,
      state: 'open',
      projects: [],
      modelSources: [],
      knowledgeBaseSources: [],
      diagnostics: [],
    }
    const { core } = makeFakeCore({
      providers: [
        {
          id: 'browser-local',
          name: 'This browser',
          kind: 'local',
          status: 'available',
          capabilities: [],
        },
      ],
      development: { events: Stream.make({ tag: 'snapshot' as const, snapshot }) },
    })
    const services = await makeAppServices({ core })

    await expect(
      Effect.runPromise(Stream.runCollect(services.workspaceEvents(descriptor))),
    ).rejects.toThrow('workbench identity')
  })

  test('rejects an inspection result that switches provider', async () => {
    const source = legacySourceRef('/fake/model.json', 'browser-local')
    const foreignSource = { ...source, providerId: 'cli:session-1' }
    const { core } = makeFakeCore({
      providers: [
        {
          id: 'browser-local',
          name: 'This browser',
          kind: 'local',
          status: 'available',
          capabilities: [],
        },
      ],
      inspectResultSource: foreignSource,
    })
    const services = await makeAppServices({ core })

    await expect(services.inspectWorkbench(source)).rejects.toThrow(
      'expected provider browser-local',
    )
  })

  test('rejects a development result descriptor that switches provider', async () => {
    const source = legacySourceRef('/fake/workspace', 'browser-local')
    const foreignSource = { ...source, providerId: 'cli:session-1' }
    const descriptor: DevelopmentWorkbenchDescriptor = {
      id: sourceKey(source),
      source,
      name: 'workspace',
      kind: 'development',
      route: 'overview',
      openedAt: '2026-08-29T12:00:00.000Z',
      lastUsedAt: '2026-08-29T12:00:00.000Z',
    }
    const { core } = makeFakeCore({
      providers: [
        {
          id: 'browser-local',
          name: 'This browser',
          kind: 'local',
          status: 'available',
          capabilities: [],
        },
      ],
      development: { resultSource: foreignSource },
    })
    const services = await makeAppServices({ core })

    await expect(services.loadDevelopmentWorkbench(descriptor)).rejects.toThrow(
      'expected provider browser-local',
    )
  })

  test('rejects a foreign root-level source in a workspace snapshot', async () => {
    const source = legacySourceRef('/fake/workspace', 'browser-local')
    const foreignSource = legacySourceRef('/foreign/model.json', 'cli:session-1')
    const descriptor: DevelopmentWorkbenchDescriptor = {
      id: sourceKey(source),
      source,
      name: 'workspace',
      kind: 'development',
      route: 'overview',
      openedAt: '2026-08-29T12:00:00.000Z',
      lastUsedAt: '2026-08-29T12:00:00.000Z',
    }
    const { core } = makeFakeCore({
      providers: [
        {
          id: 'browser-local',
          name: 'This browser',
          kind: 'local',
          status: 'available',
          capabilities: [],
        },
      ],
      development: {
        snapshot: {
          id: sourceKey(source),
          root: source,
          name: 'workspace',
          configAnchor: null,
          state: 'open',
          projects: [],
          modelSources: [foreignSource],
          knowledgeBaseSources: [],
          diagnostics: [],
        },
      },
    })
    const services = await makeAppServices({ core })

    await expect(services.loadDevelopmentWorkbench(descriptor)).rejects.toThrow(
      'expected provider browser-local',
    )
  })

  test('rejects a foreign project-level source in a workspace snapshot event', async () => {
    const source = legacySourceRef('/fake/workspace', 'browser-local')
    const foreignSource = legacySourceRef('/foreign/model.json', 'cli:session-1')
    const descriptor: DevelopmentWorkbenchDescriptor = {
      id: sourceKey(source),
      source,
      name: 'workspace',
      kind: 'development',
      route: 'overview',
      openedAt: '2026-08-29T12:00:00.000Z',
      lastUsedAt: '2026-08-29T12:00:00.000Z',
    }
    const snapshot: WorkspaceSnapshot = {
      id: sourceKey(source),
      root: source,
      name: 'workspace',
      configAnchor: null,
      state: 'open',
      projects: [
        {
          id: 'orders',
          name: 'Orders',
          version: null,
          relativePath: 'packages/orders',
          configAnchor: null,
          sourceDirectory: 'src',
          state: 'ready',
          modelSources: [foreignSource],
          knowledgeBaseSources: [],
          diagnostics: [],
        },
      ],
      modelSources: [],
      knowledgeBaseSources: [],
      diagnostics: [],
    }
    const { core } = makeFakeCore({
      providers: [
        {
          id: 'browser-local',
          name: 'This browser',
          kind: 'local',
          status: 'available',
          capabilities: [],
        },
      ],
      development: { events: Stream.make({ tag: 'snapshot' as const, snapshot }) },
    })
    const services = await makeAppServices({ core })

    await expect(
      Effect.runPromise(Stream.runCollect(services.workspaceEvents(descriptor))),
    ).rejects.toThrow('expected provider browser-local')
  })

  test('rejects provider-switching model, snapshot, project, and event results', async () => {
    const browserSource = legacySourceRef('/fake/workspace', 'browser-local')
    const foreignSource = { ...browserSource, providerId: 'cli:session-1' }
    const developmentDescriptor: DevelopmentWorkbenchDescriptor = {
      id: sourceKey(browserSource),
      source: browserSource,
      name: 'workspace',
      kind: 'development',
      route: 'overview',
      openedAt: '2026-08-29T12:00:00.000Z',
      lastUsedAt: '2026-08-29T12:00:00.000Z',
    }
    const modelDescriptor: ModelWorkbenchDescriptor = {
      ...developmentDescriptor,
      kind: 'model',
      distribution: 'single-file',
    }
    const foreignSnapshot: WorkspaceSnapshot = {
      id: sourceKey(foreignSource),
      root: foreignSource,
      name: 'workspace',
      configAnchor: null,
      state: 'open',
      projects: [],
      modelSources: [],
      knowledgeBaseSources: [],
      diagnostics: [],
    }
    const { core } = makeFakeCore({
      providers: [
        {
          id: 'browser-local',
          name: 'This browser',
          kind: 'local',
          status: 'available',
          capabilities: [{ name: 'morphir/model/open', version: '1' }],
        },
      ],
      modelResultSource: foreignSource,
      development: {
        snapshot: foreignSnapshot,
        projectResultSource: foreignSource,
        events: Stream.make(
          { tag: 'snapshot' as const, snapshot: foreignSnapshot },
          {
            tag: 'provider-disconnected' as const,
            providerId: 'cli:session-1',
            message: 'foreign provider disconnected',
          },
        ),
      },
    })
    const services = await makeAppServices({ core })

    await expect(services.loadModelWorkbench(modelDescriptor)).rejects.toThrow(
      'expected provider browser-local',
    )
    await expect(services.loadDevelopmentWorkbench(developmentDescriptor)).rejects.toThrow(
      'expected provider browser-local',
    )
    await expect(
      services.loadDevelopmentProjectModel(developmentDescriptor, 'orders'),
    ).rejects.toThrow('expected provider browser-local')
    await expect(
      Effect.runPromise(Stream.runCollect(services.workspaceEvents(developmentDescriptor))),
    ).rejects.toThrow('expected provider browser-local')
  })

  test('rejects a workspace snapshot whose id does not match its root identity', async () => {
    const source = legacySourceRef('/fake/workspace', 'browser-local')
    const descriptor: DevelopmentWorkbenchDescriptor = {
      id: sourceKey(source),
      source,
      name: 'workspace',
      kind: 'development',
      route: 'overview',
      openedAt: '2026-08-29T12:00:00.000Z',
      lastUsedAt: '2026-08-29T12:00:00.000Z',
    }
    const { core } = makeFakeCore({
      providers: [
        {
          id: 'browser-local',
          name: 'This browser',
          kind: 'local',
          status: 'available',
          capabilities: [],
        },
      ],
      development: {
        snapshot: {
          id: 'stale-id',
          root: source,
          name: null,
          configAnchor: null,
          state: 'open',
          projects: [],
          modelSources: [],
          knowledgeBaseSources: [],
          diagnostics: [],
        },
      },
    })
    const services = await makeAppServices({ core })

    await expect(services.loadDevelopmentWorkbench(descriptor)).rejects.toThrow(
      'Workspace snapshot identity does not match its root',
    )
  })

  test('rejects a provider-disconnected event for a different provider', async () => {
    const source = legacySourceRef('/fake/workspace', 'browser-local')
    const descriptor: DevelopmentWorkbenchDescriptor = {
      id: sourceKey(source),
      source,
      name: 'workspace',
      kind: 'development',
      route: 'overview',
      openedAt: '2026-08-29T12:00:00.000Z',
      lastUsedAt: '2026-08-29T12:00:00.000Z',
    }
    const { core } = makeFakeCore({
      providers: [
        {
          id: 'browser-local',
          name: 'This browser',
          kind: 'local',
          status: 'available',
          capabilities: [],
        },
      ],
      development: {
        events: Stream.make({
          tag: 'provider-disconnected' as const,
          providerId: 'cli:session-1',
          message: 'foreign provider disconnected',
        }),
      },
    })
    const services = await makeAppServices({ core })

    await expect(
      Effect.runPromise(Stream.runCollect(services.workspaceEvents(descriptor))),
    ).rejects.toThrow('expected provider browser-local')
  })

  test('keeps project errors distinct from provider disconnection events', async () => {
    const source = legacySourceRef('/fake/workspace', 'browser-local')
    const descriptor: DevelopmentWorkbenchDescriptor = {
      id: sourceKey(source),
      source,
      name: 'workspace',
      kind: 'development',
      route: 'overview',
      openedAt: '2026-08-29T12:00:00.000Z',
      lastUsedAt: '2026-08-29T12:00:00.000Z',
    }
    const snapshot: WorkspaceSnapshot = {
      id: sourceKey(source),
      root: source,
      name: 'workspace',
      configAnchor: 'morphir.toml',
      state: 'open',
      projects: [
        {
          id: projectKey(source, '.'),
          name: 'orders',
          version: null,
          relativePath: '.',
          configAnchor: 'morphir.toml',
          sourceDirectory: 'src',
          state: 'error',
          modelSources: [],
          knowledgeBaseSources: [],
          diagnostics: [],
        },
      ],
      modelSources: [],
      knowledgeBaseSources: [],
      diagnostics: [],
    }
    const disconnected = {
      tag: 'provider-disconnected' as const,
      providerId: 'browser-local',
      message: 'provider unavailable',
    }
    const { core } = makeFakeCore({
      providers: [
        {
          id: 'browser-local',
          name: 'This browser',
          kind: 'local',
          status: 'available',
          capabilities: [],
        },
      ],
      development: {
        events: Stream.make({ tag: 'snapshot' as const, snapshot }, disconnected),
      },
    })
    const services = await makeAppServices({ core })

    const events = await Effect.runPromise(Stream.runCollect(services.workspaceEvents(descriptor)))

    expect(Array.from(events)).toEqual([{ tag: 'snapshot', snapshot }, disconnected])
  })

  test('dispose releases scoped services exactly once', async () => {
    let finalizers = 0
    const configLayer = Layer.scoped(
      ConfigService,
      Effect.acquireRelease(
        Effect.succeed({
          load: Effect.succeed(defaultUiConfig),
          save: () => Effect.void,
        }),
        () => Effect.sync(() => void (finalizers += 1)),
      ),
    )
    const { core } = makeFakeCore({ configLayer })
    const services = await makeAppServices({ core })

    expect(finalizers).toBe(0)
    await services.dispose()
    await services.dispose()
    expect(finalizers).toBe(1)
  })

  test('dispose drains accepted config updates and rejects new updates', async () => {
    const events: string[] = []
    let config = defaultUiConfig
    let releaseFirstSave: () => void = () => undefined
    let markFirstSaveStarted: () => void = () => undefined
    const firstSaveStarted = new Promise<void>((resolve) => void (markFirstSaveStarted = resolve))
    const firstSaveGate = new Promise<void>((resolve) => void (releaseFirstSave = resolve))
    let saveCount = 0
    const configLayer = Layer.scoped(
      ConfigService,
      Effect.acquireRelease(
        Effect.succeed({
          load: Effect.sync(() => config),
          save: (next: UiConfig) =>
            Effect.promise(async () => {
              saveCount += 1
              events.push(`save-${saveCount}-start`)
              if (saveCount === 1) {
                markFirstSaveStarted()
                await firstSaveGate
              }
              config = next
              events.push(`save-${saveCount}-finish`)
            }),
        }),
        () => Effect.sync(() => void events.push('runtime-finalized')),
      ),
    )
    const { core } = makeFakeCore({ configLayer })
    const services = await makeAppServices({ core })
    const first = services.updateConfig((current) => ({
      ...current,
      github: { source: 'gh-cli' },
    }))
    const second = services.updateConfig((current) => ({
      ...current,
      workbenches: { ...current.workbenches, reopenOnLaunch: false },
    }))
    await firstSaveStarted

    const disposing = services.dispose()
    const repeated = services.dispose()
    await expect(services.updateConfig((current) => current)).rejects.toThrow(
      'App services are disposing',
    )
    expect(events).not.toContain('runtime-finalized')
    releaseFirstSave()
    await Promise.all([first, second, disposing, repeated])

    expect(config.github.source).toBe('gh-cli')
    expect(config.workbenches.reopenOnLaunch).toBe(false)
    expect(events).toEqual([
      'save-1-start',
      'save-1-finish',
      'save-2-start',
      'save-2-finish',
      'runtime-finalized',
    ])
  })

  test('dispose does not deadlock behind a failed accepted config update', async () => {
    let finalizers = 0
    const configLayer = Layer.scoped(
      ConfigService,
      Effect.acquireRelease(
        Effect.succeed({
          load: Effect.succeed(defaultUiConfig),
          save: () =>
            Effect.sync(() => {
              throw new Error('save failed')
            }),
        }),
        () => Effect.sync(() => void (finalizers += 1)),
      ),
    )
    const { core } = makeFakeCore({ configLayer })
    const services = await makeAppServices({ core })
    const update = services.updateConfig((current) => current)
    const disposing = services.dispose()

    await expect(update).rejects.toThrow('save failed')
    await disposing
    expect(finalizers).toBe(1)
  })

  test('exposes provider and development workspace capabilities', async () => {
    const source = legacySourceRef('/fake/workspace', 'browser-local')
    const descriptor: DevelopmentWorkbenchDescriptor = {
      id: sourceKey(source),
      source,
      name: 'workspace',
      kind: 'development',
      route: 'overview',
      openedAt: '2026-08-29T12:00:00.000Z',
      lastUsedAt: '2026-08-29T12:00:00.000Z',
    }
    const snapshot: WorkspaceSnapshot = {
      id: descriptor.id,
      root: source,
      name: 'workspace',
      configAnchor: '/fake/workspace/morphir.toml',
      state: 'open',
      projects: [],
      modelSources: [],
      knowledgeBaseSources: [],
      diagnostics: [],
    }
    const { core } = makeFakeCore({
      providers: [
        {
          id: 'browser-local',
          name: 'This browser',
          kind: 'local',
          status: 'available',
          capabilities: [{ name: 'morphir/model/open', version: '1' }],
        },
      ],
      development: {
        snapshot,
        events: Stream.make({ tag: 'snapshot' as const, snapshot }),
      },
    })
    const services = await makeAppServices({ core })

    expect(await services.listWorkbenchProviders()).toEqual([
      expect.objectContaining({ id: 'browser-local' }),
    ])
    expect((await services.loadDevelopmentWorkbench(descriptor)).snapshot).toEqual(snapshot)
    expect((await services.loadDevelopmentProjectModel(descriptor, 'packages/orders')).kind).toBe(
      'model',
    )
    expect(await Effect.runPromise(Stream.runHead(services.workspaceEvents(descriptor)))).toEqual(
      expect.objectContaining({ _tag: 'Some', value: { tag: 'snapshot', snapshot } }),
    )
  })

  test('exposes core services and capability flags without github', async () => {
    const { core } = makeFakeCore({ version: '9.9.9' })
    const services = await makeAppServices({ core })
    expect(await services.version()).toBe('9.9.9')
    expect(services.capabilities.github).toBe(false)
    expect(services.github).toBeNull()
    expect(services.capabilities.pipeline).toBe(false)
    expect(services.pipeline).toBeNull()
    const cfg = await services.loadConfig()
    expect(cfg).toEqual(defaultUiConfig)
  })
  test('config save round-trips', async () => {
    const { core, store } = makeFakeCore()
    const services = await makeAppServices({ core })
    const cfg = { ...defaultUiConfig, github: { source: 'gh-cli' as const } }
    await services.saveConfig(cfg)
    expect(store.config).toEqual(cfg)
    expect(await services.loadConfig()).toEqual(cfg)
  })
  test('workspace pick returns content; read capability follows the layer', async () => {
    const { core } = makeFakeCore({ workspaceContent: '{"formatVersion":3}', reopen: true })
    const services = await makeAppServices({ core })
    const picked = await services.pickWorkspace()
    expect(picked!.content).toBe('{"formatVersion":3}')
    expect(services.capabilities.reopenWorkspaces).toBe(true)
    expect(await services.readWorkspace!(picked!.ref)).toBe('{"formatVersion":3}')
  })
  test('updateConfig serializes concurrent read-modify-write calls', async () => {
    // A ConfigService whose load/save each take a beat, so two concurrent updateConfig calls
    // would interleave (and drop one mutation) if the facade did not serialize them.
    const store: { config: UiConfig } = { config: defaultUiConfig }
    const { core } = makeFakeCore({
      configLayer: Layer.succeed(ConfigService, {
        load: Effect.sleep('5 millis').pipe(Effect.andThen(() => Effect.sync(() => store.config))),
        save: (c) =>
          Effect.sleep('5 millis').pipe(
            Effect.andThen(() => Effect.sync(() => void (store.config = c))),
          ),
      }),
    })
    const services = await makeAppServices({ core })
    await Promise.all([
      services.updateConfig((cfg) => ({ ...cfg, github: { source: 'gh-cli' } })),
      services.updateConfig((cfg) => ({
        ...cfg,
        workbenches: { ...cfg.workbenches, reopenOnLaunch: false },
      })),
    ])
    expect(store.config.github.source).toBe('gh-cli')
    expect(store.config.workbenches.reopenOnLaunch).toBe(false)
  })
  test('github facade appears when the layer is provided', async () => {
    const { core } = makeFakeCore()
    const { github } = makeFakeGitHub({
      source: 'pat',
      pat: 'ghp_' + 'z'.repeat(36) + 'TAIL',
      login: 'octocat',
    })
    const services = await makeAppServices({ core, github })
    expect(services.capabilities.github).toBe(true)
    const status = await services.github!.status()
    expect(status).toEqual({ source: 'pat', tokenDisplay: 'Token(ghp_...TAIL)' })
    expect(await services.github!.verify()).toEqual({ login: 'octocat' })
    await services.github!.clearPat()
    expect((await services.github!.status()).tokenDisplay).toBeNull()
  })
  test('pipeline facade appears when only the pipeline layer is provided', async () => {
    const { core } = makeFakeCore()
    const { pipeline, calls } = makeFakePipeline({
      catalog: {
        frontends: [
          {
            languageId: 'morphir-elm',
            displayName: 'Elm',
            fileExtensions: ['.elm'],
            irVersions: ['3'],
            languagesDeclared: true,
            compile: true,
            provider: {
              extensionId: 'morphir-elm',
              extensionName: 'Elm',
              version: null,
              kind: 'builtin',
              selection: null,
            },
          },
        ],
        targets: [],
      },
    })
    const services = await makeAppServices({ core, pipeline })
    expect(services.capabilities.pipeline).toBe(true)
    expect(services.capabilities.github).toBe(false)
    expect(services.github).toBeNull()
    const catalog = await services.pipeline!.catalog()
    expect(catalog.frontends.map((f) => f.languageId)).toEqual(['morphir-elm'])
    const compileInput = {
      languageId: 'morphir-elm',
      documents: [
        { uri: 'file:///Main.elm', languageId: 'morphir-elm', version: 1, text: 'x = 1' },
      ],
      package: { name: 'Test', exposedModules: ['Main'] },
      irVersion: '3',
      options: {},
    }
    const compileResult = await services.pipeline!.compile(compileInput)
    expect(compileResult.modules).toEqual(['Main'])
    expect(calls.compile).toEqual([compileInput])
    const generateInput = { ir: {}, irVersion: '3', target: 'scala', options: {} }
    await services.pipeline!.generate(generateInput)
    expect(calls.generate).toEqual([generateInput])
  })
  test('github and pipeline facades both appear when both layers are provided', async () => {
    const { core } = makeFakeCore()
    const { github } = makeFakeGitHub({
      source: 'pat',
      pat: 'ghp_' + 'z'.repeat(36) + 'TAIL',
      login: 'octocat',
    })
    const { pipeline } = makeFakePipeline()
    const services = await makeAppServices({ core, github, pipeline })
    expect(services.capabilities.github).toBe(true)
    expect(services.capabilities.pipeline).toBe(true)
    expect(services.github).not.toBeNull()
    expect(services.pipeline).not.toBeNull()
    expect(await services.github!.verify()).toEqual({ login: 'octocat' })
    expect((await services.pipeline!.catalog()).frontends).toEqual([])
  })
})
