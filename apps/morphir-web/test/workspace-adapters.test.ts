import { describe, expect, test, vi } from 'vitest'
import { Schema } from 'effect'
import { FileTreeSchema, type FileTree } from '@morphir/workspace'
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
  DIRECTORY_HANDLE_STORE,
  MORPHIR_HOME_FILE_STORE,
  WORKSPACE_DATABASE_NAME,
  makeDirectoryHandleStore,
  makeIndexedDbWorkspaceStorage,
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
      has: async (store, key) => bucket(store).has(key),
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
  getFile: async () =>
    ({ size: new TextEncoder().encode(text).byteLength, text: async () => text }) as File,
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
      file('manifest.json', 'not a Document Tree manifest'),
      directory('packages', [
        directory('zeta', [file('morphir.user.yaml', 'project:\n  version: 2')]),
        directory('alpha', [
          file('ignored.ts', 'do not read'),
          file('morphir.toml', '[project]\nname = "alpha"'),
        ]),
      ]),
      directory('.morphir-dist', [
        file('manifest.json', '{"formatVersion":4,"distribution":"Library"}'),
      ]),
      file('morphir.yaml', 'workspace:\n  members: [packages/*]'),
    ])

    expect(await fileTreeFromDirectoryHandle(root)).toEqual<FileTree>({
      entries: {
        '.': { kind: 'directory' },
        '.morphir-dist': { kind: 'directory' },
        '.morphir-dist/manifest.json': {
          kind: 'file',
          text: '{"formatVersion":4,"distribution":"Library"}',
        },
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

  test('an uploaded .morphir-dist directory preserves its root manifest', async () => {
    const manifest = '{"formatVersion":4,"distribution":"Library"}'

    await expect(
      fileTreeFromDirectoryUpload([
        {
          relativePath: '.morphir-dist/manifest.json',
          size: manifest.length,
          text: async () => manifest,
        },
      ]),
    ).resolves.toEqual({
      entries: {
        '.': { kind: 'directory' },
        'manifest.json': { kind: 'file', text: manifest },
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

  test('normalizes a queryPermission exception without requesting again', async () => {
    const denied = new DOMException('query detail', 'NotAllowedError')
    const root: DirectoryPermissionHandle = {
      ...directory('workspace', []),
      queryPermission: vi.fn(async () => Promise.reject(denied)),
    }

    const failure = await fileTreeFromDirectoryHandle(root).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(BrowserDirectoryError)
    expect(failure).toMatchObject({ code: 'permission-denied', cause: denied })
    expect(root.requestPermission).not.toHaveBeenCalled()
  })

  test('normalizes a requestPermission exception after exactly one request', async () => {
    const denied = new DOMException('request detail', 'NotAllowedError')
    const root: DirectoryPermissionHandle = {
      ...directory('workspace', [], 'prompt'),
      requestPermission: vi.fn(async () => Promise.reject(denied)),
    }

    const failure = await fileTreeFromDirectoryHandle(root).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(BrowserDirectoryError)
    expect(failure).toMatchObject({ code: 'permission-denied', cause: denied })
    expect(root.requestPermission).toHaveBeenCalledOnce()
  })

  test.each([String.raw`bad\child`, 'C:'])('rejects invalid handle child path %s', async (name) => {
    const root = directory('workspace', [directory(name, [])])

    await expect(fileTreeFromDirectoryHandle(root)).rejects.toMatchObject({
      name: 'BrowserDirectoryError',
      code: 'invalid-path',
    })
  })

  test('rejects a drive-like handle segment nested below a valid directory', async () => {
    const root = directory('workspace', [
      directory('packages', [directory('C:', [file('morphir.toml', '[project]')])]),
    ])

    await expect(fileTreeFromDirectoryHandle(root)).rejects.toMatchObject({
      name: 'BrowserDirectoryError',
      code: 'invalid-path',
    })
  })

  test('preserves a __proto__ directory and its recognized config during handle traversal', async () => {
    const root = directory('workspace', [
      directory('__proto__', [file('morphir.toml', '[project]')]),
    ])

    const tree = await fileTreeFromDirectoryHandle(root)

    expect(Object.hasOwn(tree.entries, '__proto__')).toBe(true)
    expect(tree.entries['__proto__']).toEqual({ kind: 'directory' })
    expect(tree.entries['__proto__/morphir.toml']).toEqual({ kind: 'file', text: '[project]' })
    expect(() => Schema.decodeUnknownSync(FileTreeSchema)(tree)).not.toThrow()
  })

  test('normalizes permission revocation during traversal', async () => {
    const revoked = new DOMException('revoked detail', 'NotAllowedError')
    const root: DirectoryPermissionHandle = {
      ...directory('workspace', []),
      entries: () =>
        (async function* (): AsyncGenerator<readonly [string, DirectoryEntryHandle]> {
          await Promise.reject(revoked)
          yield ['unreachable', file('morphir.toml', '')]
        })(),
    }

    const failure = await fileTreeFromDirectoryHandle(root).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(BrowserDirectoryError)
    expect(failure).toMatchObject({ code: 'permission-denied', cause: revoked })
    expect(failure).not.toBe(revoked)
  })

  test('directory handles enforce entry, depth, and config-byte budgets before reading', async () => {
    const text = vi.fn(async () => 'abc')
    const root = directory('workspace', [
      directory('nested', [
        {
          kind: 'file',
          name: 'morphir.toml',
          getFile: async () => ({ size: 3, text }),
        },
      ]),
    ])

    for (const budgets of [{ entries: 0 }, { maxDepth: 0 }, { configBytes: 2 }]) {
      await expect(fileTreeFromDirectoryHandle(root, { budgets })).rejects.toMatchObject({
        name: 'BrowserDirectoryError',
        code: 'resource-limit',
      })
    }
    expect(text).not.toHaveBeenCalled()
    expect(
      await fileTreeFromDirectoryHandle(root, {
        budgets: { entries: 2, maxDepth: 1, configBytes: 3 },
      }),
    ).toBeDefined()
  })

  test.each([
    {
      boundary: 'getFile',
      child: {
        kind: 'file',
        name: 'morphir.toml',
        getFile: async () => {
          throw new Error('getFile failed')
        },
      } satisfies DirectoryEntryHandle,
    },
    {
      boundary: 'text',
      child: {
        kind: 'file',
        name: 'morphir.toml',
        getFile: async () => ({
          size: 0,
          text: async () => {
            throw new Error('text failed')
          },
        }),
      } satisfies DirectoryEntryHandle,
    },
  ])('normalizes $boundary failures as read-failed', async ({ child }) => {
    const failure = await fileTreeFromDirectoryHandle(directory('workspace', [child])).catch(
      (error: unknown) => error,
    )

    expect(failure).toBeInstanceOf(BrowserDirectoryError)
    expect(failure).toMatchObject({ code: 'read-failed' })
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
      const upload: UploadedDirectoryFile = { relativePath, size: 9, text: read }

      await expect(fileTreeFromDirectoryUpload([upload]).then(discover)).rejects.toThrow(
        'canonical, confined relative path',
      )
      expect(read).not.toHaveBeenCalled()
      expect(discover).not.toHaveBeenCalled()
    },
  )

  test.each([
    'root/C:/morphir.toml',
    'root/packages/C:/morphir.toml',
    String.raw`root/packages\bad/morphir.toml`,
    'root/packages/./morphir.toml',
  ])('upload fallback rejects unsafe nested segment in %s before reading', async (relativePath) => {
    const read = vi.fn(async () => '[project]')

    await expect(
      fileTreeFromDirectoryUpload([{ relativePath, size: 9, text: read }]),
    ).rejects.toMatchObject({
      name: 'BrowserDirectoryError',
      code: 'invalid-path',
    })
    expect(read).not.toHaveBeenCalled()
  })

  test('upload fallback rejects duplicate normalized file paths before reading', async () => {
    const reads = [vi.fn(async () => '[project]'), vi.fn(async () => '[project]')]

    await expect(
      fileTreeFromDirectoryUpload([
        { relativePath: 'root/morphir.toml', size: 9, text: reads[0]! },
        { relativePath: 'root/morphir.toml', size: 9, text: reads[1]! },
      ]),
    ).rejects.toMatchObject({
      name: 'BrowserDirectoryError',
      code: 'path-conflict',
    })
    expect(reads.every((read) => read.mock.calls.length === 0)).toBe(true)
  })

  test.each([
    ['root/morphir.toml', 'root/morphir.toml/child'],
    ['root/packages', 'root/packages/morphir.toml'],
  ])(
    'upload fallback rejects file-tree conflict between %s and %s before reading',
    async (...paths) => {
      const reads = paths.map(() => vi.fn(async () => '[project]'))

      await expect(
        fileTreeFromDirectoryUpload(
          paths.map((relativePath, index) => ({ relativePath, size: 9, text: reads[index]! })),
        ),
      ).rejects.toMatchObject({
        name: 'BrowserDirectoryError',
        code: 'path-conflict',
      })
      expect(reads.every((read) => read.mock.calls.length === 0)).toBe(true)
    },
  )

  test('upload fallback preserves __proto__ path entries', async () => {
    const tree = await fileTreeFromDirectoryUpload([
      { relativePath: '__proto__/morphir.toml', size: 9, text: async () => '[project]' },
      { relativePath: 'packages/orders/notes.txt', size: 7, text: async () => 'ignored' },
    ])

    expect(Object.hasOwn(tree.entries, '__proto__')).toBe(true)
    expect(tree.entries['__proto__']).toEqual({ kind: 'directory' })
    expect(tree.entries['__proto__/morphir.toml']).toEqual({ kind: 'file', text: '[project]' })
    expect(() => Schema.decodeUnknownSync(FileTreeSchema)(tree)).not.toThrow()
  })

  test('upload fallback enforces entry, depth, and config-byte budgets before reading', async () => {
    const text = vi.fn(async () => 'abc')
    const files = [{ relativePath: 'root/packages/morphir.toml', size: 3, text }]

    for (const budgets of [{ entries: 0 }, { maxDepth: 0 }, { configBytes: 2 }]) {
      await expect(fileTreeFromDirectoryUpload(files, { budgets })).rejects.toMatchObject({
        name: 'BrowserDirectoryError',
        code: 'resource-limit',
      })
    }
    expect(text).not.toHaveBeenCalled()
    expect(
      await fileTreeFromDirectoryUpload(files, {
        budgets: { entries: 2, maxDepth: 1, configBytes: 3 },
      }),
    ).toBeDefined()
  })
})

type TransactionOutcome = 'complete' | 'abort' | 'error'

const makeIndexedDbFactory = () => {
  const values = new Map<WorkspaceStorageName, Map<string, unknown>>([
    [DIRECTORY_HANDLE_STORE, new Map()],
    [MORPHIR_HOME_FILE_STORE, new Map()],
  ])
  const createdStores: string[] = []
  const openCalls: Array<readonly [string, number | undefined]> = []
  let nextOutcome: TransactionOutcome = 'complete'

  const transaction = (storeName: WorkspaceStorageName): IDBTransaction => {
    const tx = {
      error: null,
      oncomplete: null,
      onabort: null,
      onerror: null,
    } as unknown as IDBTransaction
    let scheduled = false
    const finish = (): void => {
      if (scheduled) return
      scheduled = true
      queueMicrotask(() => {
        if (nextOutcome === 'abort') {
          Object.defineProperty(tx, 'error', { value: new DOMException('aborted', 'AbortError') })
          tx.onabort?.(new Event('abort') as unknown as Event)
        } else if (nextOutcome === 'error') {
          Object.defineProperty(tx, 'error', { value: new DOMException('failed', 'UnknownError') })
          tx.onerror?.(new Event('error') as unknown as Event)
        } else {
          tx.oncomplete?.(new Event('complete') as unknown as Event)
        }
        nextOutcome = 'complete'
      })
    }
    Object.assign(tx, {
      objectStore: () => ({
        count: (key: string) => {
          const request = {
            result: values.get(storeName)?.has(key) ? 1 : 0,
            error: null,
            onsuccess: null,
            onerror: null,
          } as unknown as IDBRequest<number>
          queueMicrotask(() => request.onsuccess?.(new Event('success') as unknown as Event))
          finish()
          return request
        },
        get: (key: string) => {
          const request = {
            result: values.get(storeName)?.get(key),
            error: null,
            onsuccess: null,
            onerror: null,
          } as unknown as IDBRequest<unknown>
          queueMicrotask(() => request.onsuccess?.(new Event('success') as unknown as Event))
          finish()
          return request
        },
        put: (value: unknown, key: string) => {
          values.get(storeName)?.set(key, value)
          finish()
          return {} as IDBRequest
        },
        delete: (key: string) => {
          values.get(storeName)?.delete(key)
          finish()
          return {} as IDBRequest
        },
      }),
    })
    return tx
  }

  const database = {
    objectStoreNames: { contains: (name: string) => createdStores.includes(name) },
    createObjectStore: (name: string) => {
      createdStores.push(name)
      return {} as IDBObjectStore
    },
    transaction,
  } as unknown as IDBDatabase

  const factory = {
    open: (name: string, version?: number) => {
      openCalls.push([name, version])
      const request = {
        result: database,
        error: null,
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
      } as unknown as IDBOpenDBRequest
      queueMicrotask(() => {
        request.onupgradeneeded?.(new Event('upgradeneeded') as unknown as IDBVersionChangeEvent)
        request.onsuccess?.(new Event('success') as unknown as Event)
      })
      return request
    },
  } as unknown as IDBFactory

  return {
    factory,
    values,
    createdStores,
    openCalls,
    failNext: (outcome: Exclude<TransactionOutcome, 'complete'>) => {
      nextOutcome = outcome
    },
  }
}

describe('IndexedDB workspace storage', () => {
  test('opens the versioned database, creates both stores, and completes CRUD', async () => {
    const fake = makeIndexedDbFactory()
    const storage = makeIndexedDbWorkspaceStorage(fake.factory)
    const handle = { opaque: true }

    await storage.put(DIRECTORY_HANDLE_STORE, 'directory:41', handle)

    expect(fake.openCalls).toEqual([[WORKSPACE_DATABASE_NAME, 1]])
    expect(fake.createdStores).toEqual([DIRECTORY_HANDLE_STORE, MORPHIR_HOME_FILE_STORE])
    expect(await storage.has(DIRECTORY_HANDLE_STORE, 'directory:41')).toBe(true)
    expect(await storage.get(DIRECTORY_HANDLE_STORE, 'directory:41')).toBe(handle)
    await storage.delete(DIRECTORY_HANDLE_STORE, 'directory:41')
    expect(await storage.has(DIRECTORY_HANDLE_STORE, 'directory:41')).toBe(false)
    expect(await storage.get(DIRECTORY_HANDLE_STORE, 'directory:41')).toBeNull()
  })

  test.each(['abort', 'error'] as const)('rejects a transaction %s', async (outcome) => {
    const fake = makeIndexedDbFactory()
    const storage = makeIndexedDbWorkspaceStorage(fake.factory)
    fake.failNext(outcome)

    await expect(storage.put(DIRECTORY_HANDLE_STORE, 'directory:41', {})).rejects.toThrow()
  })
})
