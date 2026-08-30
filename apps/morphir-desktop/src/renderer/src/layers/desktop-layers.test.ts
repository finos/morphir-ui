/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { Effect, Stream } from 'effect'
import {
  DevelopmentWorkbenchService,
  ModelWorkbenchService,
  WorkbenchSourceService,
  type DevelopmentWorkbenchDescriptor,
  type ModelWorkbenchDescriptor,
} from '@morphir/ui'
import { sourceKey } from '@morphir/workspace'
import { desktopCore } from './desktop-layers.ts'
import { RpcClient, type MorphirIpc } from './rpc-client.ts'

const timestamp = '2026-08-29T12:00:00.000Z'
const foreignSource = {
  providerId: 'cli:session-1',
  locator: '/shared/model.json',
  displayName: 'model.json',
}
const modelDescriptor: ModelWorkbenchDescriptor = {
  id: sourceKey(foreignSource),
  source: foreignSource,
  name: 'model.json',
  kind: 'model',
  distribution: 'single-file',
  route: 'overview',
  openedAt: timestamp,
  lastUsedAt: timestamp,
}
const developmentDescriptor: DevelopmentWorkbenchDescriptor = {
  id: sourceKey(foreignSource),
  source: foreignSource,
  name: 'workspace',
  kind: 'development',
  route: 'overview',
  openedAt: timestamp,
  lastUsedAt: timestamp,
}

describe('desktopCore provider pinning', () => {
  test('rejects foreign descriptors without invoking desktop RPC', async () => {
    const sent: unknown[] = []
    const ipc: MorphirIpc = {
      platform: 'darwin',
      postMessage: (message) => void sent.push(message),
      onMessage: () => () => undefined,
    }
    const core = desktopCore(new RpcClient(ipc))

    const modelError = await Effect.runPromise(
      Effect.flip(
        Effect.flatMap(ModelWorkbenchService, (service) => service.load(modelDescriptor)).pipe(
          Effect.provide(core),
        ),
      ),
    )
    const developmentError = await Effect.runPromise(
      Effect.flip(
        Effect.flatMap(DevelopmentWorkbenchService, (service) =>
          service.load(developmentDescriptor),
        ).pipe(Effect.provide(core)),
      ),
    )
    const projectError = await Effect.runPromise(
      Effect.flip(
        Effect.flatMap(DevelopmentWorkbenchService, (service) =>
          service.loadProjectModel(developmentDescriptor, 'orders'),
        ).pipe(Effect.provide(core)),
      ),
    )
    const eventError = await Effect.runPromise(
      Effect.flip(
        Effect.flatMap(DevelopmentWorkbenchService, (service) =>
          Stream.runCollect(service.events(developmentDescriptor)),
        ).pipe(Effect.provide(core)),
      ),
    )
    const inspectError = await Effect.runPromise(
      Effect.flip(
        Effect.flatMap(WorkbenchSourceService, (service) => service.inspect(foreignSource)).pipe(
          Effect.provide(core),
        ),
      ),
    )
    const revealError = await Effect.runPromise(
      Effect.flip(
        Effect.flatMap(WorkbenchSourceService, (service) => service.reveal(foreignSource)).pipe(
          Effect.provide(core),
        ),
      ),
    )

    expect(modelError).toMatchObject({ code: 'unsupported-capability' })
    expect(developmentError).toMatchObject({ code: 'unsupported-capability' })
    expect(projectError).toMatchObject({ code: 'unsupported-capability' })
    expect(eventError).toMatchObject({ code: 'unsupported-capability' })
    expect(inspectError).toMatchObject({ code: 'unsupported-capability' })
    expect(revealError).toMatchObject({ code: 'unsupported-capability' })
    expect(sent).toEqual([])
  })

  test('consumes a qualified picker result without rebuilding its identity', async () => {
    let onMessage: (message: unknown) => void = () => undefined
    const picked = {
      providerId: 'desktop-local',
      locator: '/picked/model.json',
      displayName: 'model.json',
    }
    const ipc: MorphirIpc = {
      platform: 'darwin',
      onMessage: (handler) => {
        onMessage = handler
        return () => void (onMessage = () => undefined)
      },
      postMessage: (message) => {
        const request = message as { id: number; method: string }
        if (request.method === 'morphir/workbench/pick') {
          queueMicrotask(() => onMessage({ id: request.id, result: { source: picked } }))
        }
      },
    }
    const core = desktopCore(new RpcClient(ipc))

    const result = await Effect.runPromise(
      Effect.flatMap(WorkbenchSourceService, (service) => service.pick('model-file')).pipe(
        Effect.provide(core),
      ),
    )

    expect(result).toMatchObject({ _tag: 'Some', value: picked })
  })
})
