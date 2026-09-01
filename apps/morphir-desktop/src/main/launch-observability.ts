import type { ManagedCorrelation } from './logging.ts'

export const DESKTOP_ERROR_CODES = {
  appReadyFailed: 'MORPHIR_DESKTOP_APP_READY_FAILED',
  crashReporterUnavailable: 'MORPHIR_DESKTOP_CRASH_REPORTER_UNAVAILABLE',
  rendererLoadFailed: 'MORPHIR_DESKTOP_RENDERER_LOAD_FAILED',
  mainUncaughtException: 'MORPHIR_DESKTOP_MAIN_UNCAUGHT_EXCEPTION',
  mainUnhandledRejection: 'MORPHIR_DESKTOP_MAIN_UNHANDLED_REJECTION',
  rendererCrashed: 'MORPHIR_DESKTOP_RENDERER_CRASHED',
  childProcessCrashed: 'MORPHIR_DESKTOP_CHILD_PROCESS_CRASHED',
} as const

export type DesktopErrorCode = (typeof DESKTOP_ERROR_CODES)[keyof typeof DESKTOP_ERROR_CODES]
export type DesktopCrashKind = 'main' | 'renderer' | 'child-process'

type EventDetails = Readonly<Record<string, unknown>>

export interface LaunchLogger {
  info(eventName: string, details?: EventDetails): void
  error(eventName: string, details?: EventDetails): void
}

export class DesktopLaunchObservability {
  #terminalErrorCode: DesktopErrorCode | null = null

  constructor(private readonly logger: LaunchLogger) {}

  ready(): void {
    this.logger.info('desktop.ready', { outcome: 'success' })
  }

  failed(errorCode: DesktopErrorCode, errorType: string, nativeErrorCode?: number): void {
    this.#terminalErrorCode = errorCode
    this.logger.error('desktop.launch.failed', {
      error_code: errorCode,
      error_type: errorType,
      ...(nativeErrorCode === undefined ? {} : { native_error_code: nativeErrorCode }),
    })
  }

  crashed(
    errorCode: DesktopErrorCode,
    crashKind: DesktopCrashKind,
    reason: string,
    exitCode?: number,
  ): void {
    this.#terminalErrorCode = errorCode
    this.logger.error('desktop.crash', {
      error_code: errorCode,
      crash_kind: crashKind,
      reason,
      ...(exitCode === undefined ? {} : { exit_code: exitCode }),
    })
  }

  exit(exitCode: number): void {
    const failure = exitCode !== 0 || this.#terminalErrorCode !== null
    const details = {
      outcome: failure ? 'failure' : 'success',
      exit_code: exitCode,
      ...(this.#terminalErrorCode ? { error_code: this.#terminalErrorCode } : {}),
    }
    if (failure) this.logger.error('desktop.exit', details)
    else this.logger.info('desktop.exit', details)
  }
}

export class DesktopExitSignal {
  #recorded = false

  constructor(
    private readonly launch: DesktopLaunchObservability,
    private readonly closeLog: () => void,
  ) {}

  record(exitCode: number): void {
    if (this.#recorded) return
    this.#recorded = true
    this.launch.exit(exitCode)
    this.closeLog()
  }

  immediately(exitCode: number, terminate: (exitCode: number) => void): void {
    try {
      this.record(exitCode)
    } finally {
      terminate(exitCode)
    }
  }
}

export class DesktopReadySignal {
  #rendererReady = false
  readonly #pending = new Map<string, ManagedCorrelation>()

  constructor(private readonly emit: (correlation?: ManagedCorrelation) => void) {}

  rendererReady(): void {
    if (this.#rendererReady) return
    this.#rendererReady = true
    this.emit()
    for (const correlation of this.#pending.values()) this.emit(correlation)
    this.#pending.clear()
  }

  forwarded(correlation: ManagedCorrelation): void {
    if (this.#rendererReady) this.emit(correlation)
    else this.#pending.set(correlation.launchId, correlation)
  }
}
