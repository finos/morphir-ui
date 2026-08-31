import { Effect, Schema, Stream } from 'effect'
import {
  CONNECTED_METHODS,
  ConnectedInitializeResultSchema,
  JsonValueSchema,
  JsonRpcErrorResponseSchema,
  JsonRpcNotificationSchema,
  JsonRpcSuccessResponseSchema,
  type ConnectedNotification,
  type ConnectedSessionManifest,
  type JsonValue,
} from '@morphir/workspace'
import { WorkbenchError } from '@morphir/ui'

export interface ConnectedWebSocket {
  onOpen: (() => void) | null
  onMessage: ((data: string) => void) | null
  onClose: ((reason: string) => void) | null
  send(data: string): void
  close(): void
}

export type ConnectedWebSocketFactory = (url: string) => ConnectedWebSocket
export type ReconnectScheduler = (attempt: number, reconnect: () => void) => () => void

export interface ConnectedRpcClient {
  readonly manifest: ConnectedSessionManifest
  readonly call: <A, I>(
    method: string,
    params: I,
    schema: Schema.Schema<A>,
  ) => Effect.Effect<A, WorkbenchError>
  readonly notifications: Stream.Stream<ConnectedNotification>
  readonly close: Effect.Effect<void>
}

export interface ConnectedRpcClientOptions {
  readonly manifest: ConnectedSessionManifest
  readonly pageUrl: URL
  readonly webSocketFactory?: ConnectedWebSocketFactory
  readonly maximumRequestBytes?: number
  readonly scheduleReconnect?: ReconnectScheduler
}

interface PendingCall {
  readonly method: string
  readonly params: JsonValue
  readonly decode: (value: unknown) => unknown
  readonly succeed: (value: unknown) => void
  readonly fail: (error: WorkbenchError) => void
  readonly watchAction?: WatchAction
  cancelled: boolean
  requestId?: number
}

interface ActiveWatch {
  readonly params: JsonValue
  serverSubscriptionId: string | null
}

type WatchAction =
  | { readonly tag: 'create' }
  | { readonly tag: 'restore'; readonly logicalId: string }
  | { readonly tag: 'remove'; readonly logicalId: string }

const disconnectedError = (message: string): WorkbenchError =>
  new WorkbenchError({
    code: 'provider-disconnected',
    source: '<connected-host>',
    message,
  })

const protocolError = (message: string): WorkbenchError =>
  new WorkbenchError({ code: 'read-failed', source: '<connected-host>', message })

const defaultWebSocketFactory: ConnectedWebSocketFactory = (url) => {
  const socket = new WebSocket(url)
  const bridge: ConnectedWebSocket = {
    onOpen: null,
    onMessage: null,
    onClose: null,
    send: (data) => socket.send(data),
    close: () => socket.close(),
  }
  socket.addEventListener('open', () => bridge.onOpen?.())
  socket.addEventListener('message', (event) => {
    if (typeof event.data === 'string') bridge.onMessage?.(event.data)
    else {
      bridge.onClose?.('Connected host sent a non-text WebSocket frame')
      socket.close()
    }
  })
  socket.addEventListener('close', (event) => bridge.onClose?.(event.reason || 'Connection closed'))
  socket.addEventListener('error', () => bridge.onClose?.('WebSocket connection failed'))
  return bridge
}

const defaultReconnectScheduler: ReconnectScheduler = (attempt, reconnect) => {
  const delay = Math.min(250 * 2 ** Math.max(0, attempt - 1), 4_000)
  const timer = globalThis.setTimeout(reconnect, delay)
  return () => globalThis.clearTimeout(timer)
}

const socketUrl = (pageUrl: URL, path: string): string => {
  const url = new URL(path, pageUrl)
  if (url.origin !== pageUrl.origin) {
    throw protocolError('Connected host WebSocket path resolved outside the page origin')
  }
  url.protocol = pageUrl.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}

