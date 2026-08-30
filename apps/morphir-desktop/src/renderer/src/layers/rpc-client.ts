import { Effect } from 'effect'

export interface MorphirIpc {
  platform: string
  postMessage(message: unknown): void
  onMessage(handler: (message: unknown) => void): () => void
}

declare global {
  interface Window {
    morphirIpc: MorphirIpc
  }
}

interface Pending {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}
interface WireResponse {
  id: number
  result?: unknown
  error?: { message: string; data?: unknown }
}
interface WireNotification {
  method: string
  params?: unknown
}

export class RpcClient {
  readonly #pending = new Map<number, Pending>()
  #nextId = 1
  #disposed = false
  readonly #ipc: MorphirIpc
  readonly #removeTransportListener: () => void
  readonly #notificationHandlers = new Map<string, Set<(params: unknown) => void>>()

  constructor(ipc: MorphirIpc = window.morphirIpc) {
    this.#ipc = ipc
    this.#removeTransportListener = ipc.onMessage((message) => {
      if (this.#disposed) return
      const notification = message as Partial<WireNotification>
      if (typeof notification.method === 'string') {
        for (const handler of this.#notificationHandlers.get(notification.method) ?? []) {
          handler(notification.params)
        }
        return
      }

      const response = message as WireResponse
      const pending = this.#pending.get(response.id)
      if (!pending) return
      this.#pending.delete(response.id)
      if (response.error) {
        const detail =
          typeof response.error.data === 'string' ? response.error.data : response.error.message
        pending.reject(new Error(detail))
      } else {
        pending.resolve(response.result)
      }
    })
  }

  onNotification(method: string, handler: (params: unknown) => void): () => void {
    const handlers = this.#notificationHandlers.get(method) ?? new Set()
    handlers.add(handler)
    this.#notificationHandlers.set(method, handlers)
    return () => {
      handlers.delete(handler)
      if (handlers.size === 0) this.#notificationHandlers.delete(method)
    }
  }

  get pendingRequestCount(): number {
    return this.#pending.size
  }

  call(method: string, params?: unknown): Promise<unknown> {
    if (this.#disposed) return Promise.reject(new Error('RPC client disposed'))
    return new Promise((resolve, reject) => {
      const id = this.#nextId++
      this.#pending.set(id, { resolve, reject })
      try {
        this.#ipc.postMessage({ id, method, params })
      } catch (error) {
        this.#pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  effect<A>(method: string, params?: unknown): Effect.Effect<A, Error> {
    return Effect.tryPromise({
      try: () => this.call(method, params) as Promise<A>,
      catch: (e) => (e instanceof Error ? e : new Error(String(e))),
    })
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#removeTransportListener()
    this.#notificationHandlers.clear()
    for (const pending of this.#pending.values()) pending.reject(new Error('RPC client disposed'))
    this.#pending.clear()
  }
}
