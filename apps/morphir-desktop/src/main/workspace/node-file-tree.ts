import { spawn } from 'node:child_process'
import { lstat, realpath, stat } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  FileTreeSchema,
  RelativePathSchema,
  type FileEntry,
  type FileTree,
} from '@morphir/workspace'
import { Schema } from 'effect'

export type NodeFileTreeErrorCode =
  | 'workspace.path.not-confined'
  | 'workspace.traversal.unreadable'
  | 'workspace.traversal.resource-limit'
  | 'workspace.alias.resource-limit'
  | 'workspace.config.ambiguous'

export class NodeFileTreeError extends Error {
  readonly name = 'NodeFileTreeError'

  constructor(
    readonly code: NodeFileTreeErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}

export interface NodeFileTreeBudgets {
  readonly realDirectories: number
  readonly realEntries: number
  readonly maxDepth: number
  readonly configBytes: number
  readonly aliasEdges: number
  readonly queuedExpansions: number
  readonly processedExpansions: number
  readonly generatedEntries: number
  readonly totalWork: number
}

export interface NodeFileTreeHooks {
  readonly afterDirectoryBound?: (path: string) => Promise<void> | void
  readonly afterConfigBound?: (path: string) => Promise<void> | void
}

export interface NodeFileTreeOptions {
  readonly budgets?: Partial<NodeFileTreeBudgets>
  readonly hooks?: NodeFileTreeHooks
}

export const DEFAULT_NODE_FILE_TREE_BUDGETS: NodeFileTreeBudgets = {
  realDirectories: 65_536,
  realEntries: 262_144,
  maxDepth: 128,
  configBytes: 64 * 1024 * 1024,
  aliasEdges: 4_096,
  queuedExpansions: 32_768,
  processedExpansions: 32_768,
  generatedEntries: 262_144,
  totalWork: 2_000_000,
}

const workerUrl = new URL('./node-file-tree-worker.mjs', import.meta.url)
const comparePaths = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0
const toIdentity = (value: { readonly dev: number; readonly ino: number }) => ({
  dev: value.dev,
  ino: value.ino,
})
const sameIdentity = (
  left: { readonly dev: number; readonly ino: number },
  right: { readonly dev: number; readonly ino: number },
): boolean => left.dev === right.dev && left.ino === right.ino

const typedError = (
  code: NodeFileTreeErrorCode,
  message: string,
  cause?: unknown,
): NodeFileTreeError => new NodeFileTreeError(code, `${code}: ${message}`, { cause })

const normalizeError = (cause: unknown, context: string): NodeFileTreeError =>
  cause instanceof NodeFileTreeError
    ? cause
    : typedError('workspace.traversal.unreadable', context, cause)

const decodeRelativePath = (path: string): string => {
  try {
    return Schema.decodeUnknownSync(RelativePathSchema)(path)
  } catch (cause) {
    throw typedError(
      'workspace.path.not-confined',
      `invalid workspace path ${JSON.stringify(path)}`,
      cause,
    )
  }
}

const decodeChildSegment = (name: string): string => {
  const segment = decodeRelativePath(name)
  if (
    segment === '.' ||
    segment.includes('/') ||
    segment.includes('\\') ||
    /^[A-Za-z]:/.test(segment)
  ) {
    throw typedError(
      'workspace.path.not-confined',
      `invalid workspace path segment ${JSON.stringify(name)}`,
    )
  }
  return segment
}

const joinRelative = (parent: string, child: string): string =>
  decodeRelativePath(
    parent === '.' ? decodeChildSegment(child) : `${parent}/${decodeChildSegment(child)}`,
  )

const normalizedRelative = (path: string): string =>
  path.length === 0 ? '.' : path.split(sep).join('/')

const confinedRelative = (canonicalRoot: string, resolved: string): string => {
  const candidate = relative(canonicalRoot, resolved)
  if (isAbsolute(candidate) || candidate === '..' || candidate.startsWith(`..${sep}`)) {
    throw typedError(
      'workspace.path.not-confined',
      `${JSON.stringify(resolved)} is outside ${JSON.stringify(canonicalRoot)}`,
    )
  }
  return decodeRelativePath(normalizedRelative(candidate))
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
  return (
    (name === 'config.toml' ||
      name === 'config.yaml' ||
      name === 'config.user.toml' ||
      name === 'config.user.yaml') &&
    components.slice(-3, -1).join('/') === '.config/morphir'
  )
}

interface WorkerIdentity {
  readonly dev: number
  readonly ino: number
}
interface WorkerEntry {
  readonly name: string
  readonly kind: 'directory' | 'file' | 'symlink' | 'other'
  readonly identity: WorkerIdentity
  readonly resolved: string
  readonly targetKind: 'directory' | 'file' | 'other'
  readonly targetIdentity: WorkerIdentity
}
interface WorkerReady {
  readonly type: 'ready'
  readonly directory: WorkerIdentity
}
interface WorkerResult {
  readonly type: 'result'
  readonly entries?: ReadonlyArray<WorkerEntry>
  readonly text?: string
  readonly bytes?: number
}
interface WorkerFailure {
  readonly type: 'error'
  readonly code?: string
  readonly message: string
}

const runWorker = async (
  cwd: string,
  command: Readonly<Record<string, unknown>>,
  expectedDirectory: WorkerIdentity,
  afterBound?: () => Promise<void> | void,
): Promise<WorkerResult> => {
  try {
    return await new Promise<WorkerResult>((resolvePromise, rejectPromise) => {
      const child = spawn(process.execPath, [fileURLToPath(workerUrl), JSON.stringify(command)], {
        cwd,
        env: { ELECTRON_RUN_AS_NODE: '1' },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      let stdout = ''
      let stderr = ''
      let settled = false
      const rejectOnce = (cause: unknown) => {
        if (settled) return
        settled = true
        child.kill()
        rejectPromise(cause)
      }
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (chunk) => {
        stderr += chunk
      })
      child.on('error', rejectOnce)
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk) => {
        stdout += chunk
        void (async () => {
          while (stdout.includes('\n') && !settled) {
            const newline = stdout.indexOf('\n')
            const line = stdout.slice(0, newline)
            stdout = stdout.slice(newline + 1)
            const message = JSON.parse(line) as WorkerReady | WorkerResult | WorkerFailure
            if (message.type === 'error') {
              rejectOnce(
                typedError(
                  message.code === 'workspace.traversal.resource-limit'
                    ? message.code
                    : message.code === 'workspace.alias.resource-limit'
                      ? message.code
                      : message.code === 'workspace.path.not-confined'
                        ? message.code
                        : 'workspace.traversal.unreadable',
                  message.message,
                ),
              )
            } else if (message.type === 'ready') {
              if (!sameIdentity(message.directory, expectedDirectory)) {
                rejectOnce(
                  typedError('workspace.path.not-confined', 'bound directory identity changed'),
                )
                return
              }
              await afterBound?.()
              child.stdin.write('go\n')
            } else {
              settled = true
              resolvePromise(message)
            }
          }
        })().catch(rejectOnce)
      })
      child.on('close', (code) => {
        if (!settled) rejectOnce(new Error(`scanner exited ${code}: ${stderr.trim()}`))
      })
    })
  } catch (cause) {
    throw normalizeError(cause, `unable to use confined scanner for ${JSON.stringify(cwd)}`)
  }
}

