import { Effect, Layer, Option, Stream } from 'effect'
import {
  AppInfoService,
  ConfigService,
  DevelopmentWorkbenchService,
  GitHubError,
  GitHubService,
  ModelWorkbenchService,
  WorkbenchError,
  WorkbenchProviderService,
  WorkbenchSourceService,
  unsupportedProviderError,
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
import { desktopSourceRef, requireDesktopSourceRef } from '../../../shared/workbench-source.ts'

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
          source: descriptor.source,
          message: error.message,
        }),
    ),
  )
}

export { desktopSourceRef } from '../../../shared/workbench-source.ts'

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
        source.providerId !== 'desktop-local'
          ? Effect.fail(unsupportedProviderError('desktop-local', source))
          : rpc
              .effect<WorkbenchDescriptor>('morphir/workbench/inspect', {
                source,
              })
              .pipe(
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
        rpc.effect<{ source: unknown } | null>('morphir/workbench/pick', { kind }).pipe(
          Effect.mapError(
            (error) =>
              new WorkbenchError({
                code: 'read-failed',
                source: '<picker>',
                message: error.message,
              }),
          ),
          Effect.flatMap((result) =>
            result === null
              ? Effect.succeed(Option.none())
              : Effect.try({
                  try: () => Option.some(requireDesktopSourceRef(result.source)),
                  catch: (error) =>
                    error instanceof WorkbenchError
                      ? error
                      : new WorkbenchError({
                          code: 'detection-failed',
                          source: '<picker>',
                          message: error instanceof Error ? error.message : String(error),
                        }),
                }),
          ),
        ),
      reveal: (source) =>
        source.providerId !== 'desktop-local'
          ? Effect.fail(unsupportedProviderError('desktop-local', source))
          : rpc.effect('morphir/workbench/reveal', { source }).pipe(
              Effect.asVoid,
              Effect.mapError(
                (error) =>
                  new WorkbenchError({ code: 'read-failed', source, message: error.message }),
              ),
            ),
    }),
    Layer.succeed(WorkbenchProviderService, {
      list: Effect.succeed([
        {
          id: 'desktop-local',
          name: 'This computer',
          kind: 'local' as const,
          status: 'available' as const,
          capabilities: [
            { name: 'morphir/model/open', version: '1' },
            { name: 'morphir/development/inspect', version: '1' },
          ],
        },
      ]),
    }),
    Layer.succeed(ModelWorkbenchService, {
      load: (descriptor: ModelWorkbenchDescriptor) =>
        descriptor.source.providerId !== 'desktop-local'
          ? Effect.fail(unsupportedProviderError('desktop-local', descriptor.source))
          : rpc
              .effect<{
                content: string | null
                manifest: Readonly<Record<string, unknown>> | null
              }>('morphir/workbench/readModel', { descriptor })
              .pipe(
                Effect.mapError(
                  (error) =>
                    new WorkbenchError({
                      code: 'read-failed',
                      source: descriptor.source,
                      message: error.message,
                    }),
                ),
                Effect.flatMap((source) => decodeModelSource(descriptor, source)),
              ),
    }),
    Layer.succeed(DevelopmentWorkbenchService, {
      load: (descriptor: DevelopmentWorkbenchDescriptor) =>
        descriptor.source.providerId !== 'desktop-local'
          ? Effect.fail(unsupportedProviderError('desktop-local', descriptor.source))
          : rpc
              .effect<{
                configAnchor: string | null
                modelSources: ReadonlyArray<string>
                knowledgeBaseSources: ReadonlyArray<string>
              }>('morphir/workbench/inspectDevelopment', { descriptor })
              .pipe(
                Effect.map((summary) => ({
                  kind: 'development' as const,
                  descriptor,
                  snapshot: {
                    id: descriptor.id,
                    root: descriptor.source,
                    name: descriptor.name,
                    configAnchor: summary.configAnchor,
                    state: 'open' as const,
                    projects: [],
                    modelSources: summary.modelSources.map(desktopSourceRef),
                    knowledgeBaseSources: summary.knowledgeBaseSources.map(desktopSourceRef),
                    diagnostics: [],
                  },
                })),
                Effect.mapError(
                  (error) =>
                    new WorkbenchError({
                      code: 'read-failed',
                      source: descriptor.source,
                      message: error.message,
                    }),
                ),
              ),
      loadProjectModel: (descriptor) =>
        Effect.fail(
          descriptor.source.providerId === 'desktop-local'
            ? new WorkbenchError({
                code: 'unsupported-capability',
                source: descriptor.source,
                message: 'Project model loading is not available yet',
              })
            : unsupportedProviderError('desktop-local', descriptor.source),
        ),
      events: (descriptor) =>
        descriptor.source.providerId === 'desktop-local'
          ? Stream.empty
          : Stream.fail(unsupportedProviderError('desktop-local', descriptor.source)),
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
