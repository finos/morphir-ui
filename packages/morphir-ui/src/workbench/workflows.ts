import { Effect } from 'effect'
import type { WorkbenchSourceRef } from '@morphir/workspace'
import {
  DevelopmentWorkbenchService,
  ModelWorkbenchService,
  WorkbenchSourceService,
  type WorkbenchError,
  validateCanonicalDescriptor,
  validateDevelopmentWorkbenchData,
  validateModelWorkbenchData,
  validateProjectModelWorkbenchData,
  validateInspectionResult,
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
    ? validateCanonicalDescriptor(descriptor, 'Model Workbench load').pipe(
        Effect.andThen(Effect.flatMap(ModelWorkbenchService, (service) => service.load(descriptor))),
        Effect.flatMap((data) => validateModelWorkbenchData(descriptor, data)),
      )
    : validateCanonicalDescriptor(descriptor, 'Development Workbench load').pipe(
        Effect.andThen(
          Effect.flatMap(DevelopmentWorkbenchService, (service) => service.load(descriptor)),
        ),
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
    Effect.flatMap((descriptor) => validateInspectionResult(source, descriptor)),
    Effect.flatMap((descriptor) =>
      loadWorkbench(descriptor).pipe(Effect.map((data) => ({ descriptor, data }))),
    ),
  )

export const loadDevelopmentProjectModel = (
  descriptor: DevelopmentWorkbenchDescriptor,
  projectId: string,
): Effect.Effect<ModelWorkbenchData, WorkbenchError, DevelopmentWorkbenchService> =>
  validateCanonicalDescriptor(descriptor, 'Development project model load').pipe(
    Effect.andThen(
      Effect.flatMap(DevelopmentWorkbenchService, (service) =>
        Effect.suspend(() => service.loadProjectModel(descriptor, projectId)),
      ),
    ),
    Effect.flatMap((data) =>
      validateProjectModelWorkbenchData(descriptor.source.providerId, data),
    ),
  )
