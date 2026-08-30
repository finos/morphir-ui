import { Effect, Layer, Option } from 'effect'
import {
  AppInfoService,
  ConfigService,
  DevelopmentWorkbenchService,
  GitHubError,
  GitHubService,
  ModelWorkbenchService,
  WorkbenchError,
  WorkbenchSourceService,
  WorkspaceError,
  WorkspaceService,
  defaultUiConfig,
  type CoreServices,
  type GitHubStatus,
  type UiConfig,
  type WorkspaceRef,
  type DevelopmentWorkbenchDescriptor,
  type ModelWorkbenchData,
  type ModelWorkbenchDescriptor,
  type WorkbenchDescriptor,
} from '@morphir/ui'
import { decodeMorphirIr, toWorkspaceIr } from '@morphir/ir'
import type { RpcClient } from './rpc-client.ts'

const decodeModelSource = (
  descriptor: ModelWorkbenchDescriptor,
  source: {
    content: string | null
    manifest: Readonly<Record<string, unknown>> | null
  },
): Effect.Effect<ModelWorkbenchData, WorkbenchError> => {
  if (source.content === null) {
    return Effect.succeed({
      kind: 'model',
      descriptor,
      library: null,
      ir: null,
      manifest: source.manifest,
    })
  }
  return decodeMorphirIr(source.content).pipe(
    Effect.map((library) => ({
      kind: 'model' as const,
      descriptor,
      library,
      ir: toWorkspaceIr(library),
      manifest: null,
    })),
    Effect.mapError(
      (error) =>
        new WorkbenchError({
          code: 'invalid-distribution',
          source: descriptor.source.locator,
          message: error.message,
        }),
    ),
  )
}

export const desktopCore = (rpc: RpcClient): Layer.Layer<CoreServices> =>
  Layer.mergeAll(
    Layer.succeed(AppInfoService, {
      version: rpc.effect<{ version: string }>('morphir/shell/appVersion').pipe(
        Effect.map((r) => r.version),
        Effect.orDie,
      ),
    }),
    Layer.succeed(ConfigService, {
      load: rpc
        .effect<UiConfig>('morphir/config/load')
        .pipe(Effect.orElseSucceed(() => defaultUiConfig)),
      save: (config: UiConfig) =>
        rpc.effect('morphir/config/save', { config }).pipe(Effect.asVoid, Effect.orDie),
    }),
    Layer.succeed(WorkspaceService, {
      pickAndRead: rpc.effect<{ path: string } | null>('morphir/workspace/pick').pipe(
        Effect.mapError((e) => new WorkspaceError({ message: e.message })),
        Effect.flatMap((picked) =>
          picked === null
            ? Effect.succeed(Option.none())
            : rpc.effect<{ content: string }>('morphir/workspace/read', { path: picked.path }).pipe(
                Effect.mapError((e) => new WorkspaceError({ message: e.message })),
                Effect.map((r) => Option.some({ ref: { path: picked.path }, content: r.content })),
              ),
        ),
      ),
      read: Option.some((ref: WorkspaceRef) =>
        rpc.effect<{ content: string }>('morphir/workspace/read', { path: ref.path }).pipe(
          Effect.mapError((e) => new WorkspaceError({ message: e.message })),
          Effect.map((r) => r.content),
        ),
      ),
    }),
    Layer.succeed(WorkbenchSourceService, {
      inspect: (source) =>
        rpc.effect<WorkbenchDescriptor>('morphir/workbench/inspect', { source }).pipe(
          Effect.mapError(
            (error) =>
              new WorkbenchError({
                code: 'detection-failed',
                source,
                message: error.message,
              }),
          ),
        ),
      pick: (kind) =>
        rpc.effect<{ source: string } | null>('morphir/workbench/pick', { kind }).pipe(
          Effect.map((result) =>
            result === null ? Option.none<string>() : Option.some(result.source),
          ),
          Effect.mapError(
            (error) =>
              new WorkbenchError({
                code: 'read-failed',
                source: '<picker>',
                message: error.message,
              }),
          ),
        ),
      reveal: (source) =>
        rpc.effect('morphir/workbench/reveal', { source }).pipe(
          Effect.asVoid,
          Effect.mapError(
            (error) => new WorkbenchError({ code: 'read-failed', source, message: error.message }),
          ),
        ),
    }),
    Layer.succeed(ModelWorkbenchService, {
      load: (descriptor: ModelWorkbenchDescriptor) =>
        rpc
          .effect<{
            content: string | null
            manifest: Readonly<Record<string, unknown>> | null
          }>('morphir/workbench/readModel', { descriptor })
          .pipe(
            Effect.mapError(
              (error) =>
                new WorkbenchError({
                  code: 'read-failed',
                  source: descriptor.source.locator,
                  message: error.message,
                }),
            ),
            Effect.flatMap((source) => decodeModelSource(descriptor, source)),
          ),
    }),
    Layer.succeed(DevelopmentWorkbenchService, {
      load: (descriptor: DevelopmentWorkbenchDescriptor) =>
        rpc
          .effect<{
            configAnchor: string | null
            modelSources: ReadonlyArray<string>
            knowledgeBaseSources: ReadonlyArray<string>
          }>('morphir/workbench/inspectDevelopment', { descriptor })
          .pipe(
            Effect.map((summary) => ({ kind: 'development' as const, descriptor, ...summary })),
            Effect.mapError(
              (error) =>
                new WorkbenchError({
                  code: 'read-failed',
                  source: descriptor.source.locator,
                  message: error.message,
                }),
            ),
          ),
    }),
  )

export const desktopGitHub = (rpc: RpcClient): Layer.Layer<GitHubService> =>
  Layer.succeed(GitHubService, {
    status: rpc
      .effect<GitHubStatus>('morphir/github/status')
      .pipe(Effect.mapError((e) => new GitHubError({ message: e.message }))),
    setSource: (source) =>
      rpc.effect('morphir/github/setSource', { source }).pipe(
        Effect.asVoid,
        Effect.mapError((e) => new GitHubError({ message: e.message })),
      ),
    savePat: (raw) =>
      rpc.effect('morphir/github/setToken', { token: raw }).pipe(
        Effect.asVoid,
        Effect.mapError((e) => new GitHubError({ message: e.message })),
      ),
    clearPat: rpc.effect('morphir/github/clearToken').pipe(
      Effect.asVoid,
      Effect.mapError((e) => new GitHubError({ message: e.message })),
    ),
    verify: rpc
      .effect<{ login: string }>('morphir/github/verify')
      .pipe(Effect.mapError((e) => new GitHubError({ message: e.message }))),
  })
