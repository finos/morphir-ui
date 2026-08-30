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

const copyBytes = (source: BufferSource): Uint8Array => {
  const view = ArrayBuffer.isView(source)
    ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
    : new Uint8Array(source)
  return Uint8Array.from(view)
}

const bytesEqual = (left: Uint8Array, right: Uint8Array): boolean =>
  left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index])

const initializeEngine = async (bytes: Uint8Array): Promise<WorkspaceDiscoveryEngine> => {
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
  initialized = { bytes: candidate, engine }
  return engine
}
