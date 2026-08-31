export const WORKSPACE_DATABASE_NAME = 'morphir-ui.workspace.v1'
export const DIRECTORY_HANDLE_STORE = 'directory-handles'
export const MORPHIR_HOME_FILE_STORE = 'morphir-home-files'

export type WorkspaceStorageName = typeof DIRECTORY_HANDLE_STORE | typeof MORPHIR_HOME_FILE_STORE

export interface WorkspaceStorage {
  readonly has: (store: WorkspaceStorageName, key: string) => Promise<boolean>
  readonly get: <Value>(store: WorkspaceStorageName, key: string) => Promise<Value | null>
  readonly put: (store: WorkspaceStorageName, key: string, value: unknown) => Promise<void>
  readonly delete: (store: WorkspaceStorageName, key: string) => Promise<void>
  readonly replace: (
    store: WorkspaceStorageName,
    key: string,
    value: unknown,
    deletedKey: string,
  ) => Promise<void>
}

export interface DirectoryHandleStore {
  readonly has: (key: string) => Promise<boolean>
  readonly put: (key: string, handle: FileSystemDirectoryHandle) => Promise<void>
  readonly get: (key: string) => Promise<FileSystemDirectoryHandle | null>
  readonly delete: (key: string) => Promise<void>
}

const requestResult = <Value>(request: IDBRequest<Value>): Promise<Value> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })

const transactionResult = (transaction: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction was aborted'))
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction failed'))
  })

export const makeIndexedDbWorkspaceStorage = (factory: IDBFactory): WorkspaceStorage => {
  const database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(WORKSPACE_DATABASE_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      for (const store of [DIRECTORY_HANDLE_STORE, MORPHIR_HOME_FILE_STORE] as const) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Unable to open workspace storage'))
  })

  return {
    has: async (store, key) => {
      const db = await database
      const transaction = db.transaction(store, 'readonly')
      const request = transaction.objectStore(store).count(key)
      const [count] = await Promise.all([requestResult(request), transactionResult(transaction)])
      return count > 0
    },
    get: async <Value>(store: WorkspaceStorageName, key: string): Promise<Value | null> => {
      const db = await database
      const transaction = db.transaction(store, 'readonly')
      const request = transaction.objectStore(store).get(key)
      const [value] = await Promise.all([
        requestResult<unknown>(request),
        transactionResult(transaction),
      ])
      return (value as Value | undefined) ?? null
    },
    put: async (store, key, value) => {
      const db = await database
      const transaction = db.transaction(store, 'readwrite')
      transaction.objectStore(store).put(value, key)
      await transactionResult(transaction)
    },
    delete: async (store, key) => {
      const db = await database
      const transaction = db.transaction(store, 'readwrite')
      transaction.objectStore(store).delete(key)
      await transactionResult(transaction)
    },
    replace: async (store, key, value, deletedKey) => {
      const db = await database
      const transaction = db.transaction(store, 'readwrite')
      const objectStore = transaction.objectStore(store)
      objectStore.put(value, key)
      objectStore.delete(deletedKey)
      await transactionResult(transaction)
    },
  }
}

export const makeDirectoryHandleStore = (storage: WorkspaceStorage): DirectoryHandleStore => ({
  has: (key) => storage.has(DIRECTORY_HANDLE_STORE, key),
  put: (key, handle) => storage.put(DIRECTORY_HANDLE_STORE, key, handle),
  get: (key) => storage.get<FileSystemDirectoryHandle>(DIRECTORY_HANDLE_STORE, key),
  delete: (key) => storage.delete(DIRECTORY_HANDLE_STORE, key),
})

export const makeIndexedDbDirectoryHandleStore = (
  factory: IDBFactory = indexedDB,
): DirectoryHandleStore => makeDirectoryHandleStore(makeIndexedDbWorkspaceStorage(factory))
