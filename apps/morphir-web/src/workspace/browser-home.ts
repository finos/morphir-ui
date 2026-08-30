import type { FileTree } from '@morphir/workspace'
import {
  MORPHIR_HOME_FILE_STORE,
  makeIndexedDbWorkspaceStorage,
  type WorkspaceStorage,
} from './handle-store.ts'

export type BrowserMorphirHomeConfigName = 'morphir.toml' | 'morphir.yaml'

export interface BrowserMorphirHome {
  readonly read: () => Promise<FileTree>
  readonly writeConfig: (name: BrowserMorphirHomeConfigName, text: string) => Promise<void>
}

const CONFIG_NAMES: ReadonlyArray<BrowserMorphirHomeConfigName> = ['morphir.toml', 'morphir.yaml']

const siblingName = (name: BrowserMorphirHomeConfigName): BrowserMorphirHomeConfigName =>
  name === 'morphir.toml' ? 'morphir.yaml' : 'morphir.toml'

export const makeBrowserMorphirHome = (storage: WorkspaceStorage): BrowserMorphirHome => ({
  read: async () => {
    const stored = await Promise.all(
      CONFIG_NAMES.map(async (name) => ({
        name,
        text: await storage.get<string>(MORPHIR_HOME_FILE_STORE, name),
      })),
    )
    const entries: Record<string, FileTree['entries'][string]> = {
      '.': { kind: 'directory' },
    }
    for (const { name, text } of stored) {
      if (text !== null) entries[name] = { kind: 'file', text }
    }
    return { entries }
  },
  writeConfig: (name, text) =>
    storage.replace(MORPHIR_HOME_FILE_STORE, name, text, siblingName(name)),
})

export const makeIndexedDbBrowserMorphirHome = (
  factory: IDBFactory = indexedDB,
): BrowserMorphirHome => makeBrowserMorphirHome(makeIndexedDbWorkspaceStorage(factory))
