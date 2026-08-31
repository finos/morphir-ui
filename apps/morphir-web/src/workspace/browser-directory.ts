import { Schema } from 'effect'
import { RelativePathSchema, type FileTree, type RelativePath } from '@morphir/workspace'

export interface DirectoryFileHandle {
  readonly kind: 'file'
  readonly name: string
  readonly getFile: () => Promise<Pick<File, 'size' | 'text'>>
}

export interface DirectoryReadHandle {
  readonly kind: 'directory'
  readonly name: string
  readonly entries: () => AsyncIterableIterator<readonly [string, DirectoryEntryHandle]>
}

export type DirectoryEntryHandle = DirectoryFileHandle | DirectoryReadHandle

export interface ReadPermissionDescriptor {
  readonly mode: 'read'
}

export interface DirectoryPermissionHandle extends DirectoryReadHandle {
  queryPermission(options: ReadPermissionDescriptor): Promise<PermissionState>
  requestPermission(options: ReadPermissionDescriptor): Promise<PermissionState>
}

export interface UploadedDirectoryFile {
  readonly relativePath: string
  readonly size: number
  readonly text: () => Promise<string>
}

export interface BrowserFileTreeBudgets {
  readonly entries: number
  readonly maxDepth: number
  readonly configBytes: number
}

export const DEFAULT_BROWSER_FILE_TREE_BUDGETS: BrowserFileTreeBudgets = {
  entries: 262_144,
  maxDepth: 128,
  configBytes: 64 * 1024 * 1024,
}

export interface BrowserFileTreeOptions {
  readonly budgets?: Partial<BrowserFileTreeBudgets>
  readonly ensurePermission?: boolean
}

export class BrowserDirectoryError extends Error {
  readonly name = 'BrowserDirectoryError'

