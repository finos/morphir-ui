import { spawn } from 'node:child_process'
import { lstat, realpath, stat } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FileTreeSchema, type FileTree } from '@morphir/workspace'
import { Schema } from 'effect'

export type NodeFileTreeErrorCode =
  | 'workspace.path.not-confined'
  | 'workspace.traversal.unreadable'
  | 'workspace.traversal.resource-limit'
  | 'workspace.alias.resource-limit'
  | 'workspace.alias.cycle'
  | 'workspace.config.ambiguous'
export class NodeFileTreeError extends Error {
  readonly name = 'NodeFileTreeError'
  constructor(
    readonly code: NodeFileTreeErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(`${code}: ${message}`, options)
  }
}
export interface FileIdentity {
  readonly dev: string
  readonly ino: string
}
export const sameFileIdentity = (left: FileIdentity, right: FileIdentity): boolean =>
  left.dev === right.dev && left.ino === right.ino
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
export interface NodeFileTreeOptions {
  readonly budgets?: Partial<NodeFileTreeBudgets>
  readonly hooks?: {
    readonly afterDirectoryBound?: (path: string) => Promise<void> | void
    readonly beforeDirectoryOpen?: (path: string) => Promise<void> | void
    readonly beforeConfigOpen?: (path: string) => Promise<void> | void
    readonly afterConfigBound?: (path: string) => Promise<void> | void
  }
  readonly timeoutMs?: number
  readonly signal?: AbortSignal
  readonly lifecycle?: {
    readonly started?: (pid: number) => void
    readonly exited?: (pid: number) => void
  }
}
export interface NodeFileTreeScan {
  readonly tree: FileTree | null
  readonly chargedConfigBytes: number
}

const workerUrl = new URL('./node-file-tree-worker.mjs', import.meta.url)
const typed = (code: NodeFileTreeErrorCode, message: string, cause?: unknown) =>
  new NodeFileTreeError(code, message, { cause })
const normalize = (cause: unknown, context: string) =>
  cause instanceof NodeFileTreeError
    ? cause
    : typed('workspace.traversal.unreadable', context, cause)
const identity = (value: { readonly dev: bigint; readonly ino: bigint }): FileIdentity => ({
  dev: value.dev.toString(),
  ino: value.ino.toString(),
})
const codes = new Set<NodeFileTreeErrorCode>([
  'workspace.path.not-confined',
  'workspace.traversal.unreadable',
  'workspace.traversal.resource-limit',
  'workspace.alias.resource-limit',
  'workspace.alias.cycle',
  'workspace.config.ambiguous',
])

interface Message {
  readonly type: 'ready' | 'boundary' | 'result' | 'error'
  readonly directory?: FileIdentity
  readonly kind?: 'before-directory' | 'directory' | 'before-config' | 'config'
  readonly path?: string
  readonly tree?: unknown
  readonly chargedConfigBytes?: number
  readonly code?: string
  readonly message?: string
}
const runWorker = async (
  cwd: string,
  command: Record<string, unknown>,
  expected: FileIdentity,
  options: NodeFileTreeOptions,
): Promise<NodeFileTreeScan> => {
  try {
    return await new Promise((resolvePromise, rejectPromise) => {
      const child = spawn(process.execPath, [fileURLToPath(workerUrl), JSON.stringify(command)], {
        cwd,
        env: { ELECTRON_RUN_AS_NODE: '1' },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      const pid = child.pid
      if (pid !== undefined) options.lifecycle?.started?.(pid)
      let stdout = ''
      let stderr = ''
      let result: NodeFileTreeScan | undefined
      let failure: unknown
      let processing = Promise.resolve()
      const reject = (cause: unknown) => {
        failure ??= cause
        if (!child.killed) child.kill('SIGKILL')
      }
      const timer = setTimeout(
        () => reject(typed('workspace.traversal.unreadable', 'confined scanner timed out')),
        options.timeoutMs ?? 30_000,
      )
      const abort = () =>
        reject(typed('workspace.traversal.unreadable', 'confined scanner aborted'))
      options.signal?.addEventListener('abort', abort, { once: true })
      if (options.signal?.aborted) abort()
      child.on('error', reject)
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (chunk) => {
        stderr += chunk
        if (Buffer.byteLength(stderr) > 65_536)
          reject(typed('workspace.traversal.unreadable', 'scanner stderr exceeded limit'))
      })
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk) => {
        stdout += chunk
        if (Buffer.byteLength(stdout) > 128 * 1024 * 1024) {
          reject(typed('workspace.traversal.resource-limit', 'scanner output exceeded limit'))
          return
        }
        processing = processing
          .then(async () => {
            while (stdout.includes('\n')) {
              const newline = stdout.indexOf('\n')
              const line = stdout.slice(0, newline)
              stdout = stdout.slice(newline + 1)
              const message = JSON.parse(line) as Message
              if (message.type === 'error') {
                const code = codes.has(message.code as NodeFileTreeErrorCode)
                  ? (message.code as NodeFileTreeErrorCode)
                  : 'workspace.traversal.unreadable'
                reject(typed(code, message.message ?? 'scanner failed'))
                return
              }
              if (message.type === 'ready') {
                if (!message.directory || !sameFileIdentity(message.directory, expected)) {
                  reject(typed('workspace.path.not-confined', 'bound directory identity changed'))
                  return
                }
                await options.hooks?.afterDirectoryBound?.('.')
                child.stdin.write('go\n')
              } else if (message.type === 'boundary') {
                if (message.kind === 'before-directory')
                  await options.hooks?.beforeDirectoryOpen?.(message.path ?? '')
                else if (message.kind === 'directory')
                  await options.hooks?.afterDirectoryBound?.(message.path ?? '')
                else if (message.kind === 'before-config')
                  await options.hooks?.beforeConfigOpen?.(message.path ?? '')
                else await options.hooks?.afterConfigBound?.(message.path ?? '')
                child.stdin.write('go\n')
              } else {
                if (
                  !Number.isSafeInteger(message.chargedConfigBytes) ||
                  (message.chargedConfigBytes ?? -1) < 0 ||
                  (message.chargedConfigBytes ?? 0) >
                    (options.budgets?.configBytes ?? DEFAULT_NODE_FILE_TREE_BUDGETS.configBytes)
                ) {
                  reject(typed('workspace.traversal.unreadable', 'invalid scanner byte charge'))
                  return
                }
                const decoded =
                  message.tree === null
                    ? null
                    : Schema.decodeUnknownSync(FileTreeSchema)(message.tree)
                const tree =
                  decoded === null
                    ? null
                    : { entries: Object.fromEntries(Object.entries(decoded.entries)) }
                result = { tree, chargedConfigBytes: message.chargedConfigBytes ?? 0 }
                child.stdin.end()
              }
            }
          })
          .catch(reject)
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        options.signal?.removeEventListener('abort', abort)
        if (pid !== undefined) options.lifecycle?.exited?.(pid)
        if (failure) {
          rejectPromise(failure)
          return
        }
        void processing.then(() => {
          if (failure) rejectPromise(failure)
          else if (code !== 0 || !result)
            rejectPromise(new Error(`scanner exited ${code}: ${stderr.trim()}`))
          else resolvePromise(result)
        }, rejectPromise)
      })
    })
  } catch (cause) {
    throw normalize(cause, `unable to scan ${JSON.stringify(cwd)}`)
  }
}

