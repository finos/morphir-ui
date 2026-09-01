import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  correlationAdditionalData,
  DesktopLogger,
  createDesktopLogSession,
  desktopCrashDirectory,
  desktopLogLocation,
  forwardedCorrelation,
  inheritedCorrelation,
  type DesktopLogEvent,
} from '../src/main/logging.ts'

describe('desktop log location', () => {
  test('uses a per-process JSONL session beneath Morphir Home', () => {
    const location = desktopLogLocation(
      { MORPHIR_HOME: '/morphir-home' },
      new Date('2026-08-30T03:04:05.678Z'),
      42,
      'session-id',
    )

    expect(location).toBe(
      join(
        '/morphir-home',
        'logs',
        'desktop',
        '2026-08-30',
        '20260830T030405.678Z-42-session-id.jsonl',
      ),
    )
    expect(desktopCrashDirectory({ MORPHIR_HOME: '/morphir-home' })).toBe(
      join('/morphir-home', 'logs', 'desktop', 'crashes'),
    )
  })

  test('marks a live session and removes the marker on close', () => {
    const root = mkdtempSync(join(tmpdir(), 'morphir-desktop-session-'))
    try {
      const session = createDesktopLogSession({ MORPHIR_LOG_DIR: root })
      session.logger.info('desktop.session.start')

      expect(existsSync(session.logPath)).toBeTrue()
      expect(existsSync(`${session.logPath}.active`)).toBeTrue()
      session.close()
      expect(existsSync(`${session.logPath}.active`)).toBeFalse()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('desktop correlation', () => {
  test('accepts only a complete bounded launcher correlation pair', () => {
    expect(
      inheritedCorrelation({
        MORPHIR_PARENT_OPERATION_ID: 'op-123E4567-E89B-42D3-A456-426614174000',
        MORPHIR_LAUNCH_ID: 'launch-123E4567-E89B-42D3-A456-426614174001',
      }),
    ).toEqual({
      kind: 'managed',
      parentOperationId: 'op-123e4567-e89b-42d3-a456-426614174000',
      launchId: 'launch-123e4567-e89b-42d3-a456-426614174001',
    })
    expect(
      inheritedCorrelation({
        MORPHIR_PARENT_OPERATION_ID: 'op-123e4567-e89b-42d3-a456-426614174000',
      }),
    ).toEqual({ kind: 'standalone' })
    expect(
      inheritedCorrelation({
        MORPHIR_LAUNCH_ID: 'launch-123e4567-e89b-42d3-a456-426614174001',
      }),
    ).toEqual({ kind: 'standalone' })
    expect(inheritedCorrelation({ MORPHIR_PARENT_OPERATION_ID: 'bad\nvalue' })).toEqual({
      kind: 'standalone',
    })
  })

  test('round-trips only a valid pair through Electron single-instance data', () => {
    const managed = inheritedCorrelation({
      MORPHIR_PARENT_OPERATION_ID: 'op-123e4567-e89b-42d3-a456-426614174000',
      MORPHIR_LAUNCH_ID: 'launch-123e4567-e89b-42d3-a456-426614174001',
    })

    expect(correlationAdditionalData(managed)).toEqual({
      parentOperationId: 'op-123e4567-e89b-42d3-a456-426614174000',
      launchId: 'launch-123e4567-e89b-42d3-a456-426614174001',
    })
    expect(forwardedCorrelation(correlationAdditionalData(managed))).toEqual(managed)
    expect(
      forwardedCorrelation({
        parentOperationId: 'op-123e4567-e89b-42d3-a456-426614174000',
        launchId: 'bad\nlaunch',
        projectContents: 'PRIVATE_SOURCE_SENTINEL',
      }),
    ).toEqual({ kind: 'standalone' })
  })
})

describe('DesktopLogger', () => {
  test('writes correlated versioned events without secret sentinels or URL credentials', () => {
    const lines: string[] = []
    const logger = new DesktopLogger(
      {
        kind: 'managed',
        sessionId: 'session-id',
        operationId: 'op-desktop',
        parentOperationId: 'op-parent',
        launchId: 'launch-id',
        processId: 42,
        now: () => new Date('2026-08-30T03:04:05.678Z'),
      },
      (line) => lines.push(line),
    )

    logger.error('desktop.renderer.gone', {
      reason: 'Bearer secret-token',
      source: 'https://example.test/download?token=secret#fragment',
      github: 'ghp_abcdefghijklmnopqrstuvwxyz123456',
      operation_id: 'caller-cannot-override-correlation',
    })

    const event = JSON.parse(lines[0]!) as DesktopLogEvent
    expect(event.timestamp).toBe('2026-08-30T03:04:05.678Z')
    expect(event.level).toBe('ERROR')
    expect(event.fields).toMatchObject({
      schema_version: 1,
      component: 'desktop',
      process_id: 42,
      session_id: 'session-id',
      operation_id: 'op-desktop',
      parent_operation_id: 'op-parent',
      launch_id: 'launch-id',
      event_name: 'desktop.renderer.gone',
    })
    expect(lines[0]).not.toContain('secret-token')
    expect(lines[0]).not.toContain('abcdefghijklmnopqrstuvwxyz123456')
    expect(lines[0]).not.toContain('?token=')
    expect(lines[0]).not.toContain('#fragment')
  })

  test('logging failure warns once and never masks the caller', () => {
    const warnings: string[] = []
    const logger = new DesktopLogger(
      {
        kind: 'standalone',
        sessionId: 'session-id',
        operationId: 'op-desktop',
        processId: 42,
        now: () => new Date('2026-08-30T03:04:05.678Z'),
        warn: (message) => warnings.push(message),
      },
      () => {
        throw new Error('disk full')
      },
    )

    const managed = forwardedCorrelation({
      parentOperationId: 'op-123e4567-e89b-42d3-a456-426614174000',
      launchId: 'launch-123e4567-e89b-42d3-a456-426614174001',
    })
    if (managed.kind !== 'managed') throw new Error('expected managed correlation')

    expect(() => logger.info('desktop.session.start')).not.toThrow()
    expect(() => logger.forManagedLaunch(managed).info('desktop.ready')).not.toThrow()
    expect(() => logger.info('desktop.exit')).not.toThrow()
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('Desktop logging disabled')
  })

  test('creates a correlated view for a forwarded managed launch', () => {
    const lines: string[] = []
    const logger = new DesktopLogger(
      {
        kind: 'standalone',
        sessionId: 'session-id',
        operationId: 'op-desktop',
        processId: 42,
        now: () => new Date('2026-08-30T03:04:05.678Z'),
      },
      (line) => lines.push(line),
    )
    const managed = forwardedCorrelation({
      parentOperationId: 'op-123e4567-e89b-42d3-a456-426614174000',
      launchId: 'launch-123e4567-e89b-42d3-a456-426614174001',
    })

    if (managed.kind !== 'managed') throw new Error('expected managed correlation')
    logger.forManagedLaunch(managed).info('desktop.ready')

    const event = JSON.parse(lines[0]!) as DesktopLogEvent
    expect(event.fields).toMatchObject({
      operation_id: 'op-desktop',
      parent_operation_id: managed.parentOperationId,
      launch_id: managed.launchId,
      event_name: 'desktop.ready',
    })
  })
})
