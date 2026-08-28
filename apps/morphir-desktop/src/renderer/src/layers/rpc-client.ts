import { Effect } from 'effect'

export interface MorphirIpc {
  platform: string
  postMessage(message: unknown): void
  onMessage(handler: (message: unknown) => void): void
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

export class RpcClient {
  readonly #pending = new Map<number, Pending>()
  #nextId = 1
  readonly #ipc: MorphirIpc

  constructor(ipc: MorphirIpc = window.morphirIpc) {
    this.#ipc = ipc
    ipc.onMessage((message) => {
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

  call(method: string, params?: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = this.#nextId++
      this.#pending.set(id, { resolve, reject })
      this.#ipc.postMessage({ id, method, params })
    })
  }

  effect<A>(method: string, params?: unknown): Effect.Effect<A, Error> {
    return Effect.tryPromise({
      try: () => this.call(method, params) as Promise<A>,
      catch: (e) => (e instanceof Error ? e : new Error(String(e))),
    })
  }
}
