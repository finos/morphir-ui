import { Effect, Option, Stream } from 'effect'
import { describe, expect, test } from 'vitest'
import { sourceKey, type WorkbenchProvider, type WorkbenchSourceRef } from '@morphir/workspace'
import {
  DevelopmentWorkbenchService,
  ModelWorkbenchService,
  WorkbenchProviderService,
  WorkbenchSourceService,
  makeWorkbenchProviderLayers,
  type DevelopmentWorkbenchDescriptor,
  type ModelWorkbenchDescriptor,
  type WorkbenchProviderAdapter,
} from '../src/index.ts'

const timestamp = '2026-08-31T12:00:00.000Z'

const provider = (id: string, kind: 'local' | 'connected'): WorkbenchProvider => ({
  id,
  name: id,
  kind,
  status: 'available',
  capabilities: [],
})

const source = (providerId: string, locator = 'workspace:initial'): WorkbenchSourceRef => ({
  providerId,
  locator,
  displayName: `${providerId} source`,
})

const developmentDescriptor = (providerId: string): DevelopmentWorkbenchDescriptor => {
  const root = source(providerId)
  return {
    id: sourceKey(root),
    source: root,
    name: root.displayName,
    kind: 'development',
    route: 'overview',
    openedAt: timestamp,
    lastUsedAt: timestamp,
  }
}

const modelDescriptor = (providerId: string): ModelWorkbenchDescriptor => {
  const root = source(providerId, 'model:1')
  return {
    id: sourceKey(root),
    source: root,
    name: root.displayName,
    kind: 'model',
    distribution: 'single-file',
    route: 'overview',
    openedAt: timestamp,
    lastUsedAt: timestamp,
  }
}

const adapter = (
  id: string,
  kind: 'local' | 'connected',
  calls: Array<string>,
): WorkbenchProviderAdapter => ({
  provider: provider(id, kind),
  inspect: (requested) => {
    calls.push(`${id}:inspect:${requested.locator}`)
    return Effect.succeed(developmentDescriptor(id))
  },
  pick: (pickerKind) => {
    calls.push(`${id}:pick:${pickerKind}`)
    return Effect.succeed(Option.some(source(id, 'picked')))
  },
  release: (requested) => Effect.sync(() => void calls.push(`${id}:release:${requested.locator}`)),
  reveal: (requested) => Effect.sync(() => void calls.push(`${id}:reveal:${requested.locator}`)),
  loadModel: (descriptor) => {
    calls.push(`${id}:model:${descriptor.source.locator}`)
    return Effect.succeed({ kind: 'model', descriptor, library: null, ir: null, manifest: null })
  },
  loadDevelopment: (descriptor) => {
    calls.push(`${id}:development:${descriptor.source.locator}`)
    return Effect.succeed({
      kind: 'development',
      descriptor,
      snapshot: {
        id: descriptor.id,
        root: descriptor.source,
        name: descriptor.name,
        configAnchor: null,
        state: 'open',
        projects: [],
        modelSources: [],
        knowledgeBaseSources: [],
        diagnostics: [],
      },
    })
  },
  loadProjectModel: (_descriptor, projectId) => {
    calls.push(`${id}:project:${projectId}`)
    const descriptor = modelDescriptor(id)
    return Effect.succeed({ kind: 'model', descriptor, library: null, ir: null, manifest: null })
  },
  events: (descriptor) => {
    calls.push(`${id}:events:${descriptor.source.locator}`)
    return Stream.make({
      tag: 'provider-disconnected' as const,
      providerId: id,
      message: `${id} disconnected`,
    })
  },
})

describe('Workbench provider router', () => {
  test('lists providers stably and routes source-bound operations by provider ID', async () => {
    const calls: Array<string> = []
    const layer = makeWorkbenchProviderLayers(
      [adapter('browser-local', 'local', calls), adapter('cli:session-1', 'connected', calls)],
      'browser-local',
    )

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const providers = yield* WorkbenchProviderService
        const sources = yield* WorkbenchSourceService
        const models = yield* ModelWorkbenchService
        const development = yield* DevelopmentWorkbenchService
        const remoteDescriptor = developmentDescriptor('cli:session-1')
        yield* sources.inspect(remoteDescriptor.source)
        yield* models.load(modelDescriptor('cli:session-1'))
        yield* development.load(remoteDescriptor)
        yield* development.loadProjectModel(remoteDescriptor, 'project-1')
        const events = yield* Stream.runCollect(development.events(remoteDescriptor))
        return { providers: yield* providers.list, events: Array.from(events) }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.providers.map(({ id }) => id)).toEqual(['browser-local', 'cli:session-1'])
    expect(calls).toEqual([
      'cli:session-1:inspect:workspace:initial',
      'cli:session-1:model:model:1',
      'cli:session-1:development:workspace:initial',
      'cli:session-1:project:project-1',
      'cli:session-1:events:workspace:initial',
    ])
    expect(result.events[0]).toMatchObject({
      tag: 'provider-disconnected',
      providerId: 'cli:session-1',
    })
  })

  test('uses the configured local adapter for picker operations', async () => {
    const calls: Array<string> = []
    const layer = makeWorkbenchProviderLayers(
      [adapter('browser-local', 'local', calls), adapter('cli:session-1', 'connected', calls)],
      'browser-local',
    )

    const picked = await Effect.runPromise(
      Effect.gen(function* () {
        const sources = yield* WorkbenchSourceService
        return yield* sources.pick('folder')
      }).pipe(Effect.provide(layer)),
    )

    expect(Option.getOrThrow(picked).providerId).toBe('browser-local')
    expect(calls).toEqual(['browser-local:pick:folder'])
  })

  test('rejects duplicate adapters, missing defaults, and unknown providers', async () => {
    const calls: Array<string> = []
    const browser = adapter('browser-local', 'local', calls)
    expect(() => makeWorkbenchProviderLayers([browser, browser], 'browser-local')).toThrow(
      'Duplicate Workbench provider ID',
    )
    expect(() => makeWorkbenchProviderLayers([browser], 'missing')).toThrow(
      'Default picker provider',
    )

    const error = await Effect.runPromise(
      Effect.gen(function* () {
        const sources = yield* WorkbenchSourceService
        return yield* Effect.flip(sources.inspect(source('unknown')))
      }).pipe(Effect.provide(makeWorkbenchProviderLayers([browser], 'browser-local'))),
    )
    expect(error.code).toBe('unsupported-capability')
    expect(error.message).toContain('Unknown Workbench provider unknown')
  })
})
