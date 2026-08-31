import { Effect, Layer, Option, Stream } from 'effect'
import type { WorkbenchProvider, WorkbenchSourceRef, WorkspaceEvent } from '@morphir/workspace'
import {
  DevelopmentWorkbenchService,
  ModelWorkbenchService,
  WorkbenchError,
  WorkbenchProviderService,
  WorkbenchSourceService,
  type SourcePickerKind,
} from './services.ts'
import type {
  DevelopmentWorkbenchData,
  DevelopmentWorkbenchDescriptor,
  ModelWorkbenchData,
  ModelWorkbenchDescriptor,
  WorkbenchDescriptor,
} from './types.ts'

export interface WorkbenchProviderAdapter {
  readonly provider: WorkbenchProvider
  readonly inspect: (
    source: WorkbenchSourceRef,
  ) => Effect.Effect<WorkbenchDescriptor, WorkbenchError>
  readonly pick: (
    kind: SourcePickerKind,
  ) => Effect.Effect<Option.Option<WorkbenchSourceRef>, WorkbenchError>
  readonly release: (source: WorkbenchSourceRef) => Effect.Effect<void>
  readonly reveal: (source: WorkbenchSourceRef) => Effect.Effect<void, WorkbenchError>
  readonly loadModel: (
    descriptor: ModelWorkbenchDescriptor,
  ) => Effect.Effect<ModelWorkbenchData, WorkbenchError>
  readonly loadDevelopment: (
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

const unknownProviderError = (source: WorkbenchSourceRef): WorkbenchError =>
  new WorkbenchError({
    code: 'unsupported-capability',
    source,
    message: `Workbench source belongs to provider ${source.providerId}; no adapter is registered (Unknown Workbench provider ${source.providerId})`,
  })

export const makeWorkbenchProviderLayers = (
  adapters: ReadonlyArray<WorkbenchProviderAdapter>,
  defaultPickerProviderId: string,
): Layer.Layer<
  | WorkbenchSourceService
  | WorkbenchProviderService
  | ModelWorkbenchService
  | DevelopmentWorkbenchService
> => {
  const byId = new Map<string, WorkbenchProviderAdapter>()
  for (const adapter of adapters) {
    if (byId.has(adapter.provider.id)) {
      throw new TypeError(`Duplicate Workbench provider ID: ${adapter.provider.id}`)
    }
    byId.set(adapter.provider.id, adapter)
  }
  const defaultPicker = byId.get(defaultPickerProviderId)
  if (!defaultPicker) {
    throw new TypeError(`Default picker provider is not registered: ${defaultPickerProviderId}`)
  }

  const find = (source: WorkbenchSourceRef): WorkbenchProviderAdapter | undefined =>
    byId.get(source.providerId)
  const route = <A>(
    source: WorkbenchSourceRef,
    operation: (adapter: WorkbenchProviderAdapter) => Effect.Effect<A, WorkbenchError>,
  ): Effect.Effect<A, WorkbenchError> => {
    const adapter = find(source)
    return adapter ? operation(adapter) : Effect.fail(unknownProviderError(source))
  }

  return Layer.mergeAll(
    Layer.succeed(WorkbenchProviderService, {
      list: Effect.succeed(adapters.map(({ provider }) => provider)),
    }),
    Layer.succeed(WorkbenchSourceService, {
      inspect: (source) => route(source, ({ inspect }) => inspect(source)),
      pick: (kind) => defaultPicker.pick(kind),
      release: (source) => find(source)?.release(source) ?? Effect.void,
      reveal: (source) => route(source, ({ reveal }) => reveal(source)),
    }),
    Layer.succeed(ModelWorkbenchService, {
      load: (descriptor) => route(descriptor.source, ({ loadModel }) => loadModel(descriptor)),
    }),
    Layer.succeed(DevelopmentWorkbenchService, {
      load: (descriptor) =>
        route(descriptor.source, ({ loadDevelopment }) => loadDevelopment(descriptor)),
      loadProjectModel: (descriptor, projectId) =>
        route(descriptor.source, ({ loadProjectModel }) => loadProjectModel(descriptor, projectId)),
      events: (descriptor) => {
        const adapter = find(descriptor.source)
        return adapter
          ? adapter.events(descriptor)
          : Stream.fail(unknownProviderError(descriptor.source))
      },
    }),
  )
}