export const scanNodeRoot = async (
  rootPath: string,
  options: NodeFileTreeOptions = {},
): Promise<NodeFileTreeScan> => {
  const budgets = { ...DEFAULT_NODE_FILE_TREE_BUDGETS, ...options.budgets }
  try {
    const granted = resolve(rootPath)
    await lstat(granted)
    const canonicalRoot = await realpath(granted)
    const metadata = await stat(canonicalRoot, { bigint: true })
    if (!metadata.isDirectory()) throw new Error('workspace root is not a directory')
    return await runWorker(
      granted,
      { mode: 'scan', canonicalRoot, budgets },
      identity(metadata),
      options,
    )
  } catch (cause) {
    throw normalize(cause, `unable to read workspace root ${JSON.stringify(rootPath)}`)
  }
}
export const fileTreeFromNodeRoot = async (
  rootPath: string,
  options: NodeFileTreeOptions = {},
): Promise<FileTree> => (await scanNodeRoot(rootPath, options)).tree!

export const scanNodeConfigCandidates = async (
  candidates: ReadonlyArray<string>,
  description: string,
  options: NodeFileTreeOptions = {},
): Promise<NodeFileTreeScan> => {
  const groups = new Map<string, string[]>()
  for (const candidate of [...new Set(candidates.map((candidate) => resolve(candidate)))].sort()) {
    const parent = dirname(candidate)
    const names = groups.get(parent) ?? []
    names.push(basename(candidate))
    groups.set(parent, names)
  }
  const found: NodeFileTreeScan[] = []
  for (const [parent, names] of groups) {
    let metadata
    try {
      metadata = await stat(parent, { bigint: true })
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw normalize(cause, `unable to inspect ${description}`)
    }
    const result = await runWorker(
      parent,
      {
        mode: 'mount',
        names,
        description,
        maxBytes: options.budgets?.configBytes ?? DEFAULT_NODE_FILE_TREE_BUDGETS.configBytes,
      },
      identity(metadata),
      { ...options, hooks: undefined },
    )
    if (result.tree) found.push(result)
  }
  if (found.length > 1) throw typed('workspace.config.ambiguous', description)
  return found[0] ?? { tree: null, chargedConfigBytes: 0 }
}
export const fileTreeFromNodeConfigCandidates = async (
  candidates: ReadonlyArray<string>,
  description: string,
  options: NodeFileTreeOptions = {},
): Promise<FileTree | null> =>
  (await scanNodeConfigCandidates(candidates, description, options)).tree
const ROOT_MODERN_PRIMARY_CONFIGURATIONS = [
  'morphir.toml',
  'morphir.yaml',
  '.morphir/morphir.toml',
  '.morphir/morphir.yaml',
  '.config/morphir/config.toml',
  '.config/morphir/config.yaml',
] as const

export const hasPrimaryConfiguration = (tree: FileTree): boolean => {
  const modern = ROOT_MODERN_PRIMARY_CONFIGURATIONS.filter(
    (path) => tree.entries[path]?.kind === 'file',
  )
  if (modern.length > 1)
    throw typed(
      'workspace.config.ambiguous',
      `multiple Morphir configurations found for workspace root: ${modern.join(', ')}`,
    )
  return modern.length === 1 || tree.entries['morphir.json']?.kind === 'file'
}
