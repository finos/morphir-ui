/* global Buffer, TextDecoder, process */
import { constants } from 'node:fs'
import { lstat, open, opendir, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, sep } from 'node:path'

const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`)
const identity = (value) => ({ dev: value.dev.toString(), ino: value.ino.toString() })
const error = (code, message) => Object.assign(new Error(message), { code })
const segment = (value) =>
  typeof value === 'string' &&
  value !== '' &&
  value !== '.' &&
  value !== '..' &&
  !value.includes('/') &&
  !value.includes('\\') &&
  !/^[A-Za-z]:/.test(value)
const waitForGo = () =>
  new Promise((resolve, reject) => {
    const cleanup = () => {
      process.stdin.off('data', data)
      process.stdin.off('error', failed)
    }
    const data = (value) => {
      cleanup()
      if (value.trim() === 'go') resolve()
      else reject(new Error('invalid scanner command'))
    }
    const failed = (cause) => {
      cleanup()
      reject(cause)
    }
    process.stdin.setEncoding('utf8')
    process.stdin.once('data', data)
    process.stdin.once('error', failed)
  })
const boundary = async (kind, path) => {
  send({ type: 'boundary', kind, path })
  await waitForGo()
}
const recognized = (path) => {
  const parts = path.split('/')
  const name = parts.at(-1)
  return (
    [
      'morphir.toml',
      'morphir.yaml',
      'morphir.json',
      'morphir.user.toml',
      'morphir.user.yaml',
    ].includes(name) ||
    (['config.toml', 'config.yaml', 'config.user.toml', 'config.user.yaml'].includes(name) &&
      parts.slice(-3, -1).join('/') === '.config/morphir')
  )
}
const confined = (root, target) => {
  const value = relative(root, target)
  if (isAbsolute(value) || value === '..' || value.startsWith(`..${sep}`))
    throw error('workspace.path.not-confined', `${target} is outside granted root`)
  return value === '' ? '.' : value.split(sep).join('/')
}
const exceed = (kind, resource, maximum) => {
  throw error(`workspace.${kind}.resource-limit`, `${resource} budget ${maximum}`)
}
const charge = (state, resource, maximum, kind = 'traversal') => {
  if (state[resource] >= maximum) exceed(kind, resource, maximum)
  state[resource] += 1
}
const readHandle = async (handle, maximum) => {
  const chunks = []
  let bytes = 0
  while (true) {
    const buffer = Buffer.allocUnsafe(Math.max(1, Math.min(64 * 1024, maximum - bytes + 1)))
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, null)
    if (!bytesRead) break
    if (bytes + bytesRead > maximum) exceed('traversal', 'configBytes', maximum)
    bytes += bytesRead
    chunks.push(buffer.subarray(0, bytesRead))
  }
  return {
    text: new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes)),
    bytes,
  }
}
const heapPush = (heap, item) => {
  heap.push(item)
  let index = heap.length - 1
  while (index) {
    const parent = (index - 1) >> 1
    if (heap[parent].key <= item.key) break
    heap[index] = heap[parent]
    index = parent
  }
  heap[index] = item
}
const heapPop = (heap) => {
  const first = heap[0]
  const last = heap.pop()
  if (heap.length && last) {
    let index = 0
    while (true) {
      let child = index * 2 + 1
      if (child >= heap.length) break
      if (child + 1 < heap.length && heap[child + 1].key < heap[child].key) child += 1
      if (heap[child].key >= last.key) break
      heap[index] = heap[child]
      index = child
    }
    heap[index] = last
  }
  return first
}
const hasAncestor = (node, edge) => {
  for (let cursor = node; cursor; cursor = cursor.parent) if (cursor.edge === edge) return true
  return false
}

const scan = async (command) => {
  const budgets = command.budgets
  const rootHandle = await opendir('.')
  const rootStat = await stat('.', { bigint: true })
  send({ type: 'ready', directory: identity(rootStat) })
  await waitForGo()
  const state = {
    realDirectories: 0,
    realEntries: 0,
    configBytes: 0,
    aliasEdges: 0,
    queuedExpansions: 0,
    processedExpansions: 0,
    generatedEntries: 0,
    totalWork: 0,
  }
  charge(state, 'realDirectories', budgets.realDirectories)
  const entries = new Map([['.', { kind: 'directory' }]])
  const aliases = []
  const visited = new Set([command.canonicalRoot])
  const queue = [{ handle: rootHandle, path: '.', depth: 0 }]
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const directory = queue[cursor]
    if (cursor) await boundary('directory', directory.path)
    const names = []
    for await (const child of directory.handle) {
      charge(state, 'realEntries', budgets.realEntries)
      if (!segment(child.name))
        throw error(
          'workspace.path.not-confined',
          `invalid path segment ${JSON.stringify(child.name)}`,
        )
      names.push(child.name)
    }
    names.sort()
    for (const name of names) {
      const lexical = directory.path === '.' ? name : `${directory.path}/${name}`
      const native = `./${lexical.split('/').join(sep)}`
      const metadata = await lstat(native, { bigint: true })
      const resolved = await realpath(native)
      const targetPath = confined(command.canonicalRoot, resolved)
      const target = await stat(resolved, { bigint: true })
      if (metadata.isSymbolicLink() && target.isDirectory()) {
        charge(state, 'aliasEdges', budgets.aliasEdges, 'alias')
        aliases.push({ lexical, target: targetPath })
      } else if (target.isDirectory()) {
        if (directory.depth >= budgets.maxDepth) exceed('traversal', 'maxDepth', budgets.maxDepth)
        if (!visited.has(resolved)) {
          charge(state, 'realDirectories', budgets.realDirectories)
          const handle = await opendir(native)
          visited.add(resolved)
          entries.set(lexical, { kind: 'directory' })
          queue.push({ handle, path: lexical, depth: directory.depth + 1 })
        }
      } else if (target.isFile() && recognized(lexical)) {
        const handle = await open(
          metadata.isSymbolicLink() ? resolved : native,
          constants.O_RDONLY |
            (metadata.isSymbolicLink() || process.platform === 'win32' ? 0 : constants.O_NOFOLLOW),
        )
        try {
          const bound = await handle.stat({ bigint: true })
          if (!bound.isFile())
            throw error('workspace.path.not-confined', 'configuration identity changed')
          await boundary('config', lexical)
          const payload = await readHandle(handle, budgets.configBytes - state.configBytes)
          state.configBytes += payload.bytes
          entries.set(lexical, { kind: 'file', text: payload.text })
        } finally {
          await handle.close()
        }
      }
    }
  }
  const realEntries = []
  const edges = []
  if (aliases.length > 0) {
    for (const entry of entries) {
      charge(state, 'totalWork', budgets.totalWork, 'alias')
      realEntries.push(entry)
    }
    for (const alias of aliases) {
      charge(state, 'totalWork', budgets.totalWork, 'alias')
      edges.push(alias)
    }
    realEntries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    edges.sort((a, b) => (a.lexical < b.lexical ? -1 : a.lexical > b.lexical ? 1 : 0))
  }
  const heap = []
  edges.forEach((edge, index) => {
    charge(state, 'queuedExpansions', budgets.queuedExpansions, 'alias')
    heapPush(heap, {
      key: `${edge.lexical}\0${index}`,
      lexical: edge.lexical,
      edge: index,
      ancestry: { edge: index, parent: null },
    })
  })
  while (heap.length) {
    const expansion = heapPop(heap)
    charge(state, 'processedExpansions', budgets.processedExpansions, 'alias')
    charge(state, 'totalWork', budgets.totalWork, 'alias')
    const target = edges[expansion.edge].target
    for (const [path, entry] of realEntries) {
      charge(state, 'totalWork', budgets.totalWork, 'alias')
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
      const aliasPath = suffix === '' ? expansion.lexical : `${expansion.lexical}/${suffix}`
      if (!entries.has(aliasPath)) {
        charge(state, 'generatedEntries', budgets.generatedEntries, 'alias')
        if (entry.kind === 'file') {
          const bytes = Buffer.byteLength(entry.text)
          if (state.configBytes + bytes > budgets.configBytes)
            exceed('traversal', 'configBytes', budgets.configBytes)
          state.configBytes += bytes
        }
        entries.set(aliasPath, entry)
      }
    }
    for (let nestedIndex = 0; nestedIndex < edges.length; nestedIndex += 1) {
      charge(state, 'totalWork', budgets.totalWork, 'alias')
      if (hasAncestor(expansion.ancestry, nestedIndex)) continue
      const nested = edges[nestedIndex]
      const suffix =
        target === '.'
          ? nested.lexical
          : nested.lexical === target
            ? ''
            : nested.lexical.startsWith(`${target}/`)
              ? nested.lexical.slice(target.length + 1)
              : null
      if (suffix === null) continue
      charge(state, 'queuedExpansions', budgets.queuedExpansions, 'alias')
      const lexical = suffix === '' ? expansion.lexical : `${expansion.lexical}/${suffix}`
      heapPush(heap, {
        key: `${lexical}\0${nestedIndex}`,
        lexical,
        edge: nestedIndex,
        ancestry: { edge: nestedIndex, parent: expansion.ancestry },
      })
    }
  }
  const sorted = [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  let finalBytes = 0
  for (const [, entry] of sorted)
    if (entry.kind === 'file') finalBytes += Buffer.byteLength(entry.text)
  if (finalBytes !== state.configBytes) throw new Error('configuration byte accounting mismatch')
  send({
    type: 'result',
    tree: { entries: Object.fromEntries(sorted) },
    chargedConfigBytes: finalBytes,
  })
}

const mount = async (command) => {
  const directory = await stat('.', { bigint: true })
  send({ type: 'ready', directory: identity(directory) })
  await waitForGo()
  const found = []
  for (const name of [...new Set(command.names)].sort()) {
    if (!segment(name)) throw error('workspace.path.not-confined', 'invalid candidate name')
    try {
      await lstat(name, { bigint: true })
      const resolved = await realpath(name)
      if ((await stat(resolved, { bigint: true })).isFile()) found.push({ name, resolved })
    } catch (cause) {
      if (cause?.code !== 'ENOENT') throw cause
    }
  }
  if (found.length > 1) throw error('workspace.config.ambiguous', command.description)
  if (!found.length) {
    send({ type: 'result', tree: null, chargedConfigBytes: 0 })
    return
  }
  const selected = found[0]
  const handle = await open(selected.resolved, constants.O_RDONLY)
  try {
    const payload = await readHandle(handle, command.maxBytes)
    send({
      type: 'result',
      tree: {
        entries: {
          '.': { kind: 'directory' },
          [selected.name]: { kind: 'file', text: payload.text },
        },
      },
      chargedConfigBytes: payload.bytes,
    })
  } finally {
    await handle.close()
  }
}

try {
  const command = JSON.parse(process.argv[2] ?? 'null')
  if (command?.mode === 'scan') await scan(command)
  else if (command?.mode === 'mount') await mount(command)
  else throw new Error('unsupported scanner command')
} catch (cause) {
  send({
    type: 'error',
    code: cause?.code,
    message: cause instanceof Error ? cause.message : 'scanner failed',
  })
  process.exitCode = 1
} finally {
  process.stdin.pause()
  process.stdin.destroy()
}
