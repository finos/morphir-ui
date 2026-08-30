import { Schema } from 'effect'
import {
  DiscoveryResponseSchema,
  type DiscoveryRequest,
  type DiscoveryResponse,
} from '@morphir/workspace'
import { discover_workspace, initSync } from '../generated/morphir_workspace_wasm.js'

export interface WorkspaceDiscoveryEngine {
  readonly discover: (request: DiscoveryRequest) => Promise<DiscoveryResponse>
}

export const makeWorkspaceDiscoveryEngine = async (
  bytes: BufferSource,
): Promise<WorkspaceDiscoveryEngine> => {
  const module = await WebAssembly.compile(bytes)
  initSync({ module })

  return {
    discover: async (request) =>
      Schema.decodeUnknownSync(DiscoveryResponseSchema)(
        JSON.parse(discover_workspace(JSON.stringify(request))),
      ),
  }
}
