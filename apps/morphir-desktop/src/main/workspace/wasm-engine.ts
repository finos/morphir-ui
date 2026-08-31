import { readFile } from 'node:fs/promises'
import {
  makeWorkspaceDiscoveryEngine,
  type WorkspaceDiscoveryEngine,
} from '@morphir/workspace-engine'

const wasmUrl = new URL('./morphir_workspace_wasm_bg.wasm', import.meta.url)

export const makeCachedWorkspaceDiscoveryEngine = (): ((
  source?: URL,
) => Promise<WorkspaceDiscoveryEngine>) => {
  let engine: Promise<WorkspaceDiscoveryEngine> | undefined
  return (source: URL = wasmUrl) => {
    if (engine) return engine
    const pending = readFile(source)
      .then((bytes) => makeWorkspaceDiscoveryEngine(bytes))
      .catch((cause) => {
        if (engine === pending) engine = undefined
        throw cause
      })
    engine = pending
    return pending
  }
}

export const getWorkspaceDiscoveryEngine = makeCachedWorkspaceDiscoveryEngine()
