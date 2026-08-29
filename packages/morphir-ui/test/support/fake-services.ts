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
  redactToken,
  type GitHubSource,
  type UiConfig,
} from '../../src/index.ts'
import { decodeMorphirIr, toWorkspaceIr } from '@morphir/ir'

export const makeFakeCore = (opts?: {
  config?: UiConfig
  workspaceContent?: string
  version?: string
  reopen?: boolean
  workspaceError?: string
  workbenchSources?: ReadonlyArray<string>
  failingSources?: ReadonlyArray<string>
  failingLoads?: ReadonlyArray<string>
  canonicalSources?: Readonly<Record<string, string>>
  development?: {
    configAnchor?: string | null
    modelSources?: ReadonlyArray<string>
    knowledgeBaseSources?: ReadonlyArray<string>
  }
  configLayer?: Layer.Layer<ConfigService>
}) => {
  const store = { config: opts?.config ?? defaultUiConfig }
  const content =
    opts?.workspaceContent ?? '{"formatVersion":3,"distribution":["Library",[],[],{"modules":[]}]}'
  const timestamp = '2026-08-29T12:00:00.000Z'
  const failingSources = new Set(opts?.failingSources ?? [])
  const failingLoads = new Set(opts?.failingLoads ?? [])
  const core = Layer.mergeAll(
    opts?.configLayer ??
      Layer.succeed(ConfigService, {
        load: Effect.sync(() => store.config),
        save: (c) => Effect.sync(() => void (store.config = c)),
      }),
    Layer.succeed(WorkspaceService, {
      pickAndRead: opts?.workspaceError
        ? Effect.fail(new WorkspaceError({ message: opts.workspaceError }))
        : Effect.succeed(Option.some({ ref: { path: '/fake/morphir-ir.json' }, content })),
      read: opts?.reopen ? Option.some(() => Effect.succeed(content)) : Option.none(),
    }),
    Layer.succeed(WorkbenchSourceService, {
      inspect: (source) => {
        if (failingSources.has(source)) {
          return Effect.fail(
            new WorkbenchError({
              code: 'not-found',
              source,
              message: `Workbench source not found: ${source}`,
            }),
          )
        }
        const canonicalSource = opts?.canonicalSources?.[source] ?? source
        return Effect.succeed(
          canonicalSource.endsWith('.json')
            ? {
                id: canonicalSource,
                source: canonicalSource,
                name: canonicalSource.split('/').at(-1) ?? canonicalSource,
                kind: 'model' as const,
                distribution: 'single-file' as const,
                route: 'overview' as const,
                openedAt: timestamp,
                lastUsedAt: timestamp,
              }
            : {
                id: canonicalSource,
                source: canonicalSource,
                name: canonicalSource.split('/').at(-1) ?? canonicalSource,
                kind: 'development' as const,
                route: 'overview' as const,
                openedAt: timestamp,
                lastUsedAt: timestamp,
              },
        )
      },
      pick: () =>
        Effect.succeed(Option.some(opts?.workbenchSources?.[0] ?? '/fake/morphir-ir.json')),
      reveal: () => Effect.void,
    }),
    Layer.succeed(ModelWorkbenchService, {
      load: (descriptor) =>
        failingLoads.has(descriptor.source)
          ? Effect.fail(
              new WorkbenchError({
                code: 'invalid-distribution',
                source: descriptor.source,
                message: `Invalid Morphir distribution: ${descriptor.source}`,
              }),
            )
          : descriptor.distribution === 'document-tree'
            ? Effect.succeed({
                kind: 'model' as const,
                descriptor,
                library: null,
                ir: null,
                manifest: { formatVersion: 4, distribution: 'Library' },
              })
            : decodeMorphirIr(content).pipe(
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
              ),
    }),
    Layer.succeed(DevelopmentWorkbenchService, {
      load: (descriptor) =>
        Effect.succeed({
          kind: 'development' as const,
          descriptor,
          configAnchor: opts?.development?.configAnchor ?? descriptor.source,
          modelSources: opts?.development?.modelSources ?? [],
          knowledgeBaseSources: opts?.development?.knowledgeBaseSources ?? [],
        }),
    }),
    Layer.succeed(AppInfoService, { version: Effect.succeed(opts?.version ?? '0.0.0-test') }),
  )
  return { core, store }
}

export const makeFakeGitHub = (init?: {
  source?: GitHubSource
  pat?: string | null
  login?: string
}) => {
  const state = { source: init?.source ?? 'none', pat: init?.pat ?? null }
  const github = Layer.succeed(GitHubService, {
    status: Effect.sync(() => ({
      source: state.source,
      tokenDisplay: state.pat ? redactToken(state.pat) : null,
    })),
    setSource: (source) => Effect.sync(() => void (state.source = source)),
    savePat: (raw) =>
      Effect.sync(() => {
        state.pat = raw
        state.source = 'pat'
      }),
    clearPat: Effect.sync(() => {
      state.pat = null
      state.source = 'none'
    }),
    verify: init?.login
      ? Effect.sync(() => ({ login: init.login! }))
      : Effect.fail(new GitHubError({ message: 'no token configured' })),
  })
  return { github, state }
}
