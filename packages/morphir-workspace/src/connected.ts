import { Schema } from 'effect'
import { JsonValueSchema, type JsonValue } from './discovery.ts'
import {
  WORKBENCH_CAPABILITIES,
  WorkbenchSourceRefSchema,
  WorkspaceEventSchema,
  WorkspaceSnapshotSchema,
} from './model.ts'

export const CONNECTED_PROTOCOL_VERSION = 1 as const

export const CONNECTED_METHODS = {
  initialize: 'morphir.session.initialize',
  developmentInspect: 'morphir.development.inspect',
  projectModelOpen: 'morphir.project-model.open',
  workspaceOpen: 'morphir.workspace.open',
  workspaceWatch: 'morphir.workspace.watch',
  workspaceUnwatch: 'morphir.workspace.unwatch',
  workspaceEvent: 'morphir.workspace.event',
  playgroundCatalog: 'morphir.playground.catalog',
  playgroundCompile: 'morphir.playground.compile',
  playgroundGenerate: 'morphir.playground.generate',
} as const

const NonEmptyStringSchema = Schema.String.pipe(
  Schema.filter((value) => value.length > 0, { message: () => 'Expected a non-empty string' }),
)

const WebSocketPathSchema = Schema.String.pipe(
  Schema.filter(
    (value) =>
      value.startsWith('/') &&
      !value.startsWith('//') &&
      !value.includes('\\') &&
      !value.includes('?') &&
      !value.includes('#'),
    { message: () => 'Expected a same-origin WebSocket path' },
  ),
)

export const ConnectedCapabilitySchema = Schema.Struct({
  name: NonEmptyStringSchema,
  version: NonEmptyStringSchema,
})
export type ConnectedCapability = Schema.Schema.Type<typeof ConnectedCapabilitySchema>

export const ConnectedProviderSchema = Schema.Struct({
  id: NonEmptyStringSchema,
  name: NonEmptyStringSchema,
  kind: Schema.Literal('connected'),
  status: Schema.Literal('available', 'disconnected'),
  capabilities: Schema.Array(ConnectedCapabilitySchema),
})
export type ConnectedProvider = Schema.Schema.Type<typeof ConnectedProviderSchema>

const ConnectedSessionManifestBaseSchema = Schema.Struct({
  protocolVersion: Schema.Literal(CONNECTED_PROTOCOL_VERSION),
  webSocketPath: WebSocketPathSchema,
  sessionId: NonEmptyStringSchema,
  providers: Schema.Array(ConnectedProviderSchema),
  initialSources: Schema.Array(WorkbenchSourceRefSchema),
})

export const ConnectedSessionManifestSchema = ConnectedSessionManifestBaseSchema.pipe(
  Schema.filter(
    (manifest) => {
      const providerIds = manifest.providers.map(({ id }) => id)
      const knownProviderIds = new Set(providerIds)
      const requiredCapabilities = new Set([
        WORKBENCH_CAPABILITIES.developmentInspect,
        WORKBENCH_CAPABILITIES.projectModelOpen,
        WORKBENCH_CAPABILITIES.workspaceOpen,
        WORKBENCH_CAPABILITIES.workspaceWatch,
      ])
      return (
        knownProviderIds.size === providerIds.length &&
        manifest.providers.every((provider) => {
          const compatible = new Set(
            provider.capabilities.filter(({ version }) => version === '1').map(({ name }) => name),
          )
          return [...requiredCapabilities].every((name) => compatible.has(name))
        }) &&
        manifest.initialSources.every(({ providerId }) => knownProviderIds.has(providerId))
      )
    },
    {
      message: () =>
        'Expected compatible connected providers with unique IDs and provider-owned initial sources',
    },
  ),
)
export type ConnectedSessionManifest = Schema.Schema.Type<typeof ConnectedSessionManifestSchema>

export const JsonRpcIdSchema = Schema.Number.pipe(
  Schema.filter(Number.isSafeInteger, { message: () => 'Expected a safe integer request ID' }),
  Schema.filter((value) => value >= 0, { message: () => 'Expected a non-negative request ID' }),
)
export type JsonRpcId = Schema.Schema.Type<typeof JsonRpcIdSchema>

export const JsonRpcRequestSchema = Schema.Struct({
  jsonrpc: Schema.Literal('2.0'),
  id: JsonRpcIdSchema,
  method: NonEmptyStringSchema,
  params: JsonValueSchema,
})
export type JsonRpcRequest = Schema.Schema.Type<typeof JsonRpcRequestSchema>

