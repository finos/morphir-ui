import { readFile } from 'node:fs/promises'
import {
  makeWorkspaceDiscoveryEngine,
  type WorkspaceDiscoveryEngine,
} from '@morphir/workspace-engine'

const wasmUrl = new URL('./morphir_workspace_wasm_bg.wasm', import.meta.url)
let engine: Promise<WorkspaceDiscoveryEngine> | undefined

export const getWorkspaceDiscoveryEngine = (
  source: URL = wasmUrl,
): Promise<WorkspaceDiscoveryEngine> => {
  engine ??= readFile(source).then((bytes) => makeWorkspaceDiscoveryEngine(bytes))
  return engine
}
