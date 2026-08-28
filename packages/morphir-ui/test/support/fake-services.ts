import { Effect, Layer, Option } from 'effect'
import {
  AppInfoService,
  ConfigService,
  GitHubError,
  GitHubService,
  WorkspaceService,
  defaultUiConfig,
  redactToken,
  type GitHubSource,
  type UiConfig,
} from '../../src/index.ts'

export const makeFakeCore = (opts?: {
  config?: UiConfig
  workspaceContent?: string
  version?: string
  reopen?: boolean
}) => {
  const store = { config: opts?.config ?? defaultUiConfig }
  const content =
    opts?.workspaceContent ?? '{"formatVersion":3,"distribution":["Library",[],[],{"modules":[]}]}'
  const core = Layer.mergeAll(
    Layer.succeed(ConfigService, {
      load: Effect.sync(() => store.config),
      save: (c) => Effect.sync(() => void (store.config = c)),
    }),
    Layer.succeed(WorkspaceService, {
      pickAndRead: Effect.succeed(Option.some({ ref: { path: '/fake/morphir-ir.json' }, content })),
      read: opts?.reopen ? Option.some(() => Effect.succeed(content)) : Option.none(),
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
