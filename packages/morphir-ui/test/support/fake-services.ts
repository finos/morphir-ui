import { Effect, Layer, Option, Stream } from 'effect'
import {
  sourceKey,
  type WorkbenchProvider,
  type WorkbenchSourceRef,
  type WorkspaceEvent,
  type WorkspaceSnapshot,
} from '@morphir/workspace'
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
  WorkspaceError,
  WorkspaceService,
  defaultUiConfig,
  legacySourceRef,
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
  inspectResultId?: string
  inspectResultSource?: WorkbenchSourceRef
  modelResultSource?: WorkbenchSourceRef
  canonicalSources?: Readonly<Record<string, string>>
  development?: {
    configAnchor?: string | null
    modelSources?: ReadonlyArray<string>
    knowledgeBaseSources?: ReadonlyArray<string>
    snapshot?: WorkspaceSnapshot
    events?: Stream.Stream<WorkspaceEvent, WorkbenchError>
    onEvents?: () => void
    onProjectModelLoad?: () => void
    resultSource?: WorkbenchSourceRef
    projectResultId?: string
    projectResultSource?: WorkbenchSourceRef
  }
  providers?: ReadonlyArray<WorkbenchProvider>
  configLayer?: Layer.Layer<ConfigService>
}) => {
  const store = { config: opts?.config ?? defaultUiConfig }
  const content =
    opts?.workspaceContent ?? '{"formatVersion":3,"distribution":["Library",[],[],{"modules":[]}]}'
  const timestamp = '2026-08-29T12:00:00.000Z'
  const failingSources = new Set(opts?.failingSources ?? [])
  const failingLoads = new Set(opts?.failingLoads ?? [])
  const providers =
    opts?.providers ??
    ([
      {
        id: 'legacy-local',
        name: 'Test provider',
        kind: 'local',
        status: 'available',
        capabilities: [{ name: 'morphir/model/open', version: '1' }],
      },
    ] satisfies ReadonlyArray<WorkbenchProvider>)
  const providerIds = new Set(providers.map((provider) => provider.id))
  const providerError = (source: ReturnType<typeof legacySourceRef>): WorkbenchError =>
    new WorkbenchError({
      code: 'unsupported-capability',
      source,
      message: `Workbench source belongs to provider ${source.providerId}`,
    })
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
        if (!providerIds.has(source.providerId)) return Effect.fail(providerError(source))
        if (failingSources.has(source.locator)) {
          return Effect.fail(
            new WorkbenchError({
              code: 'not-found',
              source,
              message: `Workbench source not found: ${source.locator}`,
            }),
          )
        }
        const canonicalSource = opts?.canonicalSources?.[source.locator] ?? source.locator
        const sourceRef = opts?.inspectResultSource ?? { ...source, locator: canonicalSource }
        return Effect.succeed(
          canonicalSource.endsWith('.json')
            ? {
                id: opts?.inspectResultId ?? sourceKey(sourceRef),
                source: sourceRef,
                name: canonicalSource.split('/').at(-1) ?? canonicalSource,
                kind: 'model' as const,
                distribution: 'single-file' as const,
                route: 'overview' as const,
                openedAt: timestamp,
                lastUsedAt: timestamp,
              }
            : {
                id: opts?.inspectResultId ?? sourceKey(sourceRef),
                source: sourceRef,
                name: canonicalSource.split('/').at(-1) ?? canonicalSource,
                kind: 'development' as const,
                route: 'overview' as const,
                openedAt: timestamp,
                lastUsedAt: timestamp,
              },
        )
      },
      pick: () =>
        Effect.succeed(
          Option.some(legacySourceRef(opts?.workbenchSources?.[0] ?? '/fake/morphir-ir.json')),
        ),
      reveal: () => Effect.void,
    }),
    Layer.succeed(WorkbenchProviderService, {
      list: Effect.succeed(providers),
    }),
    Layer.succeed(ModelWorkbenchService, {
      load: (descriptor) =>
        !providerIds.has(descriptor.source.providerId)
          ? Effect.fail(providerError(descriptor.source))
          : failingLoads.has(descriptor.source.locator)
            ? Effect.fail(
                new WorkbenchError({
                  code: 'invalid-distribution',
                  source: descriptor.source.locator,
                  message: `Invalid Morphir distribution: ${descriptor.source.locator}`,
                }),
              )
            : descriptor.distribution === 'document-tree'
              ? Effect.succeed({
                  kind: 'model' as const,
                  descriptor: opts?.modelResultSource
                    ? {
                        ...descriptor,
                        id: sourceKey(opts.modelResultSource),
                        source: opts.modelResultSource,
                      }
                    : descriptor,
                  library: null,
                  ir: null,
                  manifest: { formatVersion: 4, distribution: 'Library' },
                })
              : decodeMorphirIr(content).pipe(
                  Effect.map((library) => ({
                    kind: 'model' as const,
                    descriptor: opts?.modelResultSource
                      ? {
                          ...descriptor,
                          id: sourceKey(opts.modelResultSource),
                          source: opts.modelResultSource,
                        }
                      : descriptor,
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
                ),
    }),
    Layer.succeed(DevelopmentWorkbenchService, {
      load: (descriptor) =>
        !providerIds.has(descriptor.source.providerId)
          ? Effect.fail(providerError(descriptor.source))
          : Effect.succeed({
              kind: 'development' as const,
              descriptor: opts?.development?.resultSource
                ? {
                    ...descriptor,
                    id: sourceKey(opts.development.resultSource),
                    source: opts.development.resultSource,
                  }
                : descriptor,
              snapshot:
                opts?.development?.snapshot ??
                ({
                  id: descriptor.id,
                  root: descriptor.source,
                  name: descriptor.name,
                  configAnchor: opts?.development?.configAnchor ?? descriptor.source.locator,
                  state: 'open',
                  projects: [],
                  modelSources: (opts?.development?.modelSources ?? []).map((locator) => ({
                    ...legacySourceRef(locator, descriptor.source.providerId),
                    displayName: locator,
                  })),
                  knowledgeBaseSources: (opts?.development?.knowledgeBaseSources ?? []).map(
                    (locator) => ({
                      ...legacySourceRef(locator, descriptor.source.providerId),
                      displayName: locator,
                    }),
                  ),
                  diagnostics: [],
                } satisfies WorkspaceSnapshot),
            }),
      loadProjectModel: (descriptor, projectId) => {
        opts?.development?.onProjectModelLoad?.()
        if (!providerIds.has(descriptor.source.providerId)) {
          return Effect.fail(providerError(descriptor.source))
        }
        const source =
          opts?.development?.projectResultSource ??
          ({
            ...descriptor.source,
            locator: `${descriptor.source.locator}#${projectId}`,
            displayName: projectId,
          } satisfies WorkbenchSourceRef)
        return Effect.succeed({
          kind: 'model' as const,
          descriptor: {
            id: opts?.development?.projectResultId ?? sourceKey(source),
            source,
            name: projectId,
            kind: 'model' as const,
            distribution: 'single-file' as const,
            route: 'overview' as const,
            openedAt: timestamp,
            lastUsedAt: timestamp,
          },
          library: null,
          ir: null,
          manifest: null,
        })
      },
      events: (descriptor) => {
        opts?.development?.onEvents?.()
        return !providerIds.has(descriptor.source.providerId)
          ? Stream.fail(providerError(descriptor.source))
          : (opts?.development?.events ?? Stream.empty)
      },
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