interface BoundDirectory {
  readonly absolute: string
  readonly lexicalPath: string
  readonly identity: WorkerIdentity
  readonly depth: number
}
interface DirectoryAlias {
  readonly lexicalPath: string
  readonly targetPath: string
}

const resourceLimit = (kind: 'traversal' | 'alias', resource: string, limit: number): never => {
  const code = `workspace.${kind}.resource-limit` as NodeFileTreeErrorCode
  throw typedError(code, `confined ${kind} exceeded fixed ${resource} budget ${limit}`)
}

const increment = (
  current: number,
  limit: number,
  kind: 'traversal' | 'alias',
  resource: string,
): number => {
  if (current >= limit) resourceLimit(kind, resource, limit)
  return current + 1
}

const materializeAliases = (
  entries: Map<string, FileEntry>,
  aliases: ReadonlyArray<DirectoryAlias>,
  budgets: NodeFileTreeBudgets,
): void => {
  let queued = 0
  let processed = 0
  let generated = 0
  let work = 0
  const doWork = () => {
    work = increment(work, budgets.totalWork, 'alias', 'total work')
  }
  const realEntries = [...entries].sort(([left], [right]) => comparePaths(left, right))
  realEntries.forEach(doWork)
  const edges = [...aliases].sort((left, right) =>
    comparePaths(left.lexicalPath, right.lexicalPath),
  )
  edges.forEach(doWork)
  const queue: Array<{
    lexicalPath: string
    edge: number
    ancestry: ReadonlySet<number>
  }> = []
  edges.forEach((edge, edgeIndex) => {
    queued = increment(queued, budgets.queuedExpansions, 'alias', 'queued expansions')
    queue.push({ lexicalPath: edge.lexicalPath, edge: edgeIndex, ancestry: new Set([edgeIndex]) })
  })
  const seen = new Set<string>()
  while (queue.length > 0) {
    queue.sort(
      (left, right) => comparePaths(left.lexicalPath, right.lexicalPath) || left.edge - right.edge,
    )
    const expansion = queue.shift()!
    const key = `${expansion.lexicalPath}\0${expansion.edge}\0${[...expansion.ancestry].sort().join(',')}`
    if (seen.has(key)) continue
    seen.add(key)
    processed = increment(processed, budgets.processedExpansions, 'alias', 'processed expansions')
    doWork()
    const target = edges[expansion.edge]!.targetPath
    for (const [path, entry] of realEntries) {
      doWork()
      const suffix =
        target === '.'
          ? path === '.'
            ? ''
            : path
          : path === target
            ? ''
            : path.startsWith(`${target}/`)
              ? path.slice(target.length + 1)
              : null
      if (suffix === null) continue
      const aliasPath =
        suffix === ''
          ? expansion.lexicalPath
          : decodeRelativePath(`${expansion.lexicalPath}/${suffix}`)
      if (!entries.has(aliasPath)) {
        generated = increment(generated, budgets.generatedEntries, 'alias', 'generated entries')
        entries.set(aliasPath, entry)
      }
    }
    edges.forEach((nested, nestedIndex) => {
      doWork()
      if (expansion.ancestry.has(nestedIndex)) return
      const suffix =
        target === '.'
          ? nested.lexicalPath
          : nested.lexicalPath === target
            ? ''
            : nested.lexicalPath.startsWith(`${target}/`)
              ? nested.lexicalPath.slice(target.length + 1)
              : null
      if (suffix === null) return
      queued = increment(queued, budgets.queuedExpansions, 'alias', 'queued expansions')
      queue.push({
        lexicalPath:
          suffix === ''
            ? expansion.lexicalPath
            : decodeRelativePath(`${expansion.lexicalPath}/${suffix}`),
        edge: nestedIndex,
        ancestry: new Set([...expansion.ancestry, nestedIndex]),
      })
    })
  }
}

