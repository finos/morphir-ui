import { Context, Data, Effect, Option, Stream } from 'effect'
import {
  sourceKey,
  type WorkbenchProvider,
  type WorkbenchSourceRef,
  type WorkspaceEvent,
  type WorkspaceSnapshot,
} from '@morphir/workspace'
import type {
  DevelopmentWorkbenchData,
  DevelopmentWorkbenchDescriptor,
  ModelWorkbenchData,
  ModelWorkbenchDescriptor,
  WorkbenchDescriptor,
} from './types.ts'

export type SourcePickerKind = 'model-file' | 'folder'
export type WorkbenchErrorCode =
  | 'not-found'
  | 'unsupported-file'
  | 'permission-denied'
  | 'detection-failed'
  | 'invalid-distribution'
  | 'read-failed'
  | 'unsupported-capability'
  | 'provider-disconnected'

export class WorkbenchError extends Data.TaggedError('WorkbenchError')<{
  readonly code: WorkbenchErrorCode
  readonly source: WorkbenchSourceRef | string
  readonly message: string
}> {}

export const unsupportedProviderError = (
  expectedProviderId: string,
  source: WorkbenchSourceRef,
): WorkbenchError =>
  new WorkbenchError({
    code: 'unsupported-capability',
    source,
    message: `Workbench source belongs to provider ${source.providerId}; expected provider ${expectedProviderId}`,
  })

export const providerContinuityError = (
  expectedProviderId: string,
  source: WorkbenchSourceRef,
  operation: string,
): WorkbenchError =>
  new WorkbenchError({
    code: 'unsupported-capability',
    source,
    message: `${operation} returned provider ${source.providerId}; expected provider ${expectedProviderId}`,
  })

export const validateProviderResult = <A>(
  expectedProviderId: string,
  source: WorkbenchSourceRef,
  value: A,
  operation: string,
): Effect.Effect<A, WorkbenchError> =>
  source.providerId === expectedProviderId
    ? Effect.succeed(value)
    : Effect.fail(providerContinuityError(expectedProviderId, source, operation))

const workbenchIdentityError = (
  expected: WorkbenchDescriptor,
  actual: WorkbenchDescriptor | WorkspaceSnapshot,
  operation: string,
): WorkbenchError => {
  const actualSource = 'source' in actual ? actual.source : actual.root
  const actualId = actual.id
  return new WorkbenchError({
    code: 'unsupported-capability',
    source: actualSource,
    message: `${operation} changed workbench identity from ${expected.id} to ${actualId}`,
  })
}

const validateWorkbenchIdentity = <A>(
  expected: WorkbenchDescriptor,
  actual: WorkbenchDescriptor,
  value: A,
  operation: string,
): Effect.Effect<A, WorkbenchError> =>
  validateProviderResult(
    expected.source.providerId,
    actual.source,
    value,
    operation,
  ).pipe(
    Effect.flatMap((valid) =>
      actual.id === expected.id && sourceKey(actual.source) === sourceKey(expected.source)
        ? Effect.succeed(valid)
        : Effect.fail(workbenchIdentityError(expected, actual, operation)),
    ),
  )

export const validateWorkspaceSnapshot = (
  expected: DevelopmentWorkbenchDescriptor,
  snapshot: WorkspaceSnapshot,
): Effect.Effect<WorkspaceSnapshot, WorkbenchError> =>
  Effect.forEach(
    [
      snapshot.root,
      ...snapshot.modelSources,
      ...snapshot.knowledgeBaseSources,
      ...snapshot.projects.flatMap((project) => [
        ...project.modelSources,
        ...project.knowledgeBaseSources,
      ]),
    ],
    (source) =>
      validateProviderResult(
        expected.source.providerId,
        source,
        source,
        'Workspace snapshot source',
      ),
    { discard: true },
  ).pipe(
    Effect.as(snapshot),
    Effect.flatMap((valid) =>
      valid.id !== sourceKey(valid.root)
        ? Effect.fail(
            new WorkbenchError({
              code: 'detection-failed',
              source: valid.root,
              message: 'Workspace snapshot identity does not match its root',
            }),
          )
        : valid.id === expected.id && sourceKey(valid.root) === sourceKey(expected.source)
        ? Effect.succeed(valid)
        : Effect.fail(workbenchIdentityError(expected, valid, 'Workspace snapshot')),
    ),
  )

