import { Effect } from 'effect'
import type { WorkbenchSourceRef } from '@morphir/workspace'
import {
  DevelopmentWorkbenchService,
  ModelWorkbenchService,
  WorkbenchSourceService,
  type WorkbenchError,
  validateDevelopmentWorkbenchData,
  validateModelWorkbenchData,
  validateProjectModelWorkbenchData,
  validateProviderResult,
} from './services.ts'
import type {
  DevelopmentWorkbenchDescriptor,
  ModelWorkbenchData,
  WorkbenchData,
  WorkbenchDescriptor,
} from './types.ts'

export const loadWorkbench = (
  descriptor: WorkbenchDescriptor,
): Effect.Effect<
  WorkbenchData,
  WorkbenchError,
  ModelWorkbenchService | DevelopmentWorkbenchService
> =>
  descriptor.kind === 'model'
    ? Effect.flatMap(ModelWorkbenchService, (service) => service.load(descriptor)).pipe(
        Effect.flatMap((data) => validateModelWorkbenchData(descriptor, data)),
      )
    : Effect.flatMap(DevelopmentWorkbenchService, (service) => service.load(descriptor)).pipe(
        Effect.flatMap((data) => validateDevelopmentWorkbenchData(descriptor, data)),
      )

export const openWorkbench = (
  source: WorkbenchSourceRef,
): Effect.Effect<
  { readonly descriptor: WorkbenchDescriptor; readonly data: WorkbenchData },
  WorkbenchError,
  WorkbenchSourceService | ModelWorkbenchService | DevelopmentWorkbenchService
> =>
  Effect.flatMap(WorkbenchSourceService, (service) => service.inspect(source)).pipe(
    Effect.flatMap((descriptor) =>
      validateProviderResult(
        source.providerId,
        descriptor.source,
        descriptor,
        'Workbench inspection',
      ),
    ),
    Effect.flatMap((descriptor) =>
      loadWorkbench(descriptor).pipe(Effect.map((data) => ({ descriptor, data }))),
    ),
  )

export const loadDevelopmentProjectModel = (
  descriptor: DevelopmentWorkbenchDescriptor,
  projectId: string,
): Effect.Effect<ModelWorkbenchData, WorkbenchError, DevelopmentWorkbenchService> =>
  Effect.flatMap(DevelopmentWorkbenchService, (service) =>
    service.loadProjectModel(descriptor, projectId),
  ).pipe(
    Effect.flatMap((data) =>
      validateProjectModelWorkbenchData(descriptor.source.providerId, data),
    ),
  )
