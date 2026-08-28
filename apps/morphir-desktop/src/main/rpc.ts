export const RPC_CHANNEL = 'morphir-rpc'
export const WIRE_CODE = -32001
export const WIRE_MESSAGE = 'morphir service error'
export const METHOD_NOT_FOUND = -32601

export interface RpcRequest {
  id: number
  method: string
  params?: unknown
}
export interface RpcErrorShape {
  code: number
  message: string
  data?: unknown
}
export interface RpcResponse {
  id: number
  result?: unknown
  error?: RpcErrorShape
}

export type RpcHandler = (params: unknown) => Promise<unknown>

export class RpcRegistry {
  readonly #handlers = new Map<string, RpcHandler>()

  register(method: string, handler: RpcHandler): void {
    this.#handlers.set(method, handler)
  }

  async dispatch(message: unknown): Promise<RpcResponse> {
    const req = (
      typeof message === 'object' && message !== null ? message : {}
    ) as Partial<RpcRequest>
    const id = typeof req.id === 'number' ? req.id : -1
    const handler = typeof req.method === 'string' ? this.#handlers.get(req.method) : undefined
    if (!handler) {
      return {
        id,
        error: { code: METHOD_NOT_FOUND, message: `method not found: ${String(req.method)}` },
      }
    }
    try {
      return { id, result: await handler(req.params) }
    } catch (e) {
      return {
        id,
        error: {
          code: WIRE_CODE,
          message: WIRE_MESSAGE,
          data: e instanceof Error ? e.message : String(e),
        },
      }
    }
  }
}
