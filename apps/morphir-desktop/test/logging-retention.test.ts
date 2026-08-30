import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  enforceDesktopCrashRetention,
  enforceDesktopLogRetention,
} from '../src/main/logging-retention.ts'

const roots: string[] = []
const tempRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'morphir-desktop-retention-'))
  roots.push(root)
  return root
}

const session = (root: string, day: string, timestamp: string, pid: number, id: string): string =>
  join(root, day, `${timestamp}-${pid}-${id}.jsonl`)

const put = (path: string, bytes: number, modified: Date): void => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, 'x'.repeat(bytes))
  utimesSync(path, modified, modified)
}

afterEach(() => {
  roots.forEach((root) => rmSync(root, { recursive: true, force: true }))
  roots.length = 0
})

describe('Desktop log retention', () => {
  test('removes expired managed logs but preserves live sessions and unknown files', () => {
    const root = tempRoot()
    const old = new Date('2026-08-01T00:00:00Z')
    const expired = session(
      root,
      '2026-08-01',
      '20260801T000000.000Z',
      10,
      '123e4567-e89b-42d3-a456-426614174000',
    )
    const active = session(
      root,
      '2026-08-01',
      '20260801T000001.000Z',
      11,
      '123e4567-e89b-42d3-a456-426614174001',
    )
    const unknown = join(root, '2026-08-01', 'keep-me.txt')
    put(expired, 10, old)
    put(active, 10, old)
    put(`${active}.active`, 2, old)
    put(unknown, 10, old)

    const result = enforceDesktopLogRetention(root, {
      now: new Date('2026-08-30T00:00:00Z'),
      retentionMs: 14 * 24 * 60 * 60 * 1000,
      maxBytes: 100,
      isProcessAlive: (pid) => pid === 11,
    })

    expect(result).toEqual({ removedFiles: 1, removedBytes: 10, skippedEntries: 0 })
    expect(existsSync(expired)).toBeFalse()
    expect(existsSync(active)).toBeTrue()
    expect(existsSync(`${active}.active`)).toBeTrue()
    expect(existsSync(unknown)).toBeTrue()
  })

  test('clears dead markers and removes oldest sessions until under the size limit', () => {
    const root = tempRoot()
    const first = session(
      root,
      '2026-08-29',
      '20260829T000000.000Z',
      20,
      '123e4567-e89b-42d3-a456-426614174002',
    )
    const second = session(
      root,
      '2026-08-29',
      '20260829T000001.000Z',
      21,
      '123e4567-e89b-42d3-a456-426614174003',
    )
    const newest = session(
      root,
      '2026-08-29',
      '20260829T000002.000Z',
      22,
      '123e4567-e89b-42d3-a456-426614174004',
    )
    put(first, 10, new Date('2026-08-29T00:00:00Z'))
    put(`${first}.active`, 2, new Date('2026-08-29T00:00:00Z'))
    put(second, 10, new Date('2026-08-29T00:00:01Z'))
    put(newest, 10, new Date('2026-08-29T00:00:02Z'))

    const result = enforceDesktopLogRetention(root, {
      now: new Date('2026-08-30T00:00:00Z'),
      retentionMs: 14 * 24 * 60 * 60 * 1000,
      maxBytes: 15,
      isProcessAlive: () => false,
    })

    expect(result).toEqual({ removedFiles: 2, removedBytes: 20, skippedEntries: 0 })
    expect(existsSync(first)).toBeFalse()
    expect(existsSync(`${first}.active`)).toBeFalse()
    expect(existsSync(second)).toBeFalse()
    expect(existsSync(newest)).toBeTrue()
  })
})

describe('Desktop crash retention', () => {
  test('removes only expired Crashpad minidumps and preserves recent or unknown content', () => {
    const root = tempRoot()
    const expired = join(root, 'pending', 'old-report.dmp')
    const recent = join(root, 'completed', 'recent-report.dmp')
    const unknown = join(root, 'settings.dat')
    put(expired, 20, new Date('2026-08-01T00:00:00Z'))
    put(recent, 20, new Date('2026-08-29T00:00:00Z'))
    put(unknown, 20, new Date('2026-08-01T00:00:00Z'))

    const result = enforceDesktopCrashRetention(root, {
      now: new Date('2026-08-30T00:00:00Z'),
      retentionMs: 14 * 24 * 60 * 60 * 1000,
    })

    expect(result).toEqual({ removedFiles: 1, removedBytes: 20, skippedEntries: 0 })
    expect(existsSync(expired)).toBeFalse()
    expect(existsSync(recent)).toBeTrue()
    expect(existsSync(unknown)).toBeTrue()
  })
})
