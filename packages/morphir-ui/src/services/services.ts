import { Context, Data, Effect, Layer, ManagedRuntime, Option, Stream } from 'effect'
import type { WorkbenchProvider, WorkbenchSourceRef, WorkspaceEvent } from '@morphir/workspace'
import type { UiConfig } from './config.ts'
import {
  DevelopmentWorkbenchService,
  ModelWorkbenchService,
  WorkbenchSourceService,
  WorkbenchProviderService,
  type WorkbenchError,
  type SourcePickerKind,
  validateDevelopmentWorkbenchData,
  validateCanonicalDescriptor,
  validateInspectionResult,
  validateModelWorkbenchData,
  validateProjectModelWorkbenchData,
  validateWorkspaceEvent,
} from '../workbench/services.ts'
import type {
  DevelopmentWorkbenchData,
  DevelopmentWorkbenchDescriptor,
  ModelWorkbenchData,
  ModelWorkbenchDescriptor,
  WorkbenchDescriptor,
} from '../workbench/types.ts'

export interface WorkspaceRef {
  readonly path: string
}
export interface PickedWorkspace {
  readonly ref: WorkspaceRef
  readonly content: string
}
export interface GitHubStatus {
  readonly source: import('./config.ts').GitHubSource
  readonly tokenDisplay: string | null
}

export class WorkspaceError extends Data.TaggedError('WorkspaceError')<{
  readonly message: string
}> {}
export class GitHubError extends Data.TaggedError('GitHubError')<{ readonly message: string }> {}

export class ConfigService extends Context.Tag('@morphir/ui/ConfigService')<
  ConfigService,
  {
    readonly load: Effect.Effect<UiConfig>
    readonly save: (config: UiConfig) => Effect.Effect<void>
  }
>() {}

export class WorkspaceService extends Context.Tag('@morphir/ui/WorkspaceService')<
  WorkspaceService,
  {
    readonly pickAndRead: Effect.Effect<Option.Option<PickedWorkspace>, WorkspaceError>
    readonly read: Option.Option<(ref: WorkspaceRef) => Effect.Effect<string, WorkspaceError>>
  }
>() {}

export class AppInfoService extends Context.Tag('@morphir/ui/AppInfoService')<
  AppInfoService,
  { readonly version: Effect.Effect<string> }
>() {}

export interface GitHubServiceApi {
  readonly status: Effect.Effect<GitHubStatus, GitHubError>
  readonly setSource: (source: 'none' | 'gh-cli') => Effect.Effect<void, GitHubError>
  readonly savePat: (raw: string) => Effect.Effect<void, GitHubError>
  readonly clearPat: Effect.Effect<void, GitHubError>
  readonly verify: Effect.Effect<{ login: string }, GitHubError>
}
export class GitHubService extends Context.Tag('@morphir/ui/GitHubService')<
  GitHubService,
  GitHubServiceApi
>() {}

export type CoreServices =
  | ConfigService
  | WorkspaceService
  | AppInfoService
  | WorkbenchSourceService
  | WorkbenchProviderService
  | ModelWorkbenchService
  | DevelopmentWorkbenchService

export interface Capabilities {
  readonly github: boolean
  readonly reopenWorkspaces: boolean
}

export interface AppServices {
  readonly capabilities: Capabilities
  dispose(): Promise<void>
  version(): Promise<string>
  loadConfig(): Promise<UiConfig>
  saveConfig(config: UiConfig): Promise<void>
  /**
   * Serializes a load -> mutate -> save cycle relative to other `updateConfig` calls, so
   * concurrent callers cannot interleave and clobber each other's writes. Prefer this over a
   * manual loadConfig/saveConfig pair whenever the write is a partial update rather than a
   * full-object replace.
   */
  updateConfig(mutate: (config: UiConfig) => UiConfig): Promise<void>
  listWorkbenchProviders(): Promise<ReadonlyArray<WorkbenchProvider>>
  inspectWorkbench(source: WorkbenchSourceRef): Promise<WorkbenchDescriptor>
  pickWorkbenchSource(kind: SourcePickerKind): Promise<WorkbenchSourceRef | null>
  revealWorkbenchSource(source: WorkbenchSourceRef): Promise<void>
  loadModelWorkbench(descriptor: ModelWorkbenchDescriptor): Promise<ModelWorkbenchData>
  loadDevelopmentWorkbench(
    descriptor: DevelopmentWorkbenchDescriptor,
  ): Promise<DevelopmentWorkbenchData>
  loadDevelopmentProjectModel(
    descriptor: DevelopmentWorkbenchDescriptor,
    projectId: string,
  ): Promise<ModelWorkbenchData>
  workspaceEvents(
    descriptor: DevelopmentWorkbenchDescriptor,
  ): Stream.Stream<WorkspaceEvent, WorkbenchError>
  pickWorkspace(): Promise<PickedWorkspace | null>
  readonly readWorkspace: ((ref: WorkspaceRef) => Promise<string>) | null
  readonly github: {
    status(): Promise<GitHubStatus>
    setSource(source: 'none' | 'gh-cli'): Promise<void>
    savePat(raw: string): Promise<void>
    clearPat(): Promise<void>
    verify(): Promise<{ login: string }>
  } | null
}

