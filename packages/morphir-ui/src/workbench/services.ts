import { Context, Data, Effect, Option } from 'effect'
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

export class WorkbenchError extends Data.TaggedError('WorkbenchError')<{
  readonly code: WorkbenchErrorCode
  readonly source: string
  readonly message: string
}> {}

export class WorkbenchSourceService extends Context.Tag('@morphir/ui/WorkbenchSourceService')<
  WorkbenchSourceService,
  {
    readonly inspect: (source: string) => Effect.Effect<WorkbenchDescriptor, WorkbenchError>
    readonly pick: (kind: SourcePickerKind) => Effect.Effect<Option.Option<string>, WorkbenchError>
    readonly reveal: (source: string) => Effect.Effect<void, WorkbenchError>
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
  }
>() {}
