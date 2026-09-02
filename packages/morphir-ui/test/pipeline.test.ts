import { Effect, Layer } from 'effect'
import { describe, expect, test } from 'vitest'
import { PipelineService, WorkbenchError } from '../src/index.ts'

const stubPipeline = Layer.succeed(PipelineService, {
  catalog: Effect.succeed({ frontends: [], targets: [] }),
  compile: () =>
    Effect.succeed({ success: true, irVersion: '3', ir: {}, diagnostics: [], modules: ['Main'] }),
  generate: () => Effect.succeed({ success: true, artifacts: [], diagnostics: [] }),
})

describe('PipelineService', () => {
  test('a catalog can be read through the tag', async () => {
    const catalog = await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(PipelineService, (service) => service.catalog),
        stubPipeline,
      ),
    )

    expect(catalog.frontends).toEqual([])
  })

  test('a failing pipeline surfaces a WorkbenchError', async () => {
    const failing = Layer.succeed(PipelineService, {
      catalog: Effect.fail(
        new WorkbenchError({
          code: 'unsupported-capability',
          source: '<connected-host>',
          message: 'This session has no playground capability',
        }),
      ),
      compile: () => Effect.die('unused'),
      generate: () => Effect.die('unused'),
    })

    const result = await Effect.runPromise(
      Effect.either(
        Effect.provide(
          Effect.flatMap(PipelineService, (s) => s.catalog),
          failing,
        ),
      ),
    )

    expect(result._tag).toBe('Left')
    if (result._tag === 'Left') {
      expect(result.left.code).toBe('unsupported-capability')
    }
  })
})
