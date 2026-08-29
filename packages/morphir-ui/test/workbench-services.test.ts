import { Effect, Layer, Option } from 'effect'
import { describe, expect, test } from 'vitest'
import {
  DevelopmentWorkbenchService,
  ModelWorkbenchService,
  WorkbenchError,
  WorkbenchSourceService,
  loadWorkbench,
  openWorkbench,
  type DevelopmentWorkbenchDescriptor,
  type ModelWorkbenchDescriptor,
} from '../src/index.ts'

const timestamp = '2026-08-29T12:00:00.000Z'

const modelDescriptor: ModelWorkbenchDescriptor = {
  id: '/canonical/model.json',
  source: '/canonical/model.json',
  name: 'model.json',
  kind: 'model',
  distribution: 'single-file',
  route: 'overview',
  openedAt: timestamp,
  lastUsedAt: timestamp,
}

const developmentDescriptor: DevelopmentWorkbenchDescriptor = {
  id: '/canonical/dev',
  source: '/canonical/dev',
  name: 'dev',
  kind: 'development',
  route: 'overview',
  openedAt: timestamp,
  lastUsedAt: timestamp,
}

const sourceLayer = Layer.succeed(WorkbenchSourceService, {
  inspect: (source) =>
    Effect.succeed(source.endsWith('.json') ? modelDescriptor : developmentDescriptor),
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
      configAnchor: descriptor.source,
      modelSources: [],
      knowledgeBaseSources: [],
    }),
})

const services = Layer.mergeAll(sourceLayer, modelLayer, developmentLayer)

describe('Workbench Effect services', () => {
  test('open workflow inspects then loads the detected model kind', async () => {
    const result = await Effect.runPromise(
      openWorkbench('/model.json').pipe(Effect.provide(services)),
    )

    expect(result.descriptor.source).toBe('/canonical/model.json')
    expect(result.data.kind).toBe('model')
  })

  test('load workflow selects the development capability from the descriptor', async () => {
    const result = await Effect.runPromise(
      loadWorkbench(developmentDescriptor).pipe(Effect.provide(services)),
    )

    expect(result.kind).toBe('development')
    if (result.kind !== 'development') throw new Error('Expected Development Workbench data')
    expect(result.configAnchor).toBe('/canonical/dev')
  })

  test('typed source failures remain in the Effect error channel', async () => {
    const failureLayer = Layer.succeed(WorkbenchSourceService, {
      inspect: (source: string) =>
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
        openWorkbench('/missing').pipe(
          Effect.provide(Layer.mergeAll(failureLayer, modelLayer, developmentLayer)),
        ),
      ),
    )

    expect(result.code).toBe('not-found')
    expect(result.source).toBe('/missing')
  })
})
