import { describe, expect, test, vi } from 'vitest'
import type { FileTree } from '@morphir/workspace'
import {
  BrowserDirectoryError,
  fileTreeFromDirectoryHandle,
  fileTreeFromDirectoryUpload,
  type DirectoryEntryHandle,
  type DirectoryPermissionHandle,
  type UploadedDirectoryFile,
} from '../src/workspace/browser-directory.ts'
import { makeBrowserMorphirHome } from '../src/workspace/browser-home.ts'
import {
  makeDirectoryHandleStore,
  type WorkspaceStorage,
  type WorkspaceStorageName,
} from '../src/workspace/handle-store.ts'

type StoredValues = Map<WorkspaceStorageName, Map<string, unknown>>

const makeStorage = (): { readonly storage: WorkspaceStorage; readonly values: StoredValues } => {
  const values: StoredValues = new Map([
    ['directory-handles', new Map()],
    ['morphir-home-files', new Map()],
  ])
  const bucket = (store: WorkspaceStorageName): Map<string, unknown> => values.get(store)!

  return {
    values,
    storage: {
      get: async <Value>(store: WorkspaceStorageName, key: string) =>
        (bucket(store).get(key) as Value | undefined) ?? null,
      put: async (store, key, value) => {
        bucket(store).set(key, value)
      },
      delete: async (store, key) => {
        bucket(store).delete(key)
      },
      replace: async (store, key, value, deletedKey) => {
        bucket(store).set(key, value)
        bucket(store).delete(deletedKey)
      },
    },
  }
}

const file = (name: string, text: string): DirectoryEntryHandle => ({
  kind: 'file',
  name,
  getFile: async () => ({ text: async () => text }) as File,
})

const directory = (
  name: string,
  children: ReadonlyArray<DirectoryEntryHandle>,
  permission: PermissionState = 'granted',
): DirectoryPermissionHandle => ({
  kind: 'directory',
  name,
  queryPermission: vi.fn(async () => permission),
  requestPermission: vi.fn(async () => permission),
  entries: () =>
    (async function* () {
      for (const child of children) yield [child.name, child] as const
    })(),
})

describe('browser workspace adapters', () => {
  test('a granted directory becomes a sorted tree of directories and recognized configs', async () => {
    const root = directory('workspace', [
      file('notes.txt', 'private notes'),
      directory('packages', [
        directory('zeta', [file('morphir.user.yaml', 'project:\n  version: 2')]),
        directory('alpha', [
          file('ignored.ts', 'do not read'),
          file('morphir.toml', '[project]\nname = "alpha"'),
        ]),
      ]),
      file('morphir.yaml', 'workspace:\n  members: [packages/*]'),
    ])

    expect(await fileTreeFromDirectoryHandle(root)).toEqual<FileTree>({
      entries: {
        '.': { kind: 'directory' },
        'morphir.yaml': { kind: 'file', text: 'workspace:\n  members: [packages/*]' },
        packages: { kind: 'directory' },
        'packages/alpha': { kind: 'directory' },
        'packages/alpha/morphir.toml': {
          kind: 'file',
          text: '[project]\nname = "alpha"',
        },
        'packages/zeta': { kind: 'directory' },
        'packages/zeta/morphir.user.yaml': {
          kind: 'file',
          text: 'project:\n  version: 2',
        },
      },
    })
  })

  test('prompt permission is requested exactly once', async () => {
    const root = directory('workspace', [file('morphir.toml', '[project]')], 'prompt')
    root.requestPermission = vi.fn(async (): Promise<PermissionState> => 'granted')

    await fileTreeFromDirectoryHandle(root)

    expect(root.queryPermission).toHaveBeenCalledWith({ mode: 'read' })
    expect(root.requestPermission).toHaveBeenCalledOnce()
    expect(root.requestPermission).toHaveBeenCalledWith({ mode: 'read' })
  })

  test('denied permission is preserved as a typed failure', async () => {
    const root = directory('workspace', [], 'denied')

    await expect(fileTreeFromDirectoryHandle(root)).rejects.toMatchObject({
      name: 'BrowserDirectoryError',
      code: 'permission-denied',
    } satisfies Partial<BrowserDirectoryError>)
    expect(root.requestPermission).not.toHaveBeenCalled()
  })

  test('directory handles round-trip opaquely without localStorage serialization', async () => {
    const { storage } = makeStorage()
    const handles = makeDirectoryHandleStore(storage)
    const handle = directory('workspace', [])
    const localStorageWrite = vi.spyOn(Storage.prototype, 'setItem')

    await handles.put('directory:opaque-41', handle as unknown as FileSystemDirectoryHandle)

    expect(await handles.get('directory:opaque-41')).toBe(handle)
    expect(localStorageWrite).not.toHaveBeenCalled()
    await handles.delete('directory:opaque-41')
    expect(await handles.get('directory:opaque-41')).toBeNull()
  })

  test('Browser Morphir Home is a separate sorted file tree and replaces sibling formats', async () => {
    const { storage, values } = makeStorage()
    const replace = vi.spyOn(storage, 'replace')
    const home = makeBrowserMorphirHome(storage)

    await home.writeConfig('morphir.yaml', 'project:\n  name: old')
    await home.writeConfig('morphir.toml', '[project]\nname = "new"')

    expect(await home.read()).toEqual<FileTree>({
      entries: {
        '.': { kind: 'directory' },
        'morphir.toml': { kind: 'file', text: '[project]\nname = "new"' },
      },
    })
    expect(values.get('morphir-home-files')?.has('morphir.yaml')).toBe(false)
    expect(values.get('directory-handles')?.size).toBe(0)
    expect(replace).toHaveBeenLastCalledWith(
      'morphir-home-files',
      'morphir.toml',
      '[project]\nname = "new"',
      'morphir.yaml',
    )
  })

  test.each(['../outside/morphir.toml', String.raw`root\morphir.toml`])(
    'upload fallback rejects confined path %s before reading or discovery',
    async (relativePath) => {
      const read = vi.fn(async () => '[project]')
      const discover = vi.fn(async (_tree: FileTree) => undefined)
      const upload: UploadedDirectoryFile = { relativePath, text: read }

      await expect(fileTreeFromDirectoryUpload([upload]).then(discover)).rejects.toThrow(
        'canonical, confined relative path',
      )
      expect(read).not.toHaveBeenCalled()
      expect(discover).not.toHaveBeenCalled()
    },
  )
})
