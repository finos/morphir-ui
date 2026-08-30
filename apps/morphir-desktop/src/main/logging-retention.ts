import { existsSync, lstatSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

const DAY_DIRECTORY = /^\d{4}-\d{2}-\d{2}$/
const SESSION_LOG =
  /^\d{8}T\d{6}\.\d{3}Z-(\d+)-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jsonl$/i

export const DEFAULT_DESKTOP_LOG_RETENTION_MS = 14 * 24 * 60 * 60 * 1000
export const DEFAULT_DESKTOP_LOG_MAX_BYTES = 100 * 1024 * 1024

interface ManagedSession {
  path: string
  size: number
  modifiedMs: number
  protected: boolean
}

export interface DesktopRetentionOptions {
  now?: Date
  retentionMs?: number
  maxBytes?: number
  isProcessAlive?: (pid: number) => boolean
}

export interface DesktopRetentionResult {
  removedFiles: number
  removedBytes: number
  skippedEntries: number
}

export type DesktopCrashRetentionOptions = Pick<DesktopRetentionOptions, 'now' | 'retentionMs'>

const processIsAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return !(error instanceof Error && 'code' in error && error.code === 'ESRCH')
  }
}

const inventory = (
  root: string,
  isProcessAlive: (pid: number) => boolean,
): { sessions: ManagedSession[]; skippedEntries: number } => {
  if (!existsSync(root)) return { sessions: [], skippedEntries: 0 }
  const sessions: ManagedSession[] = []
  let skippedEntries = 0
  let days
  try {
    days = readdirSync(root, { withFileTypes: true })
  } catch {
    return { sessions, skippedEntries: 1 }
  }

  for (const day of days) {
    if (!day.isDirectory() || !DAY_DIRECTORY.test(day.name)) continue
    const directory = join(root, day.name)
    let entries
    try {
      entries = readdirSync(directory, { withFileTypes: true })
    } catch {
      skippedEntries += 1
      continue
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const match = SESSION_LOG.exec(entry.name)
      if (!match) continue
      const path = join(directory, entry.name)
      const marker = `${path}.active`
      try {
        const metadata = statSync(path)
        let protectedSession = false
        if (existsSync(marker)) {
          const markerMetadata = lstatSync(marker)
          if (markerMetadata.isSymbolicLink() || !markerMetadata.isFile()) {
            protectedSession = true
            skippedEntries += 1
          } else if (isProcessAlive(Number(match[1]))) {
            protectedSession = true
          } else {
            try {
              rmSync(marker)
            } catch {
              protectedSession = true
              skippedEntries += 1
            }
          }
        }
        sessions.push({
          path,
          size: metadata.size,
          modifiedMs: metadata.mtimeMs,
          protected: protectedSession,
        })
      } catch {
        skippedEntries += 1
      }
    }
  }
  return { sessions, skippedEntries }
}

export const enforceDesktopLogRetention = (
  root: string,
  options: DesktopRetentionOptions = {},
): DesktopRetentionResult => {
  const now = options.now ?? new Date()
  const retentionMs = options.retentionMs ?? DEFAULT_DESKTOP_LOG_RETENTION_MS
  const maxBytes = options.maxBytes ?? DEFAULT_DESKTOP_LOG_MAX_BYTES
  const found = inventory(root, options.isProcessAlive ?? processIsAlive)
  const ordered = [...found.sessions].sort(
    (left, right) => left.modifiedMs - right.modifiedMs || left.path.localeCompare(right.path),
  )
  const selected = new Set<string>()
  const cutoff = now.getTime() - retentionMs

  for (const session of ordered) {
    if (!session.protected && session.modifiedMs < cutoff) selected.add(session.path)
  }

  let remainingBytes = ordered
    .filter((session) => !selected.has(session.path))
    .reduce((total, session) => total + session.size, 0)
  for (const session of ordered) {
    if (remainingBytes <= maxBytes) break
    if (session.protected || selected.has(session.path)) continue
    selected.add(session.path)
    remainingBytes -= session.size
  }

  let removedFiles = 0
  let removedBytes = 0
  let skippedEntries = found.skippedEntries
  for (const session of ordered) {
    if (!selected.has(session.path)) continue
    try {
      rmSync(session.path)
      removedFiles += 1
      removedBytes += session.size
    } catch {
      skippedEntries += 1
    }
  }
  return { removedFiles, removedBytes, skippedEntries }
}

const crashInventory = (
  directory: string,
  depth = 0,
): { dumps: Array<{ path: string; size: number; modifiedMs: number }>; skippedEntries: number } => {
  if (!existsSync(directory)) return { dumps: [], skippedEntries: 0 }
  if (depth > 8) return { dumps: [], skippedEntries: 1 }
  let entries
  try {
    entries = readdirSync(directory, { withFileTypes: true })
  } catch {
    return { dumps: [], skippedEntries: 1 }
  }

  const dumps: Array<{ path: string; size: number; modifiedMs: number }> = []
  let skippedEntries = 0
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      const nested = crashInventory(path, depth + 1)
      dumps.push(...nested.dumps)
      skippedEntries += nested.skippedEntries
      continue
    }
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.dmp')) continue
    try {
      const metadata = lstatSync(path)
      if (!metadata.isFile() || metadata.isSymbolicLink()) continue
      dumps.push({ path, size: metadata.size, modifiedMs: metadata.mtimeMs })
    } catch {
      skippedEntries += 1
    }
  }
  return { dumps, skippedEntries }
}

/// Remove expired Crashpad minidumps. Recent dumps remain available for a
/// diagnostic bundle even when many crashes occur in a short period.
export const enforceDesktopCrashRetention = (
  root: string,
  options: DesktopCrashRetentionOptions = {},
): DesktopRetentionResult => {
  const now = options.now ?? new Date()
  const retentionMs = options.retentionMs ?? DEFAULT_DESKTOP_LOG_RETENTION_MS
  const cutoff = now.getTime() - retentionMs
  const found = crashInventory(root)
  let removedFiles = 0
  let removedBytes = 0
  let skippedEntries = found.skippedEntries

  for (const dump of found.dumps) {
    if (dump.modifiedMs >= cutoff) continue
    try {
      rmSync(dump.path)
      removedFiles += 1
      removedBytes += dump.size
    } catch {
      skippedEntries += 1
    }
  }
  return { removedFiles, removedBytes, skippedEntries }
}
