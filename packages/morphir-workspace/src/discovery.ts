import { Schema } from 'effect'

const isRelativePath = (path: string): boolean => {
  if (path === '.') return true
  if (path.length === 0 || path.startsWith('/') || path.includes('\\') || /^[A-Za-z]:/.test(path)) {
    return false
  }

  return path
    .split('/')
    .every((component) => component !== '' && component !== '.' && component !== '..')
}

export const RelativePathSchema = Schema.String.pipe(
  Schema.filter(isRelativePath, { message: () => 'Expected a canonical, confined relative path' }),
)
export type RelativePath = Schema.Schema.Type<typeof RelativePathSchema>

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<JsonValue>
  | { readonly [key: string]: JsonValue }

const isJsonValue = (
  value: unknown,
  ancestors: WeakSet<object> = new WeakSet(),
): value is JsonValue => {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object' || ancestors.has(value)) return false

  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      const keys = Reflect.ownKeys(value)
      if (
        keys.some(
          (key) => typeof key !== 'string' || (key !== 'length' && !/^(0|[1-9][0-9]*)$/.test(key)),
        ) ||
        Object.keys(value).length !== value.length
      ) {
        return false
      }
      return value.every((item) => isJsonValue(item, ancestors))
    }

    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return false
    const keys = Reflect.ownKeys(value)
    if (keys.some((key) => typeof key !== 'string') || keys.length !== Object.keys(value).length) {
      return false
    }
    const record = value as Record<string, unknown>
    return (keys as ReadonlyArray<string>).every((key) => isJsonValue(record[key], ancestors))
  } catch {
    return false
  } finally {
    ancestors.delete(value)
  }
}

export const JsonValueSchema = Schema.Unknown.pipe(
  Schema.filter((value): value is JsonValue => isJsonValue(value), {
    message: () => 'Expected an exact JSON value',
  }),
)

export const FileEntrySchema = Schema.Union(
  Schema.Struct({ kind: Schema.Literal('directory') }),
  Schema.Struct({ kind: Schema.Literal('file'), text: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('symlink'), target: RelativePathSchema }),
)
export type FileEntry = Schema.Schema.Type<typeof FileEntrySchema>

const FileEntriesSchema = Schema.Record({ key: Schema.String, value: FileEntrySchema }).pipe(
  Schema.filter((entries) => Object.keys(entries).every(isRelativePath), {
    message: () => 'Expected every file-tree key to be a canonical, confined relative path',
  }),
)

export const FileTreeSchema = Schema.Struct({ entries: FileEntriesSchema })
export type FileTree = Schema.Schema.Type<typeof FileTreeSchema>

export const DiscoveryRequestSchema = Schema.Struct({
  protocolVersion: Schema.Literal(1),
  developmentRoot: FileTreeSchema,
  morphirHome: Schema.optionalWith(Schema.NullOr(FileTreeSchema), { default: () => null }),
  systemConfig: Schema.optionalWith(Schema.NullOr(FileTreeSchema), { default: () => null }),
  environment: Schema.optionalWith(Schema.Record({ key: Schema.String, value: Schema.String }), {
    default: () => ({}),
  }),
  cliOverlay: Schema.optionalWith(JsonValueSchema, { default: () => null }),
})
export type DecodedDiscoveryRequest = Schema.Schema.Type<typeof DiscoveryRequestSchema>
export interface DiscoveryRequest {
  readonly protocolVersion: 1
  readonly developmentRoot: FileTree
  readonly morphirHome?: FileTree | null
  readonly systemConfig?: FileTree | null
  readonly environment?: Readonly<Record<string, string>>
  readonly cliOverlay?: JsonValue
}

export const PortableWorkspaceDiagnosticSchema = Schema.Struct({
  severity: Schema.Literal('info', 'warning', 'error'),
  code: Schema.String,
  message: Schema.String,
  path: Schema.NullOr(RelativePathSchema),
  projectPath: Schema.NullOr(RelativePathSchema),
})
export type PortableWorkspaceDiagnostic = Schema.Schema.Type<
  typeof PortableWorkspaceDiagnosticSchema
>

export const PortableProjectSnapshotSchema = Schema.Struct({
  name: Schema.String,
  version: Schema.NullOr(Schema.String),
  relativePath: RelativePathSchema,
  configAnchor: Schema.NullOr(RelativePathSchema),
  sourceDirectory: RelativePathSchema,
  state: Schema.Literal('unloaded', 'error'),
  diagnostics: Schema.Array(PortableWorkspaceDiagnosticSchema),
})
export type PortableProjectSnapshot = Schema.Schema.Type<typeof PortableProjectSnapshotSchema>

export const PortableWorkspaceSnapshotSchema = Schema.Struct({
  protocolVersion: Schema.Literal(1),
  configAnchor: RelativePathSchema,
  name: Schema.NullOr(Schema.String),
  state: Schema.Literal('open', 'error'),
  projects: Schema.Array(PortableProjectSnapshotSchema),
  diagnostics: Schema.Array(PortableWorkspaceDiagnosticSchema),
})
export type PortableWorkspaceSnapshot = Schema.Schema.Type<typeof PortableWorkspaceSnapshotSchema>

export const DiscoveryFailureSchema = Schema.Struct({
  code: Schema.String,
  message: Schema.String,
  path: Schema.NullOr(RelativePathSchema),
})
export type DiscoveryFailure = Schema.Schema.Type<typeof DiscoveryFailureSchema>

export const DiscoveryResponseSchema = Schema.Union(
  Schema.Struct({ status: Schema.Literal('success'), snapshot: PortableWorkspaceSnapshotSchema }),
  Schema.Struct({ status: Schema.Literal('failure'), error: DiscoveryFailureSchema }),
)
export type DiscoveryResponse = Schema.Schema.Type<typeof DiscoveryResponseSchema>