export const validateModelWorkbenchData = (
  expected: ModelWorkbenchDescriptor,
  data: ModelWorkbenchData,
  operation = 'Model Workbench load',
): Effect.Effect<ModelWorkbenchData, WorkbenchError> =>
  validateWorkbenchIdentity(expected, data.descriptor, data, operation)

export const validateProjectModelWorkbenchData = (
  expectedProviderId: string,
  data: ModelWorkbenchData,
): Effect.Effect<ModelWorkbenchData, WorkbenchError> =>
  validateProviderResult(
    expectedProviderId,
    data.descriptor.source,
    data,
    'Development project model load',
  )

export const validateDevelopmentWorkbenchData = (
  expected: DevelopmentWorkbenchDescriptor,
  data: DevelopmentWorkbenchData,
): Effect.Effect<DevelopmentWorkbenchData, WorkbenchError> =>
  validateWorkbenchIdentity(
    expected,
    data.descriptor,
    data,
    'Development Workbench load',
  ).pipe(
    Effect.andThen(validateWorkspaceSnapshot(expected, data.snapshot)),
    Effect.as(data),
  )

export const validateWorkspaceEvent = (
  expected: DevelopmentWorkbenchDescriptor,
  event: WorkspaceEvent,
): Effect.Effect<WorkspaceEvent, WorkbenchError> =>
  event.tag === 'snapshot'
    ? validateWorkspaceSnapshot(expected, event.snapshot).pipe(Effect.as(event))
    : event.providerId === expected.source.providerId
      ? Effect.succeed(event)
      : Effect.fail(
          providerContinuityError(
            expected.source.providerId,
            {
              providerId: event.providerId,
              locator: '<workspace-events>',
              displayName: event.providerId,
            },
            'Workspace event',
          ),
        )

export class WorkbenchProviderService extends Context.Tag('@morphir/ui/WorkbenchProviderService')<
  WorkbenchProviderService,
  { readonly list: Effect.Effect<ReadonlyArray<WorkbenchProvider>> }
>() {}

export class WorkbenchSourceService extends Context.Tag('@morphir/ui/WorkbenchSourceService')<
  WorkbenchSourceService,
  {
    readonly inspect: (
      source: WorkbenchSourceRef,
    ) => Effect.Effect<WorkbenchDescriptor, WorkbenchError>
    readonly pick: (
      kind: SourcePickerKind,
    ) => Effect.Effect<Option.Option<WorkbenchSourceRef>, WorkbenchError>
    readonly reveal: (source: WorkbenchSourceRef) => Effect.Effect<void, WorkbenchError>
  }
>() {}

export class ModelWorkbenchService extends Context.Tag('@morphir/ui/ModelWorkbenchService')<
  ModelWorkbenchService,
  {
    readonly load: (
      descriptor: ModelWorkbenchDescriptor,
    ) => Effect.Effect<ModelWorkbenchData, WorkbenchError>
  }
>() {}

export class DevelopmentWorkbenchService extends Context.Tag(
  '@morphir/ui/DevelopmentWorkbenchService',
)<
  DevelopmentWorkbenchService,
  {
    readonly load: (
      descriptor: DevelopmentWorkbenchDescriptor,
    ) => Effect.Effect<DevelopmentWorkbenchData, WorkbenchError>
    readonly loadProjectModel: (
      descriptor: DevelopmentWorkbenchDescriptor,
      projectId: string,
    ) => Effect.Effect<ModelWorkbenchData, WorkbenchError>
    readonly events: (
      descriptor: DevelopmentWorkbenchDescriptor,
    ) => Stream.Stream<WorkspaceEvent, WorkbenchError>
  }
>() {}