const buildFacade = async (
  runtime: ManagedRuntime.ManagedRuntime<CoreServices, never>,
  github: GitHubServiceApi | null,
): Promise<AppServices> => {
  const config = await runtime.runPromise(ConfigService)
  const workspace = await runtime.runPromise(WorkspaceService)
  const workbenchSource = await runtime.runPromise(WorkbenchSourceService)
  const workbenchProvider = await runtime.runPromise(WorkbenchProviderService)
  const modelWorkbench = await runtime.runPromise(ModelWorkbenchService)
  const developmentWorkbench = await runtime.runPromise(DevelopmentWorkbenchService)
  const appInfo = await runtime.runPromise(AppInfoService)
  const read = Option.getOrNull(workspace.read)
  let disposal: Promise<void> | null = null
  let disposing = false
  // Serializes updateConfig's load -> mutate -> save cycles: each call is chained onto the
  // tail of the queue (whether the prior one succeeded or failed), so concurrent callers never
  // interleave their read-modify-write.
  let queue: Promise<unknown> = Promise.resolve()
  const chain = <T>(op: () => Promise<T>): Promise<T> => {
    const result = queue.then(op, op)
    queue = result.catch(() => undefined)
    return result
  }
  return {
    capabilities: { github: github !== null, reopenWorkspaces: read !== null },
    dispose: () => {
      if (disposal) return disposal
      disposing = true
      disposal = queue.catch(() => undefined).then(() => runtime.dispose())
      return disposal
    },
    version: () => runtime.runPromise(appInfo.version),
    loadConfig: () => runtime.runPromise(config.load),
    saveConfig: (c) => runtime.runPromise(config.save(c)),
    updateConfig: (mutate) => {
      if (disposing) return Promise.reject(new Error('App services are disposing'))
      return chain(async () => {
        const current = await runtime.runPromise(config.load)
        await runtime.runPromise(config.save(mutate(current)))
      })
    },
    listWorkbenchProviders: () => runtime.runPromise(workbenchProvider.list),
    inspectWorkbench: (source) =>
      runtime.runPromise(
        workbenchSource
          .inspect(source)
          .pipe(Effect.flatMap((descriptor) => validateInspectionResult(source, descriptor))),
      ),
    pickWorkbenchSource: (kind) =>
      runtime.runPromise(workbenchSource.pick(kind)).then(Option.getOrNull),
    revealWorkbenchSource: (source) => runtime.runPromise(workbenchSource.reveal(source)),
    loadModelWorkbench: (descriptor) =>
      runtime.runPromise(
        validateCanonicalDescriptor(descriptor, 'Model Workbench load').pipe(
          Effect.andThen(modelWorkbench.load(descriptor)),
          Effect.flatMap((data) => validateModelWorkbenchData(descriptor, data)),
        ),
      ),
    loadDevelopmentWorkbench: (descriptor) =>
      runtime.runPromise(
        validateCanonicalDescriptor(descriptor, 'Development Workbench load').pipe(
          Effect.andThen(developmentWorkbench.load(descriptor)),
          Effect.flatMap((data) => validateDevelopmentWorkbenchData(descriptor, data)),
        ),
      ),
    loadDevelopmentProjectModel: (descriptor, projectId) =>
      runtime.runPromise(
        validateCanonicalDescriptor(descriptor, 'Development project model load').pipe(
          Effect.andThen(
            Effect.suspend(() => developmentWorkbench.loadProjectModel(descriptor, projectId)),
          ),
          Effect.flatMap((data) =>
            validateProjectModelWorkbenchData(descriptor.source.providerId, data),
          ),
        ),
      ),
    workspaceEvents: (descriptor) =>
      Stream.unwrap(
        validateCanonicalDescriptor(descriptor, 'Workspace events').pipe(
          Effect.map(() => developmentWorkbench.events(descriptor)),
        ),
      ).pipe(Stream.mapEffect((event) => validateWorkspaceEvent(descriptor, event))),
    pickWorkspace: () => runtime.runPromise(workspace.pickAndRead).then(Option.getOrNull),
    readWorkspace: read ? (ref) => runtime.runPromise(read(ref)) : null,
    github: github
      ? {
          status: () => runtime.runPromise(github.status),
          setSource: (s) => runtime.runPromise(github.setSource(s)),
          savePat: (raw) => runtime.runPromise(github.savePat(raw)),
          clearPat: () => runtime.runPromise(github.clearPat),
          verify: () => runtime.runPromise(github.verify),
        }
      : null,
  }
}

export const makeAppServices = async (opts: {
  core: Layer.Layer<CoreServices>
  github?: Layer.Layer<GitHubService>
}): Promise<AppServices> => {
  if (opts.github) {
    const layer = Layer.merge(opts.core, opts.github)
    const runtime = ManagedRuntime.make(layer)
    const github = await runtime.runPromise(GitHubService)
    // Sound narrowing: the merged runtime provides CoreServices | GitHubService; buildFacade only needs CoreServices, but Layer/Runtime contravariance keeps the compiler from expressing this widening-as-subset directly.
    return buildFacade(runtime as ManagedRuntime.ManagedRuntime<CoreServices, never>, github)
  }
  const runtime = ManagedRuntime.make(opts.core)
  return buildFacade(runtime, null)
}
