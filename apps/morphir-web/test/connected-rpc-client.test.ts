import { Effect, Fiber, Option, Schema, Stream } from 'effect'
import { describe, expect, test } from 'vitest'
import {
  CONNECTED_METHODS,
  WorkspaceWatchResultSchema,
  type ConnectedSessionManifest,
} from '@morphir/workspace'
import {
  makeConnectedRpcClient,
  type ConnectedWebSocket,
  type ReconnectScheduler,
} from '../src/connected/rpc-client.ts'

class FakeSocket implements ConnectedWebSocket {
  readonly sent: Array<string> = []
  closeCount = 0
  onOpen: (() => void) | null = null
  onMessage: ((data: string) => void) | null = null
  onClose: ((reason: string) => void) | null = null

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    this.closeCount += 1
  }

  open(): void {
    this.onOpen?.()
  }

  receive(value: unknown): void {
    this.onMessage?.(JSON.stringify(value))
  }

  disconnect(reason = 'connection lost'): void {
    this.onClose?.(reason)
  }

  requests(): ReadonlyArray<Record<string, unknown>> {
    return this.sent.map((message) => JSON.parse(message) as Record<string, unknown>)
  }
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
  initialSources: [
    {
      providerId: 'cli:session-1',
      locator: 'workspace:initial',
      displayName: 'orders',
    },
  ],
}

const setup = (maximumRequestBytes = 1024) => {
  const sockets: Array<FakeSocket> = []
  const retries: Array<() => void> = []
  const scheduler: ReconnectScheduler = (_attempt, reconnect) => {
    retries.push(reconnect)
    return () => undefined
  }
  const client = makeConnectedRpcClient({
    manifest,
    pageUrl: new URL('http://127.0.0.1:4242/'),
    maximumRequestBytes,
    webSocketFactory: () => {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    },
    scheduleReconnect: scheduler,
  })
  return { client, sockets, retries }
}

const initialize = async (socket: FakeSocket): Promise<void> => {
  socket.open()
  const request = socket.requests()[0]!
  expect(request.method).toBe(CONNECTED_METHODS.initialize)
  expect(request.params).toEqual({ protocolVersion: 1, sessionId: 'session-1' })
  socket.receive({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: 1 } })
  await Promise.resolve()
}

