import { Schema } from 'effect'

export const WorkbenchSourceRefSchema = Schema.Struct({
  providerId: Schema.String,
  locator: Schema.String,
  displayName: Schema.String,
})
export type WorkbenchSourceRef = Schema.Schema.Type<typeof WorkbenchSourceRefSchema>

export const WorkspaceStateSchema = Schema.Literal('closed', 'initializing', 'open', 'error')
export type WorkspaceState = Schema.Schema.Type<typeof WorkspaceStateSchema>

export const ProjectStateSchema = Schema.Literal('unloaded', 'loading', 'ready', 'stale', 'error')
export type ProjectState = Schema.Schema.Type<typeof ProjectStateSchema>

export const WorkspaceDiagnosticSchema = Schema.Struct({
  severity: Schema.Literal('info', 'warning', 'error'),
  code: Schema.NullOr(Schema.String),
  message: Schema.String,
  path: Schema.NullOr(Schema.String),
  projectId: Schema.NullOr(Schema.String),
})
export type WorkspaceDiagnostic = Schema.Schema.Type<typeof WorkspaceDiagnosticSchema>

export const ProjectSnapshotSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  version: Schema.NullOr(Schema.String),
  relativePath: Schema.String,
  configAnchor: Schema.NullOr(Schema.String),
  sourceDirectory: Schema.String,
  state: ProjectStateSchema,
  modelSources: Schema.Array(WorkbenchSourceRefSchema),
  knowledgeBaseSources: Schema.Array(WorkbenchSourceRefSchema),
  diagnostics: Schema.Array(WorkspaceDiagnosticSchema),
})
export type ProjectSnapshot = Schema.Schema.Type<typeof ProjectSnapshotSchema>

export const WorkspaceSnapshotSchema = Schema.Struct({
  id: Schema.String,
  root: WorkbenchSourceRefSchema,
  name: Schema.NullOr(Schema.String),
  configAnchor: Schema.NullOr(Schema.String),
  state: WorkspaceStateSchema,
  projects: Schema.Array(ProjectSnapshotSchema),
  modelSources: Schema.Array(WorkbenchSourceRefSchema),
  knowledgeBaseSources: Schema.Array(WorkbenchSourceRefSchema),
  diagnostics: Schema.Array(WorkspaceDiagnosticSchema),
})
export type WorkspaceSnapshot = Schema.Schema.Type<typeof WorkspaceSnapshotSchema>

export const WorkbenchCapabilitySchema = Schema.Struct({
  name: Schema.String,
  version: Schema.String,
})
export type WorkbenchCapability = Schema.Schema.Type<typeof WorkbenchCapabilitySchema>

export const WorkbenchProviderSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  kind: Schema.Literal('local', 'connected'),
  status: Schema.Literal('available', 'disconnected'),
  capabilities: Schema.Array(WorkbenchCapabilitySchema),
})
export type WorkbenchProvider = Schema.Schema.Type<typeof WorkbenchProviderSchema>

export const WorkspaceEventSchema = Schema.Union(
  Schema.Struct({ tag: Schema.Literal('snapshot'), snapshot: WorkspaceSnapshotSchema }),
  Schema.Struct({
    tag: Schema.Literal('provider-disconnected'),
    providerId: Schema.String,
    message: Schema.String,
  }),
)
export type WorkspaceEvent = Schema.Schema.Type<typeof WorkspaceEventSchema>

export const WORKBENCH_CAPABILITIES = {
  modelOpen: 'morphir/model/open',
  developmentInspect: 'morphir/development/inspect',
  workspaceOpen: 'morphir/workspace/open',
  workspaceWatch: 'morphir/workspace/watch',
} as const

export const sourceKey = (source: WorkbenchSourceRef): string =>
  JSON.stringify([source.providerId, source.locator])
