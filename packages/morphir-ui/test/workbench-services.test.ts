import { Effect, Layer, Option, Stream } from 'effect'
import { sourceKey, type WorkspaceSnapshot } from '@morphir/workspace'
import { describe, expect, test } from 'vitest'
import {
  DevelopmentWorkbenchService,
  ModelWorkbenchService,
  WorkbenchError,
  WorkbenchProviderService,
  WorkbenchSourceService,
  loadWorkbench,
  loadDevelopmentProjectModel,
  legacySourceRef,
  openWorkbench,
  type DevelopmentWorkbenchDescriptor,
  type ModelWorkbenchDescriptor,
} from '../src/index.ts'

const timestamp = '2026-08-29T12:00:00.000Z'
const modelSource = legacySourceRef('/canonical/model.json')
const developmentSource = legacySourceRef('/canonical/dev')

const modelDescriptor: ModelWorkbenchDescriptor = {
  id: sourceKey(modelSource),
  source: modelSource,
  name: 'model.json',
  kind: 'model',
  distribution: 'single-file',
  route: 'overview',
  openedAt: timestamp,
  lastUsedAt: timestamp,
}

const developmentDescriptor: DevelopmentWorkbenchDescriptor = {
  id: sourceKey(developmentSource),
  source: developmentSource,
  name: 'dev',
  kind: 'development',
  route: 'overview',
  openedAt: timestamp,
  lastUsedAt: timestamp,
}

const workspaceSnapshot: WorkspaceSnapshot = {
  id: sourceKey(developmentSource),
  root: developmentSource,
  name: 'dev',
  configAnchor: '/canonical/dev/morphir.toml',
  state: 'open',
  projects: [],
  modelSources: [],
  knowledgeBaseSources: [],
  diagnostics: [],
}

const sourceLayer = Layer.succeed(WorkbenchSourceService, {
  inspect: (source) =>
    Effect.succeed(source.locator.endsWith('.json') ? modelDescriptor : developmentDescriptor),
  pick: () => Effect.succeed(Option.none()),
  reveal: () => Effect.void,
})

const modelLayer = Layer.succeed(ModelWorkbenchService, {
  load: (descriptor) =>
    Effect.succeed({
      kind: 'model' as const,
      descriptor,
      library: null,
      ir: null,
      manifest: null,
    }),
})

const developmentLayer = Layer.succeed(DevelopmentWorkbenchService, {
  load: (descriptor) =>
    Effect.succeed({
      kind: 'development' as const,
      descriptor,
      snapshot: workspaceSnapshot,
    }),
  loadProjectModel: (_descriptor, _projectId) =>
    Effect.succeed({
      kind: 'model' as const,
      descriptor: modelDescriptor,
      library: null,
      ir: null,
      manifest: null,
    }),
  events: () => Stream.make({ tag: 'snapshot' as const, snapshot: workspaceSnapshot }),
})

const providerLayer = Layer.succeed(WorkbenchProviderService, {
  list: Effect.succeed([
    {
      id: 'browser-local',
      name: 'This browser',
      kind: 'local' as const,
      status: 'available' as const,
      capabilities: [{ name: 'morphir/model/open', version: '1' }],
    },
  ]),
})

const services = Layer.mergeAll(sourceLayer, modelLayer, developmentLayer, providerLayer)

describe('Workbench Effect services', () => {
  test('open workflow rejects inspection results from another provider before loading', async () => {
    const requested = legacySourceRef('/model.json', 'browser-local')
    const foreignSource = { ...requested, providerId: 'cli:session-1' }
    let loadCalls = 0
    const rogueSourceLayer = Layer.succeed(WorkbenchSourceService, {
      inspect: () =>
        Effect.succeed({ ...modelDescriptor, id: sourceKey(foreignSource), source: foreignSource }),
      pick: () => Effect.succeed(Option.none()),
      reveal: () => Effect.void,
    })
    const trackingModelLayer = Layer.succeed(ModelWorkbenchService, {
      load: (descriptor) => {
        loadCalls += 1
        return Effect.succeed({
          kind: 'model' as const,
          descriptor,
          library: null,
          ir: null,
          manifest: null,
        })
      },
    })

    const error = await Effect.runPromise(
      Effect.flip(
        openWorkbench(requested).pipe(
          Effect.provide(Layer.mergeAll(rogueSourceLayer, trackingModelLayer, developmentLayer)),
        ),
      ),
    )

    expect(error.code).toBe('unsupported-capability')
    expect(loadCalls).toBe(0)
  })

  test('open workflow inspects then loads the detected model kind', async () => {
    const result = await Effect.runPromise(
      openWorkbench(legacySourceRef('/model.json')).pipe(Effect.provide(services)),
    )

    expect(result.descriptor.source.locator).toBe('/canonical/model.json')
    expect(result.data.kind).toBe('model')
  })

  test('load workflow selects the development capability from the descriptor', async () => {
    const result = await Effect.runPromise(
      loadWorkbench(developmentDescriptor).pipe(Effect.provide(services)),
    )

    expect(result.kind).toBe('development')
    if (result.kind !== 'development') throw new Error('Expected Development Workbench data')
    expect(result.snapshot).toEqual(workspaceSnapshot)
  })

  test('project workflow delegates to the development capability', async () => {
    const result = await Effect.runPromise(
      loadDevelopmentProjectModel(developmentDescriptor, 'packages/orders').pipe(
        Effect.provide(services),
      ),
    )

    expect(result.descriptor).toEqual(modelDescriptor)
  })

  test('typed source failures remain in the Effect error channel', async () => {
    const failureLayer = Layer.succeed(WorkbenchSourceService, {
      inspect: (source) =>
        Effect.fail(
          new WorkbenchError({
            code: 'not-found',
            source,
            message: `Workbench source not found: ${source}`,
          }),
        ),
      pick: () => Effect.succeed(Option.none()),
      reveal: () => Effect.void,
    })

    const result = await Effect.runPromise(
      Effect.flip(
        openWorkbench(legacySourceRef('/missing')).pipe(
          Effect.provide(Layer.mergeAll(failureLayer, modelLayer, developmentLayer)),
        ),
      ),
    )

    expect(result.code).toBe('not-found')
    expect(result.source).toEqual(legacySourceRef('/missing'))
  })
})