export const fileTreeFromNodeRoot = async (
  rootPath: string,
  options: NodeFileTreeOptions = {},
): Promise<FileTree> => {
  const budgets = { ...DEFAULT_NODE_FILE_TREE_BUDGETS, ...options.budgets }
  try {
    const granted = resolve(rootPath)
    await lstat(granted)
    const canonicalRoot = await realpath(granted)
    const rootStat = await stat(canonicalRoot)
    if (!rootStat.isDirectory()) throw new Error('workspace root is not a directory')
    const entries = new Map<string, FileEntry>([['.', { kind: 'directory' }]])
    const aliases: Array<DirectoryAlias> = []
    const visited = new Set([canonicalRoot])
    const pending: Array<BoundDirectory> = [
      {
        absolute: granted,
        lexicalPath: '.',
        identity: toIdentity(rootStat),
        depth: 0,
      },
    ]
    let realDirectories = increment(0, budgets.realDirectories, 'traversal', 'real directories')
    let realEntries = 0
    let configBytes = 0

    while (pending.length > 0) {
      pending.sort((left, right) => comparePaths(left.lexicalPath, right.lexicalPath))
      const directory = pending.shift()!
      const result = await runWorker(
        directory.absolute,
        {
          mode: 'list',
          maxEntries: budgets.realEntries - realEntries,
          maxAliases: budgets.aliasEdges - aliases.length,
        },
        directory.identity,
        () => options.hooks?.afterDirectoryBound?.(directory.lexicalPath),
      )
      for (const child of result.entries ?? []) {
        realEntries = increment(realEntries, budgets.realEntries, 'traversal', 'real entries')
        const childName = decodeChildSegment(child.name)
        const lexicalPath = joinRelative(directory.lexicalPath, childName)
        const targetPath = confinedRelative(canonicalRoot, child.resolved)
        if (child.kind === 'symlink') {
          if (child.targetKind === 'directory') {
            if (aliases.length >= budgets.aliasEdges) {
              resourceLimit('alias', 'alias edges', budgets.aliasEdges)
            }
            aliases.push({ lexicalPath, targetPath })
          } else if (child.targetKind === 'file' && isRecognizedConfig(lexicalPath)) {
            const targetDirectory = resolve(child.resolved, '..')
            const targetDirectoryStat = await stat(targetDirectory)
            const read = await runWorker(
              targetDirectory,
              {
                mode: 'read',
                name: child.resolved.split(sep).at(-1),
                maxBytes: budgets.configBytes - configBytes,
                file: child.targetIdentity,
              },
              toIdentity(targetDirectoryStat),
              () => options.hooks?.afterConfigBound?.(lexicalPath),
            )
            configBytes += read.bytes ?? 0
            entries.set(lexicalPath, { kind: 'file', text: read.text ?? '' })
          }
          continue
        }
        if (child.targetKind === 'directory') {
          entries.set(lexicalPath, { kind: 'directory' })
          const depth = directory.depth + 1
          if (depth > budgets.maxDepth) {
            resourceLimit('traversal', 'depth', budgets.maxDepth)
          }
          if (!visited.has(child.resolved)) {
            realDirectories = increment(
              realDirectories,
              budgets.realDirectories,
              'traversal',
              'real directories',
            )
            visited.add(child.resolved)
            pending.push({
              absolute: child.resolved,
              lexicalPath,
              identity: child.targetIdentity,
              depth,
            })
          }
        } else if (child.targetKind === 'file' && isRecognizedConfig(lexicalPath)) {
          const read = await runWorker(
            directory.absolute,
            {
              mode: 'read',
              name: childName,
              maxBytes: budgets.configBytes - configBytes,
              file: child.targetIdentity,
            },
            directory.identity,
            () => options.hooks?.afterConfigBound?.(lexicalPath),
          )
          configBytes += read.bytes ?? 0
          entries.set(lexicalPath, { kind: 'file', text: read.text ?? '' })
        }
      }
    }
    void realDirectories
    materializeAliases(entries, aliases, budgets)
    const tree = {
      entries: Object.fromEntries(
        [...entries].sort(([left], [right]) => comparePaths(left, right)),
      ),
    }
    if (!Schema.is(FileTreeSchema)(tree)) {
      throw typedError('workspace.path.not-confined', 'scanner produced an invalid FileTree')
    }
    return tree
  } catch (cause) {
    throw normalizeError(cause, `unable to read workspace root ${JSON.stringify(rootPath)}`)
  }
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

export const fileTreeFromNodeConfigCandidates = async (
  candidates: ReadonlyArray<string>,
  description: string,
  options: NodeFileTreeOptions = {},
): Promise<FileTree | null> => {
  const budgets = { ...DEFAULT_NODE_FILE_TREE_BUDGETS, ...options.budgets }
  const groups = new Map<string, Array<string>>()
  for (const candidate of candidates) {
    const absolute = resolve(candidate)
    const parent = dirname(absolute)
    const names = groups.get(parent) ?? []
    names.push(decodeChildSegment(basename(absolute)))
    groups.set(parent, names)
  }
  const found: Array<{
    parent: string
    parentIdentity: WorkerIdentity
    path: string
    entry: WorkerEntry
  }> = []
  for (const [parent, names] of groups) {
    let parentStat
    try {
      parentStat = await stat(parent)
    } catch (cause) {
      if (typeof cause === 'object' && cause !== null && Reflect.get(cause, 'code') === 'ENOENT') {
        continue
      }
      throw normalizeError(cause, `unable to inspect ${description} directory`)
    }
    const parentIdentity = toIdentity(parentStat)
    const result = await runWorker(parent, { mode: 'inspect', names }, parentIdentity)
    for (const entry of result.entries ?? []) {
      if (entry.kind === 'file' && entry.targetKind === 'file') {
        found.push({ parent, parentIdentity, path: resolve(parent, entry.name), entry })
      }
    }
  }
  found.sort((left, right) => comparePaths(left.path, right.path))
  if (found.length > 1) {
    throw typedError(
      'workspace.config.ambiguous',
      `multiple ${description} files found: ${found.map(({ path }) => JSON.stringify(path)).join(', ')}`,
    )
  }
  const selected = found[0]
  if (!selected) return null
  const read = await runWorker(
    selected.parent,
    {
      mode: 'read',
      name: selected.entry.name,
      maxBytes: budgets.configBytes,
      file: selected.entry.targetIdentity,
    },
    selected.parentIdentity,
  )
  const virtualName =
    extname(selected.path).toLowerCase() === '.toml' ? 'morphir.toml' : 'morphir.yaml'
  return {
    entries: Object.fromEntries([
      ['.', { kind: 'directory' }],
      [virtualName, { kind: 'file', text: read.text ?? '' }],
    ]) as FileTree['entries'],
  }
}
