/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { Effect, Stream } from 'effect'
import {
  DevelopmentWorkbenchService,
  ModelWorkbenchService,
  WorkbenchProviderService,
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
const localDevelopmentSource = {
  providerId: 'desktop-local',
  locator: '/workspace',
  displayName: 'workspace',
}
const localDevelopmentDescriptor: DevelopmentWorkbenchDescriptor = {
  ...developmentDescriptor,
  id: sourceKey(localDevelopmentSource),
  source: localDevelopmentSource,
}

const pickerErrorFor = async (source: unknown) => {
  let onMessage: (message: unknown) => void = () => undefined
  const ipc: MorphirIpc = {
    platform: 'darwin',
    onMessage: (handler) => {
      onMessage = handler
      return () => void (onMessage = () => undefined)
    },
    postMessage: (message) => {
      const request = message as { id: number; method: string }
      queueMicrotask(() => onMessage({ id: request.id, result: { source } }))
    },
  }
  return Effect.runPromise(
    Effect.flip(
      Effect.flatMap(WorkbenchSourceService, (service) => service.pick('model-file')).pipe(
        Effect.provide(desktopCore(new RpcClient(ipc))),
      ),
    ),
  )
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

  test('preserves the typed error for a foreign picker result', async () => {
    const error = await pickerErrorFor(foreignSource)

    expect(error).toMatchObject({
      code: 'unsupported-capability',
      source: foreignSource,
    })
  })

  test('reports a malformed qualified picker result as a detection failure', async () => {
    const malformed = { providerId: 'desktop-local', locator: '/picked/model.json' }
    const error = await pickerErrorFor(malformed)

    expect(error).toMatchObject({
      code: 'detection-failed',
      source: '<picker>',
    })
  })

  test('advertises the temporary desktop capabilities and workspace adapter', async () => {
    let onMessage: (message: unknown) => void = () => undefined
    const ipc: MorphirIpc = {
      platform: 'darwin',
      onMessage: (handler) => {
        onMessage = handler
        return () => void (onMessage = () => undefined)
      },
      postMessage: (message) => {
        const request = message as { id: number; method: string }
        if (request.method === 'morphir/workbench/inspectDevelopment') {
          queueMicrotask(() =>
            onMessage({
              id: request.id,
              result: {
                configAnchor: '/workspace/morphir.toml',
                modelSources: [],
                knowledgeBaseSources: [],
              },
            }),
          )
        }
      },
    }
    const core = desktopCore(new RpcClient(ipc))

    const providers = await Effect.runPromise(
      Effect.flatMap(WorkbenchProviderService, (service) => service.list).pipe(
        Effect.provide(core),
      ),
    )
    const workspace = await Effect.runPromise(
      Effect.flatMap(DevelopmentWorkbenchService, (service) =>
        service.load(localDevelopmentDescriptor),
      ).pipe(Effect.provide(core)),
    )
    const projectError = await Effect.runPromise(
      Effect.flip(
        Effect.flatMap(DevelopmentWorkbenchService, (service) =>
          service.loadProjectModel(localDevelopmentDescriptor, 'orders'),
        ).pipe(Effect.provide(core)),
      ),
    )
    const events = await Effect.runPromise(
      Effect.flatMap(DevelopmentWorkbenchService, (service) =>
        Stream.runCollect(service.events(localDevelopmentDescriptor)),
      ).pipe(Effect.provide(core)),
    )

    expect(providers).toEqual([
      {
        id: 'desktop-local',
        name: 'This computer',
        kind: 'local',
        status: 'available',
        capabilities: [
          { name: 'morphir/model/open', version: '1' },
          { name: 'morphir/development/inspect', version: '1' },
        ],
      },
    ])
    expect(workspace.snapshot).toEqual({
      id: localDevelopmentDescriptor.id,
      root: localDevelopmentSource,
      name: 'workspace',
      configAnchor: '/workspace/morphir.toml',
      state: 'open',
      projects: [],
      modelSources: [],
      knowledgeBaseSources: [],
      diagnostics: [],
    })
    expect(projectError).toMatchObject({ code: 'unsupported-capability' })
    expect(Array.from(events)).toEqual([])
  })
})