describe('connected JSON-RPC client', () => {
  test('initializes first and resolves out-of-order responses by monotonically increasing ID', async () => {
    const { client, sockets } = setup()
    await initialize(sockets[0]!)

    const first = Effect.runPromise(client.call('example.first', { value: 1 }, Schema.String))
    const second = Effect.runPromise(client.call('example.second', { value: 2 }, Schema.String))
    await Promise.resolve()
    const [initializeRequest, firstRequest, secondRequest] = sockets[0]!.requests()
    expect([initializeRequest?.id, firstRequest?.id, secondRequest?.id]).toEqual([1, 2, 3])

    sockets[0]!.receive({ jsonrpc: '2.0', id: secondRequest?.id, result: 'second' })
    sockets[0]!.receive({ jsonrpc: '2.0', id: firstRequest?.id, result: 'first' })
    await expect(Promise.all([first, second])).resolves.toEqual(['first', 'second'])
  })

  test('publishes notifications and rejects unknown response IDs or oversized requests', async () => {
    const { client, sockets } = setup(256)
    await initialize(sockets[0]!)
    const notification = Effect.runPromise(Stream.runHead(client.notifications))
    await Promise.resolve()
    sockets[0]!.receive({
      jsonrpc: '2.0',
      method: CONNECTED_METHODS.workspaceEvent,
      params: {
        subscriptionId: 'watch-1',
        event: {
          tag: 'provider-disconnected',
          providerId: 'cli:session-1',
          message: 'closed',
        },
      },
    })
    expect(Option.getOrThrow(await notification)).toMatchObject({
      tag: 'notification',
      method: CONNECTED_METHODS.workspaceEvent,
    })

    sockets[0]!.receive({ jsonrpc: '2.0', id: 999, result: null })
    expect(sockets[0]!.closeCount).toBe(1)

    const oversized = Effect.runPromise(
      Effect.flip(client.call('example.large', { value: 'x'.repeat(512) }, Schema.String)),
    )
    await expect(oversized).resolves.toMatchObject({ code: 'read-failed' })
  })

  test('accepts host responses larger than the browser request limit', async () => {
    const { client, sockets } = setup(256)
    await initialize(sockets[0]!)

    const pending = Effect.runPromise(client.call('example.large-response', {}, Schema.String))
    await Promise.resolve()
    const request = sockets[0]!.requests()[1]!
    const result = 'x'.repeat(512)
    sockets[0]!.receive({ jsonrpc: '2.0', id: request.id, result })

    await expect(pending).resolves.toBe(result)
    expect(sockets[0]!.closeCount).toBe(0)
  })

  test('emits one disconnect and reconnects the same session with active watches restored', async () => {
    const { client, sockets, retries } = setup()
    await initialize(sockets[0]!)
    const source = manifest.initialSources[0]!
    const watch = Effect.runPromise(
      client.call(CONNECTED_METHODS.workspaceWatch, { source }, WorkspaceWatchResultSchema),
    )
    await Promise.resolve()
    const watchRequest = sockets[0]!.requests()[1]!
    sockets[0]!.receive({
      jsonrpc: '2.0',
      id: watchRequest.id,
      result: { subscriptionId: 'watch-1' },
    })
    await watch

    const disconnected = Effect.runPromise(Stream.runHead(client.notifications))
    await Promise.resolve()
    sockets[0]!.disconnect('network unavailable')
    expect(Option.getOrThrow(await disconnected)).toEqual({
      tag: 'disconnected',
      message: 'network unavailable',
    })
    sockets[0]!.disconnect('duplicate close')
    expect(retries).toHaveLength(1)

    retries[0]!()
    expect(sockets).toHaveLength(2)
    await initialize(sockets[1]!)
    await Promise.resolve()
    const restored = sockets[1]!.requests()[1]!
    expect(restored.method).toBe(CONNECTED_METHODS.workspaceWatch)
    expect(restored.params).toEqual({ source })
    sockets[1]!.receive({
      jsonrpc: '2.0',
      id: restored.id,
      result: { subscriptionId: 'watch-2' },
    })
    await Promise.resolve()

    const notification = Effect.runPromise(Stream.runHead(client.notifications))
    await Promise.resolve()
    sockets[1]!.receive({
      jsonrpc: '2.0',
      method: CONNECTED_METHODS.workspaceEvent,
      params: {
        subscriptionId: 'watch-2',
        event: { tag: 'provider-disconnected', providerId: 'cli:session-1', message: 'event' },
      },
    })
    expect(Option.getOrThrow(await notification)).toMatchObject({
      params: { subscriptionId: 'watch-1' },
    })

    const unwatch = Effect.runPromise(
      client.call(
        CONNECTED_METHODS.workspaceUnwatch,
        { subscriptionId: 'watch-1' },
        Schema.Struct({ removed: Schema.Boolean }),
      ),
    )
    await Promise.resolve()
    const unwatchRequest = sockets[1]!.requests()[2]!
    expect(unwatchRequest.params).toEqual({ subscriptionId: 'watch-2' })
    sockets[1]!.receive({ jsonrpc: '2.0', id: unwatchRequest.id, result: { removed: true } })
    await expect(unwatch).resolves.toEqual({ removed: true })
  })

  test('retains logical watches when a reconnect drops during resubscription', async () => {
    const { client, sockets, retries } = setup()
    await initialize(sockets[0]!)
    const source = manifest.initialSources[0]!
    const watch = Effect.runPromise(
      client.call(CONNECTED_METHODS.workspaceWatch, { source }, WorkspaceWatchResultSchema),
    )
    await Promise.resolve()
    const initialWatch = sockets[0]!.requests()[1]!
    sockets[0]!.receive({
      jsonrpc: '2.0',
      id: initialWatch.id,
      result: { subscriptionId: 'watch-1' },
    })
    await watch

    sockets[0]!.disconnect()
    retries[0]!()
    await initialize(sockets[1]!)
    expect(sockets[1]!.requests()[1]!.method).toBe(CONNECTED_METHODS.workspaceWatch)
    sockets[1]!.disconnect('dropped while restoring')

    retries[1]!()
    await initialize(sockets[2]!)
    expect(sockets[2]!.requests()[1]!.method).toBe(CONNECTED_METHODS.workspaceWatch)
    expect(sockets[2]!.requests()[1]!.params).toEqual({ source })
    await Effect.runPromise(client.close)
  })

  test('disposal stops reconnects and rejects pending calls', async () => {
    const { client, sockets, retries } = setup()
    await initialize(sockets[0]!)
    const pending = Effect.runPromise(
      Effect.flip(client.call('example.pending', {}, Schema.String)),
    )
    await Promise.resolve()
    await Effect.runPromise(client.close)

    await expect(pending).resolves.toMatchObject({ code: 'provider-disconnected' })
    expect(sockets[0]!.closeCount).toBe(1)
    expect(retries).toHaveLength(0)
  })

  test('removes a cancelled queued watch before initialization', async () => {
    const { client, sockets } = setup()
    const watch = Effect.runFork(
      client.call(
        CONNECTED_METHODS.workspaceWatch,
        { source: manifest.initialSources[0]! },
        WorkspaceWatchResultSchema,
      ),
    )
    await Promise.resolve()

    await Effect.runPromise(Fiber.interrupt(watch))
    await initialize(sockets[0]!)

    expect(sockets[0]!.requests().map(({ method }) => method)).toEqual([
      CONNECTED_METHODS.initialize,
    ])
  })

  test('unwatches a server subscription accepted after its watch was cancelled', async () => {
    const { client, sockets, retries } = setup()
    await initialize(sockets[0]!)
    const watch = Effect.runFork(
      client.call(
        CONNECTED_METHODS.workspaceWatch,
        { source: manifest.initialSources[0]! },
        WorkspaceWatchResultSchema,
      ),
    )
    await Promise.resolve()
    const watchRequest = sockets[0]!.requests()[1]!

    await Effect.runPromise(Fiber.interrupt(watch))
    sockets[0]!.receive({
      jsonrpc: '2.0',
      id: watchRequest.id,
      result: { subscriptionId: 'cancelled-watch' },
    })
    await Promise.resolve()

    const unwatchRequest = sockets[0]!.requests()[2]!
    expect(unwatchRequest).toMatchObject({
      method: CONNECTED_METHODS.workspaceUnwatch,
      params: { subscriptionId: 'cancelled-watch' },
    })
    sockets[0]!.receive({
      jsonrpc: '2.0',
      id: unwatchRequest.id,
      result: { removed: true },
    })
    sockets[0]!.disconnect()
    retries[0]!()
    await initialize(sockets[1]!)
    expect(sockets[1]!.requests()).toHaveLength(1)
  })
})
