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

export const FileEntrySchema = Schema.Union(
  Schema.Struct({ kind: Schema.Literal('directory') }),
  Schema.Struct({ kind: Schema.Literal('file'), text: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('symlink'), target: RelativePathSchema }),
)
export type FileEntry = Schema.Schema.Type<typeof FileEntrySchema>

export const FileTreeSchema = Schema.Struct({
  entries: Schema.Record({ key: RelativePathSchema, value: FileEntrySchema }),
})
export type FileTree = Schema.Schema.Type<typeof FileTreeSchema>

export const DiscoveryRequestSchema = Schema.Struct({
  protocolVersion: Schema.Literal(1),
  developmentRoot: FileTreeSchema,
  morphirHome: Schema.NullOr(FileTreeSchema),
  systemConfig: Schema.NullOr(FileTreeSchema),
  environment: Schema.Record({ key: Schema.String, value: Schema.String }),
  cliOverlay: Schema.Unknown,
})
export type DiscoveryRequest = Schema.Schema.Type<typeof DiscoveryRequestSchema>

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
