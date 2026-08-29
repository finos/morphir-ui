import { Effect } from 'effect'
import {
  DevelopmentWorkbenchService,
  ModelWorkbenchService,
  WorkbenchSourceService,
  type WorkbenchError,
} from './services.ts'
import type { WorkbenchData, WorkbenchDescriptor } from './types.ts'

export const loadWorkbench = (
  descriptor: WorkbenchDescriptor,
): Effect.Effect<
  WorkbenchData,
  WorkbenchError,
  ModelWorkbenchService | DevelopmentWorkbenchService
> =>
  descriptor.kind === 'model'
    ? Effect.flatMap(ModelWorkbenchService, (service) => service.load(descriptor))
    : Effect.flatMap(DevelopmentWorkbenchService, (service) => service.load(descriptor))

export const openWorkbench = (
  source: string,
): Effect.Effect<
  { readonly descriptor: WorkbenchDescriptor; readonly data: WorkbenchData },
  WorkbenchError,
  WorkbenchSourceService | ModelWorkbenchService | DevelopmentWorkbenchService
> =>
  Effect.flatMap(WorkbenchSourceService, (service) => service.inspect(source)).pipe(
    Effect.flatMap((descriptor) =>
      loadWorkbench(descriptor).pipe(Effect.map((data) => ({ descriptor, data }))),
    ),
  )
