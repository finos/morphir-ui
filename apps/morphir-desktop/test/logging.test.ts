import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import {
  DesktopLogger,
  desktopCrashDirectory,
  desktopLogLocation,
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
})

describe('desktop correlation', () => {
  test('accepts bounded launcher IDs and rejects log-field injection', () => {
    expect(
      inheritedCorrelation({
        MORPHIR_PARENT_OPERATION_ID: 'op-123e4567-e89b-42d3-a456-426614174000',
        MORPHIR_LAUNCH_ID: 'launch-123e4567-e89b-42d3-a456-426614174001',
      }),
    ).toEqual({
      parentOperationId: 'op-123e4567-e89b-42d3-a456-426614174000',
      launchId: 'launch-123e4567-e89b-42d3-a456-426614174001',
    })
    expect(inheritedCorrelation({ MORPHIR_PARENT_OPERATION_ID: 'bad\nvalue' })).toEqual({})
  })
})

describe('DesktopLogger', () => {
  test('writes correlated versioned events without secret sentinels or URL credentials', () => {
    const lines: string[] = []
    const logger = new DesktopLogger(
      {
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

    expect(() => logger.info('desktop.session.start')).not.toThrow()
    expect(() => logger.info('desktop.session.exit')).not.toThrow()
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('Desktop logging disabled')
  })
})