export const makeConnectedRpcClient = ({
  manifest,
  pageUrl,
  webSocketFactory = defaultWebSocketFactory,
  maximumRequestBytes = 1024 * 1024,
  scheduleReconnect = defaultReconnectScheduler,
}: ConnectedRpcClientOptions): ConnectedRpcClient => {
  let socket: ConnectedWebSocket | null = null
  let requestId = 0
  let disposed = false
  let initialized = false
  let disconnectObserved = false
  let reconnectAttempt = 0
  let watchesRestoring = 0
  let cancelReconnect: (() => void) | null = null
  const pending = new Map<number, PendingCall>()
  const queued: Array<PendingCall> = []
  const activeWatches = new Map<string, ActiveWatch>()
  const notificationSubscribers = new Set<(notification: ConnectedNotification) => void>()

  const publish = (notification: ConnectedNotification): void => {
    for (const subscriber of notificationSubscribers) subscriber(notification)
  }

  const failPending = (message: string): void => {
    const error = disconnectedError(message)
    const calls = [...pending.values()]
    pending.clear()
    for (const call of calls) {
      if (!call.cancelled) call.fail(error)
    }
  }

  const serialize = (value: unknown): string => {
    const payload = JSON.stringify(value)
    if (new TextEncoder().encode(payload).byteLength > maximumRequestBytes) {
      throw protocolError(`Connected host request exceeds ${maximumRequestBytes} bytes`)
    }
    return payload
  }

  const send = (call: PendingCall): void => {
    if (call.cancelled) return
    if (!socket || !initialized) {
      queued.push(call)
      return
    }
    try {
      const id = ++requestId
      let wireParams = call.params
      if (call.watchAction?.tag === 'remove') {
        const watch = activeWatches.get(call.watchAction.logicalId)
        if (watch?.serverSubscriptionId === null) {
          queued.push(call)
          return
        }
        if (watch !== undefined) {
          wireParams = { subscriptionId: watch.serverSubscriptionId }
        }
      }
      const payload = serialize({ jsonrpc: '2.0', id, method: call.method, params: wireParams })
      call.requestId = id
      pending.set(id, call)
      socket.send(payload)
    } catch (cause) {
      call.fail(cause instanceof WorkbenchError ? cause : protocolError(String(cause)))
    }
  }

  const sendInternal = (
    method: string,
    params: JsonValue,
    decode: (value: unknown) => unknown,
    onSuccess: (value: unknown) => void,
    onFailure: (error: WorkbenchError) => void,
    watchAction?: WatchAction,
  ): void => {
    if (!socket) return onFailure(disconnectedError('Connected host is unavailable'))
    try {
      const id = ++requestId
      const payload = serialize({ jsonrpc: '2.0', id, method, params })
      pending.set(id, {
        method,
        params,
        decode,
        succeed: onSuccess,
        fail: onFailure,
        watchAction,
        cancelled: false,
        requestId: id,
      })
      socket.send(payload)
    } catch (cause) {
      onFailure(cause instanceof WorkbenchError ? cause : protocolError(String(cause)))
    }
  }

  const closeProtocol = (message: string): void => {
    failPending(message)
    socket?.close()
  }

  const restoreWatches = (): void => {
    const watches = [...activeWatches.entries()]
    watchesRestoring = watches.length
    for (const [logicalId, watch] of watches) {
      watch.serverSubscriptionId = null
      sendInternal(
        CONNECTED_METHODS.workspaceWatch,
        watch.params,
        Schema.decodeUnknownSync(Schema.Struct({ subscriptionId: Schema.String })),
        () => {
          watchesRestoring -= 1
          if (watchesRestoring === 0) flush()
        },
        (error) => closeProtocol(error.message),
        { tag: 'restore', logicalId },
      )
    }
  }

  const flush = (): void => {
    const calls = queued.splice(0)
    for (const call of calls) send(call)
  }

  const cancelCall = (call: PendingCall): void => {
    call.cancelled = true
    const queuedIndex = queued.indexOf(call)
    if (queuedIndex >= 0) queued.splice(queuedIndex, 1)
  }

  const removeAcceptedWatch = (subscriptionId: string): void => {
    sendInternal(
      CONNECTED_METHODS.workspaceUnwatch,
      { subscriptionId },
      Schema.decodeUnknownSync(Schema.Struct({ removed: Schema.Boolean })),
      () => undefined,
      (error) => closeProtocol(error.message),
    )
  }

  const handleResponse = (value: unknown): void => {
    const success = Schema.decodeUnknownEither(JsonRpcSuccessResponseSchema)(value)
    const error = Schema.decodeUnknownEither(JsonRpcErrorResponseSchema)(value)
    const envelope =
      success._tag === 'Right' ? success.right : error._tag === 'Right' ? error.right : null
    if (!envelope) return closeProtocol('Connected host sent an invalid JSON-RPC response')
    const call = pending.get(envelope.id)
    if (!call) return closeProtocol(`Connected host returned unknown response ID ${envelope.id}`)
    pending.delete(envelope.id)
    if ('error' in envelope) {
      if (!call.cancelled) {
        call.fail(protocolError(`RPC error ${envelope.error.code}: ${envelope.error.message}`))
      }
      return
    }
    try {
      const decoded = call.decode(envelope.result)
      if (call.watchAction?.tag === 'create') {
        const subscriptionId = (decoded as { subscriptionId: string }).subscriptionId
        if (call.cancelled) {
          removeAcceptedWatch(subscriptionId)
          return
        }
        activeWatches.set(subscriptionId, {
          params: call.params,
          serverSubscriptionId: subscriptionId,
        })
      } else if (call.watchAction?.tag === 'restore') {
        const watch = activeWatches.get(call.watchAction.logicalId)
        if (watch !== undefined) {
          watch.serverSubscriptionId = (decoded as { subscriptionId: string }).subscriptionId
        }
      } else if (call.watchAction?.tag === 'remove') {
        activeWatches.delete(call.watchAction.logicalId)
      }
      if (!call.cancelled) call.succeed(decoded)
    } catch (cause) {
      if (!call.cancelled) {
        call.fail(
          protocolError(`Connected host returned an invalid ${call.method} result: ${cause}`),
        )
      }
    }
  }

  const handleMessage = (data: string): void => {
    let value: unknown
    try {
      value = JSON.parse(data)
    } catch {
      return closeProtocol('Connected host sent invalid JSON')
    }
    const notification = Schema.decodeUnknownEither(JsonRpcNotificationSchema)(value)
    if (notification._tag === 'Right') {
      let params = notification.right.params
      if (
        notification.right.method === CONNECTED_METHODS.workspaceEvent &&
        typeof params === 'object' &&
        params !== null &&
        !Array.isArray(params)
      ) {
        const serverId = (params as { readonly subscriptionId?: unknown }).subscriptionId
        const logical = [...activeWatches.entries()].find(
          ([, watch]) => watch.serverSubscriptionId === serverId,
        )?.[0]
        if (logical !== undefined) params = { ...params, subscriptionId: logical }
      }
      publish({
        tag: 'notification',
        method: notification.right.method,
        params,
      })
      return
    }
    handleResponse(value)
  }

  const connect = (): void => {
    if (disposed) return
    cancelReconnect = null
    initialized = false
    disconnectObserved = false
    const current = webSocketFactory(socketUrl(pageUrl, manifest.webSocketPath))
    socket = current
    current.onOpen = () => {
      sendInternal(
        CONNECTED_METHODS.initialize,
        { protocolVersion: 1, sessionId: manifest.sessionId },
        Schema.decodeUnknownSync(ConnectedInitializeResultSchema),
        () => {
          initialized = true
          reconnectAttempt = 0
          restoreWatches()
          if (watchesRestoring === 0) flush()
        },
        (error) => closeProtocol(error.message),
      )
    }
    current.onMessage = handleMessage
    current.onClose = (reason) => {
      if (disposed || current !== socket || disconnectObserved) return
      disconnectObserved = true
      initialized = false
      failPending(reason)
      publish({ tag: 'disconnected', message: reason })
      reconnectAttempt += 1
      cancelReconnect = scheduleReconnect(reconnectAttempt, connect)
    }
  }

  connect()

  return {
    manifest,
    call: <A, I>(method: string, params: I, schema: Schema.Schema<A>) =>
      Effect.async<A, WorkbenchError>((resume) => {
        if (disposed) {
          resume(Effect.fail(disconnectedError('Connected host client is closed')))
          return
        }
        let wireParams: JsonValue
        try {
          wireParams = Schema.decodeUnknownSync(JsonValueSchema)(params)
          serialize(wireParams)
        } catch (cause) {
          resume(
            Effect.fail(
              cause instanceof WorkbenchError
                ? cause
                : protocolError(`Connected host request parameters are not serializable: ${cause}`),
            ),
          )
          return
        }
        const watchAction: WatchAction | undefined =
          method === CONNECTED_METHODS.workspaceWatch
            ? { tag: 'create' }
            : method === CONNECTED_METHODS.workspaceUnwatch &&
                typeof wireParams === 'object' &&
                wireParams !== null &&
                !Array.isArray(wireParams) &&
                typeof (wireParams as { readonly subscriptionId?: unknown }).subscriptionId ===
                  'string'
              ? {
                  tag: 'remove',
                  logicalId: (wireParams as { readonly subscriptionId: string }).subscriptionId,
                }
              : undefined
        const call: PendingCall = {
          method,
          params: wireParams,
          decode: Schema.decodeUnknownSync(schema),
          succeed: (value) => resume(Effect.succeed(value as A)),
          fail: (error) => resume(Effect.fail(error)),
          watchAction,
          cancelled: false,
        }
        send(call)
        return Effect.sync(() => cancelCall(call))
      }),
    notifications: Stream.async<ConnectedNotification>((emit) => {
      const subscriber = (notification: ConnectedNotification): void => {
        emit.single(notification)
      }
      notificationSubscribers.add(subscriber)
      return Effect.sync(() => void notificationSubscribers.delete(subscriber))
    }),
    close: Effect.sync(() => {
      if (disposed) return
      disposed = true
      cancelReconnect?.()
      cancelReconnect = null
      failPending('Connected host client is closed')
      for (const call of queued.splice(0)) {
        if (!call.cancelled) call.fail(disconnectedError('Connected host client is closed'))
      }
      socket?.close()
      socket = null
      activeWatches.clear()
      notificationSubscribers.clear()
    }),
  }
}
