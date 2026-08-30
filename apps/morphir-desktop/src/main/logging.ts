import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { morphirHome } from './config.ts'
import { enforceDesktopLogRetention, type DesktopRetentionResult } from './logging-retention.ts'

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
const OPERATION_ID = new RegExp(`^op-${UUID}$`, 'i')
const LAUNCH_ID = new RegExp(`^launch-${UUID}$`, 'i')
const GITHUB_TOKEN = /\bgh[pousr]_[A-Za-z0-9_]{10,}\b/gi
const BEARER_TOKEN = /\bBearer\s+[^\s,;]+/gi
const LABELED_SECRET = /\b(token|password|secret|authorization|cookie)\s*([=:])\s*[^\s,;]+/gi
const URL_PATTERN = /https?:\/\/[^\s"'<>]+/gi

type LogValue = string | number | boolean | null
type EventDetails = Readonly<Record<string, unknown>>

export interface DesktopLogEvent {
  timestamp: string
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'
  fields: Record<string, LogValue>
}

export interface DesktopLogContext {
  sessionId: string
  operationId: string
  parentOperationId?: string
  launchId?: string
  processId: number
  now?: () => Date
  warn?: (message: string) => void
}

export interface InheritedCorrelation {
  parentOperationId?: string
  launchId?: string
}

const validCorrelationId = (value: string | undefined, pattern: RegExp): string | undefined =>
  value && pattern.test(value) ? value : undefined

export const inheritedCorrelation = (
  env: Record<string, string | undefined> = process.env,
): InheritedCorrelation => {
  const parentOperationId = validCorrelationId(env['MORPHIR_PARENT_OPERATION_ID'], OPERATION_ID)
  const launchId = validCorrelationId(env['MORPHIR_LAUNCH_ID'], LAUNCH_ID)
  return {
    ...(parentOperationId ? { parentOperationId } : {}),
    ...(launchId ? { launchId } : {}),
  }
}

const withoutUrlCredentials = (value: string): string =>
  value.replace(URL_PATTERN, (candidate) => {
    try {
      const url = new URL(candidate)
      url.username = ''
      url.password = ''
      url.search = ''
      url.hash = ''
      return url.toString()
    } catch {
      return '[REDACTED URL]'
    }
  })

export const redactLogText = (value: string): string =>
  withoutUrlCredentials(value)
    .replace(GITHUB_TOKEN, '[REDACTED]')
    .replace(BEARER_TOKEN, 'Bearer [REDACTED]')
    .replace(LABELED_SECRET, '$1$2[REDACTED]')

const safeValue = (value: unknown): LogValue => {
  if (typeof value === 'string') return redactLogText(value)
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'boolean' || value === null) return value
  return '[omitted]'
}

export const desktopLogDirectory = (env: Record<string, string | undefined>): string => {
  const configured = env['MORPHIR_LOG_DIR']
  return configured && configured.length > 0
    ? configured
    : join(morphirHome(env), 'logs', 'desktop')
}

export const desktopCrashDirectory = (
  env: Record<string, string | undefined> = process.env,
): string => join(desktopLogDirectory(env), 'crashes')

const timestampFilePart = (now: Date): string =>
  now.toISOString().replaceAll('-', '').replaceAll(':', '')

export const desktopLogLocation = (
  env: Record<string, string | undefined>,
  now: Date,
  processId: number,
  sessionId: string,
): string => {
  const root = desktopLogDirectory(env)
  const date = now.toISOString().slice(0, 10)
  return join(root, date, `${timestampFilePart(now)}-${processId}-${sessionId}.jsonl`)
}

export class DesktopLogger {
  private disabled = false
  private readonly now: () => Date
  private readonly warnOnce: (message: string) => void

  constructor(
    private readonly context: DesktopLogContext,
    private readonly append: (line: string) => void,
  ) {
    this.now = context.now ?? (() => new Date())
    this.warnOnce = context.warn ?? ((message) => console.error(message))
  }

  debug(eventName: string, details: EventDetails = {}): void {
    this.write('DEBUG', eventName, details)
  }

  info(eventName: string, details: EventDetails = {}): void {
    this.write('INFO', eventName, details)
  }

  warn(eventName: string, details: EventDetails = {}): void {
    this.write('WARN', eventName, details)
  }

  error(eventName: string, details: EventDetails = {}): void {
    this.write('ERROR', eventName, details)
  }

  private write(level: DesktopLogEvent['level'], eventName: string, details: EventDetails): void {
    if (this.disabled) return
    const fields: Record<string, LogValue> = {
      ...Object.fromEntries(Object.entries(details).map(([key, value]) => [key, safeValue(value)])),
      schema_version: 1,
      component: 'desktop',
      process_id: this.context.processId,
      session_id: this.context.sessionId,
      operation_id: this.context.operationId,
      ...(this.context.parentOperationId
        ? { parent_operation_id: this.context.parentOperationId }
        : {}),
      ...(this.context.launchId ? { launch_id: this.context.launchId } : {}),
      event_name: eventName,
    }
    const event: DesktopLogEvent = { timestamp: this.now().toISOString(), level, fields }
    try {
      this.append(`${JSON.stringify(event)}\n`)
    } catch (error) {
      this.disabled = true
      const reason = error instanceof Error ? redactLogText(error.message) : 'unknown error'
      this.warnOnce(`Warning: Desktop logging disabled: ${reason}`)
    }
  }
}

export interface DesktopLogSession {
  logger: DesktopLogger
  logPath: string
  operationId: string
  sessionId: string
  retention: DesktopRetentionResult
  close: () => void
}

export const createDesktopLogSession = (
  env: Record<string, string | undefined> = process.env,
): DesktopLogSession => {
  const now = new Date()
  const sessionId = randomUUID()
  const operationId = `op-${randomUUID()}`
  const logPath = desktopLogLocation(env, now, process.pid, sessionId)
  const markerPath = `${logPath}.active`
  const context: DesktopLogContext = {
    sessionId,
    operationId,
    processId: process.pid,
    ...inheritedCorrelation(env),
  }
  let initializationError: unknown
  let retention: DesktopRetentionResult = {
    removedFiles: 0,
    removedBytes: 0,
    skippedEntries: 0,
  }
  try {
    mkdirSync(dirname(logPath), { recursive: true })
    retention = enforceDesktopLogRetention(desktopLogDirectory(env))
    writeFileSync(markerPath, String(process.pid), { encoding: 'utf8', flag: 'wx' })
  } catch (error) {
    initializationError = error
  }
  const append = initializationError
    ? () => {
        throw initializationError
      }
    : (line: string) => appendFileSync(logPath, line, 'utf8')
  let closed = false
  const close = (): void => {
    if (closed) return
    closed = true
    try {
      rmSync(markerPath)
    } catch {
      // A missing or inaccessible marker must not prevent Desktop shutdown.
    }
  }
  return {
    logger: new DesktopLogger(context, append),
    logPath,
    operationId,
    sessionId,
    retention,
    close,
  }
}
