import { Effect, Option, Schema, Stream } from 'effect'
import {
  CONNECTED_METHODS,
  DevelopmentInspectResultSchema,
  WorkspaceEventNotificationParamsSchema,
  WorkspaceOpenResultSchema,
  WorkspaceUnwatchResultSchema,
  WorkspaceWatchResultSchema,
  type ConnectedNotification,
  type WorkspaceEvent,
} from '@morphir/workspace'
import {
  WorkbenchError,
  validateDevelopmentWorkbenchData,
  validateInspectionResult,
  type WorkbenchProviderAdapter,
} from '@morphir/ui'
import type { ConnectedRpcClient } from './rpc-client.ts'

const unsupported = (providerId: string, operation: string): WorkbenchError =>
  new WorkbenchError({
    code: 'unsupported-capability',
    source: providerId,
    message: `${operation} is not available from connected provider ${providerId}`,
  })

const malformedEvent = (providerId: string, cause: unknown): WorkbenchError =>
  new WorkbenchError({
    code: 'read-failed',
    source: providerId,
    message: `Connected provider returned a malformed workspace event: ${String(cause)}`,
  })

const eventForNotification = (
  providerId: string,
  subscriptionId: string,
  notification: ConnectedNotification,
): Effect.Effect<Option.Option<WorkspaceEvent>, WorkbenchError> => {
  if (notification.tag === 'disconnected') {
    return Effect.succeed(
      Option.some({
        tag: 'provider-disconnected',
        providerId,
        message: notification.message,
      }),
    )
  }
  if (notification.method !== CONNECTED_METHODS.workspaceEvent) {
    return Effect.succeed(Option.none())
  }
  return Effect.try({
    try: () =>
      Schema.decodeUnknownSync(WorkspaceEventNotificationParamsSchema)(notification.params),
    catch: (cause) => malformedEvent(providerId, cause),
  }).pipe(
    Effect.map((params) =>
      params.subscriptionId === subscriptionId ? Option.some(params.event) : Option.none(),
    ),
  )
}

export const makeConnectedWorkbenchAdapters = (
  client: ConnectedRpcClient,
): ReadonlyArray<WorkbenchProviderAdapter> =>
  client.manifest.providers.map((provider) => ({
    provider,
    inspect: (source) =>
      client
        .call(CONNECTED_METHODS.developmentInspect, { source }, DevelopmentInspectResultSchema)
        .pipe(Effect.flatMap(({ descriptor }) => validateInspectionResult(source, descriptor))),
    pick: () => Effect.succeed(Option.none()),
    release: () => Effect.void,
    reveal: () => Effect.fail(unsupported(provider.id, 'Reveal in file manager')),
    loadModel: () => Effect.fail(unsupported(provider.id, 'Model Workbench loading')),
    loadDevelopment: (descriptor) =>
      client
        .call(
          CONNECTED_METHODS.workspaceOpen,
          { source: descriptor.source },
          WorkspaceOpenResultSchema,
        )
        .pipe(
          Effect.map(({ snapshot }) => ({
            kind: 'development' as const,
            descriptor,
            snapshot,
          })),
          Effect.flatMap((data) => validateDevelopmentWorkbenchData(descriptor, data)),
        ),
    loadProjectModel: () =>
      Effect.fail(unsupported(provider.id, 'Development project model loading')),
    events: (descriptor) =>
      Stream.unwrap(
        client
          .call(
            CONNECTED_METHODS.workspaceWatch,
            { source: descriptor.source },
            WorkspaceWatchResultSchema,
          )
          .pipe(
            Effect.map(({ subscriptionId }) =>
              client.notifications.pipe(
                Stream.mapEffect((notification) =>
                  eventForNotification(provider.id, subscriptionId, notification),
                ),
                Stream.filterMap((event) => event),
                Stream.ensuring(
                  client
                    .call(
                      CONNECTED_METHODS.workspaceUnwatch,
                      { subscriptionId },
                      WorkspaceUnwatchResultSchema,
                    )
                    .pipe(Effect.ignore),
                ),
              ),
            ),
          ),
      ),
  }))
