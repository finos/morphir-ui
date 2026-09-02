import { Effect, Schema, Stream } from 'effect'
import { describe, expect, test } from 'vitest'
import { PipelineService, WorkbenchError } from '@morphir/ui'
import { makeConnectedPipeline } from '../src/connected/pipeline.ts'
import type { ConnectedRpcClient } from '../src/connected/rpc-client.ts'

const fakeClient = (calls: Array<string>, result: unknown): ConnectedRpcClient => ({
  manifest: {
    protocolVersion: 1,
    webSocketPath: '/rpc',
    sessionId: 'session-1',
    providers: [],
    initialSources: [],
  },
  notifications: Stream.empty,
  call: (<A>(method: string, _params: unknown, schema: Schema.Schema<A>) => {
    calls.push(method)
    return Schema.decodeUnknownEither(schema)(result).pipe(
      Effect.mapError(
        (error) =>
          new WorkbenchError({
            code: 'read-failed',
            source: '<connected-host>',
            message: String(error),
          }),
      ),
    )
  }) as ConnectedRpcClient['call'],
  close: Effect.void,
})

describe('connected pipeline', () => {
  test('a catalog call uses the catalog method and decodes the result', async () => {
    const calls: Array<string> = []
    const client = fakeClient(calls, { frontends: [], targets: [] })

    const catalog = await Effect.runPromise(
      Effect.provide(Effect.flatMap(PipelineService, (s) => s.catalog), makeConnectedPipeline(client)),
    )

    expect(calls).toEqual(['morphir.playground.catalog'])
    expect(catalog.targets).toEqual([])
  })

  test('a compile with diagnostics succeeds rather than failing the effect', async () => {
    const client = fakeClient([], {
      success: false,
      irVersion: null,
      ir: null,
      modules: [],
      diagnostics: [{ severity: 'error', code: null, message: 'boom', location: null }],
    })

    const result = await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(PipelineService, (s) =>
          s.compile({
            languageId: 'elm',
            documents: [],
            package: { name: 'local/main', exposedModules: ['Main'] },
            irVersion: '3',
            options: {},
          }),
        ),
        makeConnectedPipeline(client),
      ),
    )

    expect(result.success).toBe(false)
    expect(result.diagnostics[0]?.message).toBe('boom')
  })

  test('a malformed response fails with a WorkbenchError rather than yielding bad data', async () => {
    const client = fakeClient([], { frontends: 'nope' })

    const result = await Effect.runPromise(
      Effect.either(
        Effect.provide(Effect.flatMap(PipelineService, (s) => s.catalog), makeConnectedPipeline(client)),
      ),
    )

    expect(result._tag).toBe('Left')
  })
})
