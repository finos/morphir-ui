import { constants } from 'node:fs'
import { lstat, open, readdir, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import {
  FileTreeSchema,
  RelativePathSchema,
  type FileEntry,
  type FileTree,
} from '@morphir/workspace'
import { Schema } from 'effect'

export class NodeFileTreeError extends Error {
  readonly name = 'NodeFileTreeError'

  constructor(
    readonly code: 'workspace.path.not-confined' | 'workspace.path.read-failed',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}

const comparePaths = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0

const normalizedRelative = (path: string): string =>
  path.length === 0 ? '.' : path.split(sep).join('/')

const decodeRelativePath = (path: string): string => {
  try {
    return Schema.decodeUnknownSync(RelativePathSchema)(path)
  } catch (cause) {
    throw new NodeFileTreeError(
      'workspace.path.not-confined',
      `workspace.path.not-confined: invalid workspace path ${JSON.stringify(path)}`,
      { cause },
    )
  }
}

const joinRelative = (parent: string, child: string): string =>
  decodeRelativePath(parent === '.' ? child : `${parent}/${child}`)

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

interface BoundRoot {
  readonly granted: string
  readonly canonical: string
  readonly device: number
  readonly inode: number
}

const sameIdentity = (
  left: { readonly dev: number; readonly ino: number },
  right: { readonly dev: number; readonly ino: number },
): boolean => left.dev === right.dev && left.ino === right.ino

const bindRoot = async (root: string): Promise<BoundRoot> => {
  const granted = resolve(root)
  await lstat(granted)
  const canonical = await realpath(granted)
  const identity = await stat(canonical)
  if (!identity.isDirectory()) {
    throw new NodeFileTreeError(
      'workspace.path.read-failed',
      `Workspace root is not a directory: ${granted}`,
    )
  }
  return { granted, canonical, device: identity.dev, inode: identity.ino }
}

const assertBoundRoot = async (root: BoundRoot): Promise<void> => {
  try {
    const current = await realpath(root.granted)
    const identity = await stat(current)
    if (
      current !== root.canonical ||
      !sameIdentity(identity, { dev: root.device, ino: root.inode })
    ) {
      throw new Error('root identity changed')
    }
  } catch (cause) {
    throw new NodeFileTreeError(
      'workspace.path.not-confined',
      `workspace.path.not-confined: development root changed after binding ${JSON.stringify(root.granted)}`,
      { cause },
    )
  }
}

const confinedRelative = (root: BoundRoot, resolved: string): string => {
  const candidate = relative(root.canonical, resolved)
  if (isAbsolute(candidate) || candidate === '..' || candidate.startsWith(`..${sep}`)) {
    throw new NodeFileTreeError(
      'workspace.path.not-confined',
      `workspace.path.not-confined: ${JSON.stringify(resolved)} is outside ${JSON.stringify(root.canonical)}`,
    )
  }
  return decodeRelativePath(normalizedRelative(candidate))
}

const resolveConfined = async (
  root: BoundRoot,
  lexicalAbsolute: string,
): Promise<{ readonly resolved: string; readonly relative: string }> => {
  await assertBoundRoot(root)
  await lstat(lexicalAbsolute)
  const resolved = await realpath(lexicalAbsolute)
  const confined = { resolved, relative: confinedRelative(root, resolved) }
  await assertBoundRoot(root)
  return confined
}

const readConfinedConfig = async (
  root: BoundRoot,
  lexicalAbsolute: string,
  resolved: string,
): Promise<string> => {
  const expected = await stat(resolved)
  const noFollow = process.platform === 'win32' ? 0 : constants.O_NOFOLLOW
  const handle = await open(resolved, constants.O_RDONLY | noFollow)
  try {
    const opened = await handle.stat()
    if (!opened.isFile() || !sameIdentity(expected, opened)) {
      throw new NodeFileTreeError(
        'workspace.path.not-confined',
        `workspace.path.not-confined: configuration changed before it could be read`,
      )
    }
    const text = await handle.readFile('utf8')
    const after = await realpath(lexicalAbsolute)
    if (after !== resolved) {
      throw new NodeFileTreeError(
        'workspace.path.not-confined',
        `workspace.path.not-confined: configuration path changed while it was read`,
      )
    }
    await assertBoundRoot(root)
    return text
  } finally {
    await handle.close()
  }
}

interface DirectoryAlias {
  readonly lexicalPath: string
  readonly targetPath: string
}

const materializeAliases = (
  entries: Map<string, FileEntry>,
  aliases: ReadonlyArray<DirectoryAlias>,
): void => {
  const realEntries = [...entries].sort(([left], [right]) => comparePaths(left, right))
  for (const alias of [...aliases].sort((left, right) =>
    comparePaths(left.lexicalPath, right.lexicalPath),
  )) {
    for (const [path, entry] of realEntries) {
      const suffix =
        alias.targetPath === '.'
          ? path === '.'
            ? ''
            : path
          : path === alias.targetPath
            ? ''
            : path.startsWith(`${alias.targetPath}/`)
              ? path.slice(alias.targetPath.length + 1)
              : null
      if (suffix === null) continue
      const aliasPath =
        suffix.length === 0 ? alias.lexicalPath : joinRelative(alias.lexicalPath, suffix)
      if (!entries.has(aliasPath)) entries.set(aliasPath, entry)
    }
  }
}

export const fileTreeFromNodeRoot = async (rootPath: string): Promise<FileTree> => {
  const root = await bindRoot(rootPath)
  const entries = new Map<string, FileEntry>([['.', { kind: 'directory' }]])
  const aliases: Array<DirectoryAlias> = []
  const visitedDirectories = new Set<string>([root.canonical])

  const walk = async (absoluteDirectory: string, relativeDirectory: string): Promise<void> => {
    const before = await stat(absoluteDirectory)
    const children = await readdir(absoluteDirectory, { withFileTypes: true })
    const after = await stat(absoluteDirectory)
    if (!before.isDirectory() || !sameIdentity(before, after)) {
      throw new NodeFileTreeError(
        'workspace.path.not-confined',
        `workspace.path.not-confined: directory changed while reading ${JSON.stringify(relativeDirectory)}`,
      )
    }
    children.sort((left, right) => comparePaths(left.name, right.name))

    for (const child of children) {
      const lexicalPath = joinRelative(relativeDirectory, child.name)
      const lexicalAbsolute = resolve(absoluteDirectory, child.name)
      const metadata = await lstat(lexicalAbsolute)
      const confined = await resolveConfined(root, lexicalAbsolute)
      const target = await stat(confined.resolved)

      if (metadata.isSymbolicLink()) {
        if (target.isDirectory()) {
          aliases.push({ lexicalPath, targetPath: confined.relative })
        } else if (target.isFile() && isRecognizedConfig(lexicalPath)) {
          entries.set(lexicalPath, {
            kind: 'file',
            text: await readConfinedConfig(root, lexicalAbsolute, confined.resolved),
          })
        }
        continue
      }

      if (target.isDirectory()) {
        entries.set(lexicalPath, { kind: 'directory' })
        if (!visitedDirectories.has(confined.resolved)) {
          visitedDirectories.add(confined.resolved)
          await walk(confined.resolved, lexicalPath)
        }
      } else if (target.isFile() && isRecognizedConfig(lexicalPath)) {
        entries.set(lexicalPath, {
          kind: 'file',
          text: await readConfinedConfig(root, lexicalAbsolute, confined.resolved),
        })
      }
    }
  }

  await walk(root.canonical, '.')
  materializeAliases(entries, aliases)
  await assertBoundRoot(root)
  const tree = {
    entries: Object.fromEntries([...entries].sort(([left], [right]) => comparePaths(left, right))),
  }
  if (!Schema.is(FileTreeSchema)(tree)) {
    throw new NodeFileTreeError(
      'workspace.path.not-confined',
      'workspace.path.not-confined: native workspace traversal produced an invalid FileTree',
    )
  }
  return tree
}

const MODERN_PRIMARY_CONFIGS = [
  'morphir.toml',
  'morphir.yaml',
  '.morphir/morphir.toml',
  '.morphir/morphir.yaml',
  '.config/morphir/config.toml',
  '.config/morphir/config.yaml',
] as const

export const hasPrimaryConfiguration = async (rootPath: string): Promise<boolean> => {
  const tree = await fileTreeFromNodeRoot(rootPath)
  return (
    MODERN_PRIMARY_CONFIGS.some((path) => tree.entries[path]?.kind === 'file') ||
    tree.entries['morphir.json']?.kind === 'file'
  )
}
