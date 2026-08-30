/* global Buffer, TextDecoder, process */
import { constants } from 'node:fs'
import { lstat, open, opendir, realpath, stat } from 'node:fs/promises'

const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`)
const fail = (code, message) => {
  send({ type: 'error', code, message })
  process.exitCode = 1
}
const identity = (value) => ({ dev: value.dev, ino: value.ino })
const sameIdentity = (left, right) => left.dev === right.dev && left.ino === right.ino
const childSegment = (value) =>
  typeof value === 'string' &&
  value !== '' &&
  value !== '.' &&
  value !== '..' &&
  !value.includes('/') &&
  !value.includes('\\') &&
  !/^[A-Za-z]:/.test(value)
const waitForGo = () =>
  new Promise((resolve, reject) => {
    process.stdin.setEncoding('utf8')
    process.stdin.once('data', (value) =>
      value.trim() === 'go' ? resolve() : reject(new Error('invalid scanner command')),
    )
    process.stdin.once('error', reject)
  })
const kind = (metadata) =>
  metadata.isDirectory() ? 'directory' : metadata.isFile() ? 'file' : 'other'

const list = async (command) => {
  if (
    !Number.isSafeInteger(command.maxEntries) ||
    command.maxEntries < 0 ||
    !Number.isSafeInteger(command.maxAliases) ||
    command.maxAliases < 0
  ) {
    throw new Error('invalid constrained list command')
  }
  const directory = await opendir('.')
  const directoryStat = await stat('.')
  send({ type: 'ready', directory: identity(directoryStat) })
  await waitForGo()
  const entries = []
  let aliases = 0
  for await (const entry of directory) {
    if (entries.length >= command.maxEntries) {
      throw Object.assign(new Error(`real entries budget ${command.maxEntries}`), {
        code: 'workspace.traversal.resource-limit',
      })
    }
    if (!childSegment(entry.name)) {
      throw Object.assign(
        new Error(`invalid workspace path segment ${JSON.stringify(entry.name)}`),
        {
          code: 'workspace.path.not-confined',
        },
      )
    }
    const metadata = await lstat(entry.name)
    const resolved = await realpath(entry.name)
    const target = await stat(resolved)
    if (metadata.isSymbolicLink() && target.isDirectory()) {
      if (aliases >= command.maxAliases) {
        throw Object.assign(new Error(`alias edges budget ${command.maxAliases}`), {
          code: 'workspace.alias.resource-limit',
        })
      }
      aliases += 1
    }
    entries.push({
      name: entry.name,
      kind: metadata.isSymbolicLink() ? 'symlink' : kind(metadata),
      identity: identity(metadata),
      resolved,
      targetKind: kind(target),
      targetIdentity: identity(target),
    })
  }
  entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
  send({ type: 'result', entries })
}

const inspect = async (command) => {
  if (!Array.isArray(command.names) || command.names.some((name) => !childSegment(name))) {
    throw new Error('invalid constrained inspect command')
  }
  const directory = await stat('.')
  send({ type: 'ready', directory: identity(directory) })
  await waitForGo()
  const entries = []
  for (const name of [...new Set(command.names)].sort()) {
    let metadata
    try {
      metadata = await lstat(name)
    } catch (cause) {
      if (cause?.code === 'ENOENT') continue
      throw cause
    }
    if (metadata.isSymbolicLink()) continue
    const resolved = await realpath(name)
    const target = await stat(resolved)
    entries.push({
      name,
      kind: kind(metadata),
      identity: identity(metadata),
      resolved,
      targetKind: kind(target),
      targetIdentity: identity(target),
    })
  }
  send({ type: 'result', entries })
}

const read = async (command) => {
  if (
    !childSegment(command.name) ||
    !Number.isSafeInteger(command.maxBytes) ||
    command.maxBytes < 0
  ) {
    throw new Error('invalid constrained read command')
  }
  const directory = await stat('.')
  const noFollow = process.platform === 'win32' ? 0 : constants.O_NOFOLLOW
  const handle = await open(command.name, constants.O_RDONLY | noFollow)
  try {
    const file = await handle.stat()
    if (!file.isFile() || !sameIdentity(identity(file), command.file)) {
      throw Object.assign(new Error('configuration identity changed'), {
        code: 'workspace.path.not-confined',
      })
    }
    send({ type: 'ready', directory: identity(directory), file: identity(file) })
    await waitForGo()
    const chunks = []
    let total = 0
    while (true) {
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, command.maxBytes - total + 1))
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null)
      if (bytesRead === 0) break
      total += bytesRead
      if (total > command.maxBytes) {
        throw Object.assign(new Error(`configuration bytes budget ${command.maxBytes}`), {
          code: 'workspace.traversal.resource-limit',
        })
      }
      chunks.push(buffer.subarray(0, bytesRead))
    }
    const bytes = Buffer.concat(chunks, total)
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    send({ type: 'result', text, bytes: total })
  } finally {
    await handle.close()
  }
}

try {
  const command = JSON.parse(process.argv[2] ?? 'null')
  if (command?.mode === 'list') await list(command)
  else if (command?.mode === 'inspect') await inspect(command)
  else if (command?.mode === 'read') await read(command)
  else throw new Error('unsupported scanner command')
} catch (cause) {
  fail(cause?.code, cause instanceof Error ? cause.message : 'confined scanner failed')
}
