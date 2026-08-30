import { Schema } from 'effect'
import {
  DiscoveryRequestSchema,
  DiscoveryResponseSchema,
  type DiscoveryRequest,
  type DiscoveryResponse,
} from '@morphir/workspace'
import { discover_workspace, initSync } from '../generated/morphir_workspace_wasm.js'

export interface WorkspaceDiscoveryEngine {
  readonly discover: (request: DiscoveryRequest) => Promise<DiscoveryResponse>
}

const copyBytes = (source: BufferSource): Uint8Array<ArrayBuffer> => {
  const view = ArrayBuffer.isView(source)
    ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
    : new Uint8Array(source)
  const copy = new Uint8Array(view.byteLength)
  copy.set(view)
  return copy
}

const bytesEqual = (left: Uint8Array, right: Uint8Array): boolean =>
  left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index])

const initializeEngine = async (
  bytes: Uint8Array<ArrayBuffer>,
): Promise<WorkspaceDiscoveryEngine> => {
  const module = await WebAssembly.compile(bytes)
  initSync({ module })

  return {
    discover: async (request) => {
      const decodedRequest = Schema.decodeUnknownSync(DiscoveryRequestSchema)(request)
      return Schema.decodeUnknownSync(DiscoveryResponseSchema)(
        JSON.parse(discover_workspace(JSON.stringify(decodedRequest))),
      )
    },
  }
}

interface InitializedEngine {
  readonly bytes: Uint8Array
  readonly engine: Promise<WorkspaceDiscoveryEngine>
}

let initialized: InitializedEngine | undefined

export const makeWorkspaceDiscoveryEngine = (
  bytes: BufferSource,
): Promise<WorkspaceDiscoveryEngine> => {
  const candidate = copyBytes(bytes)
  if (initialized) {
    if (!bytesEqual(initialized.bytes, candidate)) {
      return Promise.reject(
        new Error(
          'Workspace discovery engine is already initialized with different WebAssembly bytes',
        ),
      )
    }
    return initialized.engine
  }

  const engine = initializeEngine(candidate)
  const pending = { bytes: candidate, engine }
  initialized = pending
  void engine.catch(() => {
    if (initialized === pending) initialized = undefined
  })
  return engine
}