export const JsonRpcSuccessResponseSchema = Schema.Struct({
  jsonrpc: Schema.Literal('2.0'),
  id: JsonRpcIdSchema,
  result: JsonValueSchema,
})
export type JsonRpcSuccessResponse = Schema.Schema.Type<typeof JsonRpcSuccessResponseSchema>

export const JsonRpcErrorSchema = Schema.Struct({
  code: Schema.Number,
  message: Schema.String,
  data: Schema.optional(JsonValueSchema),
})
export type JsonRpcError = Schema.Schema.Type<typeof JsonRpcErrorSchema>

export const JsonRpcErrorResponseSchema = Schema.Struct({
  jsonrpc: Schema.Literal('2.0'),
  id: JsonRpcIdSchema,
  error: JsonRpcErrorSchema,
})
export type JsonRpcErrorResponse = Schema.Schema.Type<typeof JsonRpcErrorResponseSchema>

export const JsonRpcNotificationSchema = Schema.Struct({
  jsonrpc: Schema.Literal('2.0'),
  method: NonEmptyStringSchema,
  params: JsonValueSchema,
})
export type JsonRpcNotification = Schema.Schema.Type<typeof JsonRpcNotificationSchema>

export const ConnectedInitializeParamsSchema = Schema.Struct({
  protocolVersion: Schema.Literal(CONNECTED_PROTOCOL_VERSION),
  sessionId: NonEmptyStringSchema,
})
export type ConnectedInitializeParams = Schema.Schema.Type<typeof ConnectedInitializeParamsSchema>

export const ConnectedInitializeResultSchema = Schema.Struct({
  protocolVersion: Schema.Literal(CONNECTED_PROTOCOL_VERSION),
})
export type ConnectedInitializeResult = Schema.Schema.Type<typeof ConnectedInitializeResultSchema>

export const DevelopmentInspectParamsSchema = Schema.Struct({
  source: WorkbenchSourceRefSchema,
})
export type DevelopmentInspectParams = Schema.Schema.Type<typeof DevelopmentInspectParamsSchema>

export const DevelopmentInspectResultSchema = Schema.Struct({
  descriptor: Schema.Struct({
    id: NonEmptyStringSchema,
    source: WorkbenchSourceRefSchema,
    name: NonEmptyStringSchema,
    kind: Schema.Literal('development'),
    route: Schema.Literal('overview'),
    openedAt: NonEmptyStringSchema,
    lastUsedAt: NonEmptyStringSchema,
  }),
})
export type DevelopmentInspectResult = Schema.Schema.Type<typeof DevelopmentInspectResultSchema>

export const WorkspaceOpenParamsSchema = Schema.Struct({ source: WorkbenchSourceRefSchema })
export type WorkspaceOpenParams = Schema.Schema.Type<typeof WorkspaceOpenParamsSchema>

export const WorkspaceOpenResultSchema = Schema.Struct({ snapshot: WorkspaceSnapshotSchema })
export type WorkspaceOpenResult = Schema.Schema.Type<typeof WorkspaceOpenResultSchema>

export const ProjectModelOpenParamsSchema = Schema.Struct({
  source: WorkbenchSourceRefSchema,
  projectId: NonEmptyStringSchema,
})
export type ProjectModelOpenParams = Schema.Schema.Type<typeof ProjectModelOpenParamsSchema>

export const ProjectModelOpenResultSchema = Schema.Struct({
  descriptor: Schema.Struct({
    id: NonEmptyStringSchema,
    source: WorkbenchSourceRefSchema,
    name: NonEmptyStringSchema,
    kind: Schema.Literal('model'),
    distribution: Schema.Literal('single-file'),
    route: Schema.Literal('explorer'),
    openedAt: NonEmptyStringSchema,
    lastUsedAt: NonEmptyStringSchema,
  }),
  content: NonEmptyStringSchema,
})
export type ProjectModelOpenResult = Schema.Schema.Type<typeof ProjectModelOpenResultSchema>

export const WorkspaceWatchParamsSchema = Schema.Struct({ source: WorkbenchSourceRefSchema })
export type WorkspaceWatchParams = Schema.Schema.Type<typeof WorkspaceWatchParamsSchema>

export const WorkspaceWatchResultSchema = Schema.Struct({ subscriptionId: NonEmptyStringSchema })
export type WorkspaceWatchResult = Schema.Schema.Type<typeof WorkspaceWatchResultSchema>

export const WorkspaceUnwatchParamsSchema = Schema.Struct({ subscriptionId: NonEmptyStringSchema })
export type WorkspaceUnwatchParams = Schema.Schema.Type<typeof WorkspaceUnwatchParamsSchema>

