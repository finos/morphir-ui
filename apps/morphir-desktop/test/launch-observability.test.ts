import { describe, expect, test } from 'bun:test'
import {
  DESKTOP_ERROR_CODES,
  DesktopLaunchObservability,
  DesktopReadySignal,
} from '../src/main/launch-observability.ts'

type RecordedEvent = {
  level: 'info' | 'error'
  name: string
  details: Readonly<Record<string, unknown>>
}

const recordingLogger = (events: RecordedEvent[]) => ({
  info: (name: string, details: Readonly<Record<string, unknown>> = {}) =>
    events.push({ level: 'info', name, details }),
  error: (name: string, details: Readonly<Record<string, unknown>> = {}) =>
    events.push({ level: 'error', name, details }),
})

describe('DesktopLaunchObservability', () => {
  test('records stable ready and normal-exit events without failure codes', () => {
    const events: RecordedEvent[] = []
    const launch = new DesktopLaunchObservability(recordingLogger(events))

    launch.ready()
    launch.exit(0)

    expect(events).toEqual([
      { level: 'info', name: 'desktop.ready', details: { outcome: 'success' } },
      {
        level: 'info',
        name: 'desktop.exit',
        details: { outcome: 'success', exit_code: 0 },
      },
    ])
  })

  test('records launch failure and carries its code into the exit event', () => {
    const events: RecordedEvent[] = []
    const launch = new DesktopLaunchObservability(recordingLogger(events))

    launch.failed(DESKTOP_ERROR_CODES.rendererLoadFailed, 'ElectronLoadError', -105)
    launch.exit(1)

    expect(events).toEqual([
      {
        level: 'error',
        name: 'desktop.launch.failed',
        details: {
          error_code: 'MORPHIR_DESKTOP_RENDERER_LOAD_FAILED',
          error_type: 'ElectronLoadError',
          native_error_code: -105,
        },
      },
      {
        level: 'error',
        name: 'desktop.exit',
        details: {
          outcome: 'failure',
          exit_code: 1,
          error_code: 'MORPHIR_DESKTOP_RENDERER_LOAD_FAILED',
        },
      },
    ])
  })

  test('records crashes by kind without accepting arbitrary payloads', () => {
    const events: RecordedEvent[] = []
    const launch = new DesktopLaunchObservability(recordingLogger(events))

    launch.crashed(DESKTOP_ERROR_CODES.rendererCrashed, 'renderer', 'crashed', 9)

    expect(events).toEqual([
      {
        level: 'error',
        name: 'desktop.crash',
        details: {
          error_code: 'MORPHIR_DESKTOP_RENDERER_CRASHED',
          crash_kind: 'renderer',
          reason: 'crashed',
          exit_code: 9,
        },
      },
    ])
    expect(DESKTOP_ERROR_CODES.crashReporterUnavailable).toBe(
      'MORPHIR_DESKTOP_CRASH_REPORTER_UNAVAILABLE',
    )
  })
})

describe('DesktopReadySignal', () => {
  test('queues forwarded launches until the renderer is ready and emits each once', () => {
    const emitted: string[] = []
    const ready = new DesktopReadySignal((correlation) =>
      emitted.push(correlation?.launchId ?? 'primary'),
    )
    const forwarded = {
      kind: 'managed' as const,
      parentOperationId: 'op-123e4567-e89b-42d3-a456-426614174000',
      launchId: 'launch-123e4567-e89b-42d3-a456-426614174001',
    }

    ready.forwarded(forwarded)
    ready.forwarded(forwarded)
    expect(emitted).toEqual([])

    ready.rendererReady()
    ready.rendererReady()
    expect(emitted).toEqual(['primary', forwarded.launchId])
  })

  test('emits a forwarded launch immediately after renderer readiness', () => {
    const emitted: string[] = []
    const ready = new DesktopReadySignal((correlation) =>
      emitted.push(correlation?.launchId ?? 'primary'),
    )
    const forwarded = {
      kind: 'managed' as const,
      parentOperationId: 'op-123e4567-e89b-42d3-a456-426614174000',
      launchId: 'launch-123e4567-e89b-42d3-a456-426614174001',
    }

    ready.rendererReady()
    ready.forwarded(forwarded)

    expect(emitted).toEqual(['primary', forwarded.launchId])
  })
})
