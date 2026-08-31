import { Effect, Option, Stream } from 'effect'
import { describe, expect, test } from 'vitest'
import {
  CONNECTED_METHODS,
  sourceKey,
  type ConnectedNotification,
  type ConnectedSessionManifest,
  type WorkbenchSourceRef,
  type WorkspaceSnapshot,
} from '@morphir/workspace'
import { makeConnectedWorkbenchAdapters } from '../src/connected/connected-provider.ts'
import type { ConnectedRpcClient } from '../src/connected/rpc-client.ts'

const source: WorkbenchSourceRef = {
  providerId: 'cli:session-1',
  locator: 'workspace:initial',
  displayName: 'orders',
}
const timestamp = '2026-08-31T12:00:00.000Z'
const descriptor = {
  id: sourceKey(source),
  source,
  name: 'orders',
  kind: 'development' as const,
  route: 'overview' as const,
  openedAt: timestamp,
  lastUsedAt: timestamp,
}
const snapshot: WorkspaceSnapshot = {
  id: sourceKey(source),
  root: source,
  name: 'orders',
  configAnchor: 'morphir.yaml',
  state: 'open',
  projects: [],
  modelSources: [],
  knowledgeBaseSources: [],
  diagnostics: [],
}
const modelSource: WorkbenchSourceRef = {
  providerId: 'cli:session-1',
  locator: 'model:orders',
  displayName: 'orders / morphir-ir.json',
}
const projectModelResult = {
  descriptor: {
    id: sourceKey(modelSource),
    source: modelSource,
    name: 'orders',
    kind: 'model' as const,
    distribution: 'single-file' as const,
    route: 'explorer' as const,
    openedAt: timestamp,
    lastUsedAt: timestamp,
  },
  content: '{"formatVersion":3,"distribution":["Library",[],[],{"modules":[]}]}',
}
const manifest: ConnectedSessionManifest = {
  protocolVersion: 1,
  webSocketPath: '/rpc',
  sessionId: 'session-1',
  providers: [
    {
      id: 'cli:session-1',
      name: 'Morphir CLI',
      kind: 'connected',
      status: 'available',
      capabilities: [
        { name: 'morphir/development/inspect', version: '1' },
        { name: 'morphir/project-model/open', version: '1' },
        { name: 'morphir/workspace/open', version: '1' },
        { name: 'morphir/workspace/watch', version: '1' },
      ],
    },
  ],
  initialSources: [source],
}

const client = (
  notifications: Stream.Stream<ConnectedNotification> = Stream.empty,
  inspectResult: unknown = { descriptor },
): ConnectedRpcClient => ({
  manifest,
  notifications,
  call: ((method: string) => {
    switch (method) {
      case CONNECTED_METHODS.developmentInspect:
        return Effect.succeed(inspectResult)
      case CONNECTED_METHODS.workspaceOpen:
        return Effect.succeed({ snapshot })
      case CONNECTED_METHODS.projectModelOpen:
        return Effect.succeed(projectModelResult)
      case CONNECTED_METHODS.workspaceWatch:
        return Effect.succeed({ subscriptionId: 'watch-1' })
      case CONNECTED_METHODS.workspaceUnwatch:
        return Effect.succeed({ removed: true })
      default:
        return Effect.die(`Unexpected method ${method}`)
    }
  }) as ConnectedRpcClient['call'],
  close: Effect.void,
})

describe('connected Workbench provider', () => {
  test('inspects and opens a provider-qualified Development Workbench', async () => {
    const adapter = makeConnectedWorkbenchAdapters(client())[0]!

    await expect(Effect.runPromise(adapter.inspect(source))).resolves.toEqual(descriptor)
    await expect(Effect.runPromise(adapter.loadDevelopment(descriptor))).resolves.toEqual({
      kind: 'development',
      descriptor,
      snapshot,
    })
    expect(adapter.provider.id).toBe('cli:session-1')
  })

  test('opens and decodes a provider-qualified project model', async () => {
    const adapter = makeConnectedWorkbenchAdapters(client())[0]!

    const model = await Effect.runPromise(adapter.loadProjectModel(descriptor, 'project-1'))

    expect(model.descriptor).toEqual(projectModelResult.descriptor)
    expect(model.library?.modules).toEqual([])
    expect(model.ir?.modules).toEqual([])
  })

  test('rejects provider switching and unsupported connected operations', async () => {
    const foreign = { ...source, providerId: 'cli:other' }
    const adapter = makeConnectedWorkbenchAdapters(
      client(Stream.empty, {
        descriptor: { ...descriptor, id: sourceKey(foreign), source: foreign },
      }),
    )[0]!

    const inspectError = await Effect.runPromise(Effect.flip(adapter.inspect(source)))
    expect(inspectError.code).toBe('unsupported-capability')
    expect(Option.isNone(await Effect.runPromise(adapter.pick('folder')))).toBe(true)
  })

  test('maps qualified events and transport disconnects without changing provider identity', async () => {
    const notifications = Stream.fromIterable<ConnectedNotification>([
      {
        tag: 'notification',
        method: CONNECTED_METHODS.workspaceEvent,
        params: { subscriptionId: 'watch-1', event: { tag: 'snapshot', snapshot } },
      },
      { tag: 'disconnected', message: 'network unavailable' },
    ])
    const adapter = makeConnectedWorkbenchAdapters(client(notifications))[0]!
    const events = await Effect.runPromise(Stream.runCollect(adapter.events(descriptor)))

    expect(Array.from(events)).toEqual([
      { tag: 'snapshot', snapshot },
      {
        tag: 'provider-disconnected',
        providerId: 'cli:session-1',
        message: 'network unavailable',
      },
    ])
  })
})