export const WorkspaceUnwatchResultSchema = Schema.Struct({ removed: Schema.Boolean })
export type WorkspaceUnwatchResult = Schema.Schema.Type<typeof WorkspaceUnwatchResultSchema>

export const WorkspaceEventNotificationParamsSchema = Schema.Struct({
  subscriptionId: NonEmptyStringSchema,
  event: WorkspaceEventSchema,
})
export type WorkspaceEventNotificationParams = Schema.Schema.Type<
  typeof WorkspaceEventNotificationParamsSchema
>

export const ProviderRefSchema = Schema.Struct({
  extensionId: Schema.String,
  extensionName: Schema.String,
  version: Schema.NullOr(Schema.String),
  kind: Schema.Literal('builtin', 'installed'),
  // A string for installed providers (e.g. "channel stable", "version 1.0.0"),
  // null for builtins.
  selection: Schema.optionalWith(Schema.NullOr(Schema.String), { default: () => null }),
})
export type ProviderRef = Schema.Schema.Type<typeof ProviderRefSchema>

export const FrontendEntrySchema = Schema.Struct({
  languageId: Schema.String,
  // The extension's display name, not a per-language one: a frontend that
  // declares two languages yields two entries sharing this same value.
  // Prefer languageId for labelling.
  displayName: Schema.String,
  fileExtensions: Schema.Array(Schema.String),
  irVersions: Schema.Array(Schema.String),
  languagesDeclared: Schema.Boolean,
  compile: Schema.Boolean,
  provider: ProviderRefSchema,
})
export type FrontendEntry = Schema.Schema.Type<typeof FrontendEntrySchema>

export const TargetEntrySchema = Schema.Struct({
  target: Schema.String,
  displayName: Schema.String,
  irVersions: Schema.Array(Schema.String),
  generate: Schema.Boolean,
  provider: ProviderRefSchema,
})
export type TargetEntry = Schema.Schema.Type<typeof TargetEntrySchema>

export const CapabilityCatalogSchema = Schema.Struct({
  frontends: Schema.Array(FrontendEntrySchema),
  targets: Schema.Array(TargetEntrySchema),
})
export type CapabilityCatalog = Schema.Schema.Type<typeof CapabilityCatalogSchema>

export const PlaygroundPositionSchema = Schema.Struct({
  line: Schema.Number,
  character: Schema.Number,
})
export type PlaygroundPosition = Schema.Schema.Type<typeof PlaygroundPositionSchema>

export const PlaygroundLocationSchema = Schema.Struct({
  uri: Schema.String,
  range: Schema.Struct({
    start: PlaygroundPositionSchema,
    end: PlaygroundPositionSchema,
  }),
})
export type PlaygroundLocation = Schema.Schema.Type<typeof PlaygroundLocationSchema>

export const PlaygroundDiagnosticSchema = Schema.Struct({
  severity: Schema.Literal('error', 'warning', 'info', 'hint'),
  code: Schema.optionalWith(Schema.NullOr(Schema.String), { default: () => null }),
  message: Schema.String,
  location: Schema.optionalWith(Schema.NullOr(PlaygroundLocationSchema), { default: () => null }),
})
export type PlaygroundDiagnostic = Schema.Schema.Type<typeof PlaygroundDiagnosticSchema>

export const PlaygroundCompileResultSchema = Schema.Struct({
  success: Schema.Boolean,
  irVersion: Schema.NullOr(Schema.String),
  ir: Schema.NullOr(JsonValueSchema),
  diagnostics: Schema.Array(PlaygroundDiagnosticSchema),
  modules: Schema.Array(Schema.String),
})
export type PlaygroundCompileResult = Schema.Schema.Type<typeof PlaygroundCompileResultSchema>

export const PlaygroundArtifactSchema = Schema.Struct({
  path: Schema.String,
  content: Schema.String,
  binary: Schema.Boolean,
})
export type PlaygroundArtifact = Schema.Schema.Type<typeof PlaygroundArtifactSchema>

export const PlaygroundGenerateResultSchema = Schema.Struct({
  success: Schema.Boolean,
  artifacts: Schema.Array(PlaygroundArtifactSchema),
  diagnostics: Schema.Array(PlaygroundDiagnosticSchema),
})
export type PlaygroundGenerateResult = Schema.Schema.Type<typeof PlaygroundGenerateResultSchema>

export type ConnectedNotification =
  | {
      readonly tag: 'notification'
      readonly method: string
      readonly params: JsonValue
    }
  | {
      readonly tag: 'disconnected'
      readonly message: string
    }

export interface ConnectedRpcCall {
  readonly method: string
  readonly params: JsonValue
}