  constructor(
    readonly code:
      'permission-denied' | 'invalid-path' | 'path-conflict' | 'read-failed' | 'resource-limit',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}

const isPermissionFailure = (cause: unknown): boolean => {
  if (typeof cause !== 'object' || cause === null) return false
  const name = Reflect.get(cause, 'name')
  return name === 'NotAllowedError' || name === 'SecurityError'
}

const normalizeReadFailure = (cause: unknown, message: string): BrowserDirectoryError => {
  if (cause instanceof BrowserDirectoryError) return cause
  return new BrowserDirectoryError(
    isPermissionFailure(cause) ? 'permission-denied' : 'read-failed',
    message,
    {
      cause,
    },
  )
}

const isRecognizedConfig = (path: string, documentTreeRoot: boolean): boolean => {
  if (path === '.morphir-dist/manifest.json') return true
  if (documentTreeRoot && path === 'manifest.json') return true
  const components = path.split('/')
  const name = components.at(-1)
  if (
    name === 'morphir.toml' ||
    name === 'morphir.yaml' ||
    name === 'morphir.json' ||
    name === 'morphir.user.toml' ||
    name === 'morphir.user.yaml'
  ) {
    return true
  }
  if (
    name !== 'config.toml' &&
    name !== 'config.yaml' &&
    name !== 'config.user.toml' &&
    name !== 'config.user.yaml'
  ) {
    return false
  }
  return components.slice(-3, -1).join('/') === '.config/morphir'
}

const ensureReadPermission = async (handle: DirectoryPermissionHandle): Promise<void> => {
  let permission: PermissionState
  try {
    permission = await handle.queryPermission({ mode: 'read' })
  } catch (cause) {
    throw new BrowserDirectoryError(
      'permission-denied',
      `Unable to query read permission for ${handle.name}`,
      { cause },
    )
  }

  if (permission === 'denied') {
    throw new BrowserDirectoryError(
      'permission-denied',
      `Read permission for ${handle.name} was denied`,
    )
  }
  if (permission === 'granted') return

  try {
    permission = await handle.requestPermission({ mode: 'read' })
  } catch (cause) {
    throw new BrowserDirectoryError(
      'permission-denied',
      `Unable to request read permission for ${handle.name}`,
      { cause },
    )
  }
  if (permission !== 'granted') {
    throw new BrowserDirectoryError(
      'permission-denied',
      `Read permission for ${handle.name} was not granted`,
    )
  }
}

const joinRelative = (parent: string, child: string): string =>
  parent === '.' ? child : `${parent}/${child}`

const decodeRelativePath = (path: string): RelativePath => {
  try {
    return Schema.decodeUnknownSync(RelativePathSchema)(path)
  } catch (cause) {
    throw new BrowserDirectoryError(
      'invalid-path',
      `Invalid workspace path ${JSON.stringify(path)}: expected a canonical, confined relative path`,
      { cause },
    )
  }
}

const decodeChildSegment = (name: string): RelativePath => {
  const segment = decodeRelativePath(name)
  if (segment === '.' || segment.includes('/')) {
    throw new BrowserDirectoryError(
      'invalid-path',
      `Invalid workspace path segment ${JSON.stringify(name)}: expected one canonical, confined relative path component`,
    )
  }
  return segment
}

const decodeUploadPath = (path: string): RelativePath => {
  const decoded = decodeRelativePath(path)
  for (const segment of decoded.split('/')) decodeChildSegment(segment)
  return decoded
}

const comparePaths = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0

interface TraversalState {
  entries: number
  configBytes: number
}

const resourceLimit = (resource: keyof BrowserFileTreeBudgets, maximum: number): never => {
  throw new BrowserDirectoryError(
    'resource-limit',
    `workspace.traversal.resource-limit: ${resource} budget ${maximum}`,
  )
}

const chargeEntry = (state: TraversalState, budgets: BrowserFileTreeBudgets): void => {
  if (state.entries >= budgets.entries) resourceLimit('entries', budgets.entries)
  state.entries += 1
}

const ensureConfigSize = (
  size: number,
  state: TraversalState,
  budgets: BrowserFileTreeBudgets,
): void => {
  if (size > budgets.configBytes - state.configBytes) {
    resourceLimit('configBytes', budgets.configBytes)
  }
}

const chargeConfigText = (
  text: string,
  state: TraversalState,
  budgets: BrowserFileTreeBudgets,
): void => {
  const bytes = new TextEncoder().encode(text).byteLength
  ensureConfigSize(bytes, state, budgets)
  state.configBytes += bytes
}

const walkDirectory = async (
  handle: DirectoryReadHandle,
  path: RelativePath,
  entries: Map<RelativePath, FileTree['entries'][string]>,
  budgets: BrowserFileTreeBudgets,
  state: TraversalState,
  depth: number,
  documentTreeRoot: boolean,
): Promise<void> => {
  const children: Array<readonly [string, DirectoryEntryHandle]> = []
  for await (const child of handle.entries()) {
    chargeEntry(state, budgets)
    children.push(child)
  }
  children.sort(([left], [right]) => comparePaths(left, right))

  for (const [name, child] of children) {
    const childPath = decodeRelativePath(joinRelative(path, decodeChildSegment(name)))
    if (child.kind === 'directory') {
      if (depth >= budgets.maxDepth) resourceLimit('maxDepth', budgets.maxDepth)
      entries.set(childPath, { kind: 'directory' })
      await walkDirectory(child, childPath, entries, budgets, state, depth + 1, documentTreeRoot)
    } else if (isRecognizedConfig(childPath, documentTreeRoot)) {
      const selectedFile = await child.getFile()
      ensureConfigSize(selectedFile.size, state, budgets)
      const text = await selectedFile.text()
      chargeConfigText(text, state, budgets)
      entries.set(childPath, { kind: 'file', text })
    }
  }
}

export const fileTreeFromDirectoryHandle = async (
  handle: DirectoryPermissionHandle,
  options: BrowserFileTreeOptions = {},
): Promise<FileTree> => {
  if (options.ensurePermission !== false) await ensureReadPermission(handle)
  const budgets = { ...DEFAULT_BROWSER_FILE_TREE_BUDGETS, ...options.budgets }
  const entries = new Map<RelativePath, FileTree['entries'][string]>([['.', { kind: 'directory' }]])
  try {
    await walkDirectory(
      handle,
      '.',
      entries,
      budgets,
      { entries: 0, configBytes: 0 },
      0,
      handle.name === '.morphir-dist',
    )
  } catch (cause) {
    throw normalizeReadFailure(cause, `Unable to read workspace directory ${handle.name}`)
  }
  return { entries: Object.fromEntries(entries) }
}

const commonUploadRoot = (paths: ReadonlyArray<RelativePath>): string | null => {
  if (paths.length === 0 || paths.some((path) => path === '.' || !path.includes('/'))) return null
  const candidate = paths[0]?.split('/')[0]
  return candidate !== undefined && paths.every((path) => path.startsWith(`${candidate}/`))
    ? candidate
    : null
}

const addAncestors = (path: string, directories: Set<string>): void => {
  const components = path.split('/')
  for (let index = 1; index < components.length; index += 1) {
    directories.add(components.slice(0, index).join('/'))
  }
}

const validateUploadTree = (files: ReadonlyArray<{ readonly path: RelativePath }>): void => {
  const filePaths = new Set<RelativePath>()
  for (const { path } of files) {
    if (filePaths.has(path)) {
      throw new BrowserDirectoryError(
        'path-conflict',
        `Uploaded workspace contains duplicate file path ${JSON.stringify(path)}`,
      )
    }
    filePaths.add(path)
  }

  for (const path of filePaths) {
    const components = path.split('/')
    for (let index = 1; index < components.length; index += 1) {
      const ancestor = components.slice(0, index).join('/') as RelativePath
      if (filePaths.has(ancestor)) {
        throw new BrowserDirectoryError(
          'path-conflict',
          `Uploaded workspace path ${JSON.stringify(ancestor)} is both a file and a directory`,
        )
      }
    }
  }
}

export const fileTreeFromDirectoryUpload = async (
  files: ReadonlyArray<UploadedDirectoryFile>,
  options: BrowserFileTreeOptions = {},
): Promise<FileTree> => {
  const budgets = { ...DEFAULT_BROWSER_FILE_TREE_BUDGETS, ...options.budgets }
  if (files.length > budgets.entries) resourceLimit('entries', budgets.entries)
  const validated = files.map((file) => ({ file, path: decodeUploadPath(file.relativePath) }))
  const root = commonUploadRoot(validated.map(({ path }) => path))
  const documentTreeRoot = root === '.morphir-dist'
  const normalized = validated
    .map(({ file, path }) => ({
      file,
      path: decodeUploadPath(root === null ? path : path.slice(root.length + 1)),
    }))
    .sort(({ path: left }, { path: right }) => comparePaths(left, right))
  validateUploadTree(normalized)

  for (const { path } of normalized) {
    const depth = path.split('/').length - 1
    if (depth > budgets.maxDepth) resourceLimit('maxDepth', budgets.maxDepth)
  }

  const directories = new Set<string>(['.'])
  for (const { path } of normalized) addAncestors(path, directories)
  if (directories.size - 1 + normalized.length > budgets.entries) {
    resourceLimit('entries', budgets.entries)
  }

  let declaredConfigBytes = 0
  for (const { file, path } of normalized) {
    if (!isRecognizedConfig(path, documentTreeRoot)) continue
    if (file.size > budgets.configBytes - declaredConfigBytes) {
      resourceLimit('configBytes', budgets.configBytes)
    }
    declaredConfigBytes += file.size
  }

  const entries = new Map<string, FileTree['entries'][string]>()
  const state: TraversalState = { entries: 0, configBytes: 0 }
  for (const path of [...directories].sort()) entries.set(path, { kind: 'directory' })
  for (const { file, path } of normalized) {
    if (!isRecognizedConfig(path, documentTreeRoot)) continue
    try {
      ensureConfigSize(file.size, state, budgets)
      const text = await file.text()
      chargeConfigText(text, state, budgets)
      entries.set(path, { kind: 'file', text })
    } catch (cause) {
      throw normalizeReadFailure(cause, `Unable to read uploaded workspace file ${path}`)
    }
  }
  return {
    entries: Object.fromEntries([...entries].sort(([left], [right]) => comparePaths(left, right))),
  }
}
