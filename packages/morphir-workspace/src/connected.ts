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
