import { Context, Data, Effect, Layer, ManagedRuntime, Option } from 'effect'
import type { UiConfig } from './config.ts'

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

export type CoreServices = ConfigService | WorkspaceService | AppInfoService

export interface Capabilities {
  readonly github: boolean
  readonly reopenWorkspaces: boolean
}

export interface AppServices {
  readonly capabilities: Capabilities
  version(): Promise<string>
  loadConfig(): Promise<UiConfig>
  saveConfig(config: UiConfig): Promise<void>
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
  const appInfo = await runtime.runPromise(AppInfoService)
  const read = Option.getOrNull(workspace.read)
  return {
    capabilities: { github: github !== null, reopenWorkspaces: read !== null },
    version: () => runtime.runPromise(appInfo.version),
    loadConfig: () => runtime.runPromise(config.load),
    saveConfig: (c) => runtime.runPromise(config.save(c)),
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
    return buildFacade(
      runtime as ManagedRuntime.ManagedRuntime<CoreServices, never>,
      github,
    )
  }
  const runtime = ManagedRuntime.make(opts.core)
  return buildFacade(runtime, null)
}
