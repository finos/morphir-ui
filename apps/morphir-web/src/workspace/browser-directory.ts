import { Schema } from 'effect'
import { RelativePathSchema, type FileTree, type RelativePath } from '@morphir/workspace'

export interface DirectoryFileHandle {
  readonly kind: 'file'
  readonly name: string
  readonly getFile: () => Promise<Pick<File, 'text'>>
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
  readonly text: () => Promise<string>
}

export class BrowserDirectoryError extends Error {
  readonly name = 'BrowserDirectoryError'

  constructor(
    readonly code: 'permission-denied',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}

const isRecognizedConfig = (path: string): boolean => {
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

const comparePaths = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0

const walkDirectory = async (
  handle: DirectoryReadHandle,
  path: string,
  entries: Record<string, FileTree['entries'][string]>,
): Promise<void> => {
  const children: Array<readonly [string, DirectoryEntryHandle]> = []
  for await (const child of handle.entries()) children.push(child)
  children.sort(([left], [right]) => comparePaths(left, right))

  for (const [name, child] of children) {
    const childPath = joinRelative(path, name)
    if (child.kind === 'directory') {
      entries[childPath] = { kind: 'directory' }
      await walkDirectory(child, childPath, entries)
    } else if (isRecognizedConfig(childPath)) {
      const selectedFile = await child.getFile()
      entries[childPath] = { kind: 'file', text: await selectedFile.text() }
    }
  }
}

export const fileTreeFromDirectoryHandle = async (
  handle: DirectoryPermissionHandle,
): Promise<FileTree> => {
  await ensureReadPermission(handle)
  const entries: Record<string, FileTree['entries'][string]> = {
    '.': { kind: 'directory' },
  }
  await walkDirectory(handle, '.', entries)
  return { entries }
}

const decodeRelativePath = (path: string): RelativePath =>
  Schema.decodeUnknownSync(RelativePathSchema)(path)

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

export const fileTreeFromDirectoryUpload = async (
  files: ReadonlyArray<UploadedDirectoryFile>,
): Promise<FileTree> => {
  const validated = files.map((file) => ({ file, path: decodeRelativePath(file.relativePath) }))
  const root = commonUploadRoot(validated.map(({ path }) => path))
  const normalized = validated
    .map(({ file, path }) => ({ file, path: root === null ? path : path.slice(root.length + 1) }))
    .sort(({ path: left }, { path: right }) => comparePaths(left, right))

  const directories = new Set<string>(['.'])
  for (const { path } of normalized) addAncestors(path, directories)

  const entries: Record<string, FileTree['entries'][string]> = {}
  for (const path of [...directories].sort()) entries[path] = { kind: 'directory' }
  for (const { file, path } of normalized) {
    if (isRecognizedConfig(path)) entries[path] = { kind: 'file', text: await file.text() }
  }
  return {
    entries: Object.fromEntries(
      Object.entries(entries).sort(([left], [right]) => comparePaths(left, right)),
    ),
  }
}
