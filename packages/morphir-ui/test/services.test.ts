import { describe, expect, test } from 'vitest'
import { Effect, Layer, Option } from 'effect'
import {
  AppInfoService,
  ConfigService,
  WorkspaceService,
  decodeUiConfig,
  defaultUiConfig,
  makeAppServices,
  withSnapshot,
  configToSnapshot,
  type UiConfig,
} from '../src/index.ts'
import { makeFakeCore, makeFakeGitHub } from './support/fake-services.ts'

describe('UiConfig', () => {
  test('empty input decodes to defaults', () => {
    expect(decodeUiConfig({})).toEqual(defaultUiConfig)
    expect(defaultUiConfig.appearance.colorScheme).toBe('dark')
    expect(defaultUiConfig.github.source).toBe('none')
    expect(defaultUiConfig.workspace.reopenOnLaunch).toBe(true)
  })
  test('invalid input falls back to defaults', () => {
    expect(decodeUiConfig({ appearance: { colorScheme: 'sepia' } })).toEqual(defaultUiConfig)
    expect(decodeUiConfig('garbage')).toEqual(defaultUiConfig)
  })
  test('snapshot round-trip', () => {
    const snap = configToSnapshot(defaultUiConfig)
    expect(snap.shell.leftWidth).toBe(224)
    const updated = withSnapshot(defaultUiConfig, {
      ...snap,
      appearance: { ...snap.appearance, colorScheme: 'light' },
    })
    expect(updated.appearance.colorScheme).toBe('light')
    expect(updated.github).toEqual(defaultUiConfig.github)
  })
})

describe('makeAppServices', () => {
  test('exposes core services and capability flags without github', async () => {
    const { core } = makeFakeCore({ version: '9.9.9' })
    const services = await makeAppServices({ core })
    expect(await services.version()).toBe('9.9.9')
    expect(services.capabilities.github).toBe(false)
    expect(services.github).toBeNull()
    const cfg = await services.loadConfig()
    expect(cfg).toEqual(defaultUiConfig)
  })
  test('config save round-trips', async () => {
    const { core, store } = makeFakeCore()
    const services = await makeAppServices({ core })
    const cfg = { ...defaultUiConfig, github: { source: 'gh-cli' as const } }
    await services.saveConfig(cfg)
    expect(store.config).toEqual(cfg)
    expect(await services.loadConfig()).toEqual(cfg)
  })
  test('workspace pick returns content; read capability follows the layer', async () => {
    const { core } = makeFakeCore({ workspaceContent: '{"formatVersion":3}', reopen: true })
    const services = await makeAppServices({ core })
    const picked = await services.pickWorkspace()
    expect(picked!.content).toBe('{"formatVersion":3}')
    expect(services.capabilities.reopenWorkspaces).toBe(true)
    expect(await services.readWorkspace!(picked!.ref)).toBe('{"formatVersion":3}')
  })
  test('updateConfig serializes concurrent read-modify-write calls', async () => {
    // A ConfigService whose load/save each take a beat, so two concurrent updateConfig calls
    // would interleave (and drop one mutation) if the facade did not serialize them.
    const store: { config: UiConfig } = { config: defaultUiConfig }
    const core = Layer.mergeAll(
      Layer.succeed(ConfigService, {
        load: Effect.sleep('5 millis').pipe(Effect.andThen(() => Effect.sync(() => store.config))),
        save: (c) =>
          Effect.sleep('5 millis').pipe(
            Effect.andThen(() => Effect.sync(() => void (store.config = c))),
          ),
      }),
      Layer.succeed(WorkspaceService, {
        pickAndRead: Effect.succeed(Option.none()),
        read: Option.none(),
      }),
      Layer.succeed(AppInfoService, { version: Effect.succeed('0.0.0-test') }),
    )
    const services = await makeAppServices({ core })
    await Promise.all([
      services.updateConfig((cfg) => ({ ...cfg, github: { source: 'gh-cli' } })),
      services.updateConfig((cfg) => ({
        ...cfg,
        workspace: { ...cfg.workspace, reopenOnLaunch: false },
      })),
    ])
    expect(store.config.github.source).toBe('gh-cli')
    expect(store.config.workspace.reopenOnLaunch).toBe(false)
  })
  test('github facade appears when the layer is provided', async () => {
    const { core } = makeFakeCore()
    const { github } = makeFakeGitHub({
      source: 'pat',
      pat: 'ghp_' + 'z'.repeat(36) + 'TAIL',
      login: 'octocat',
    })
    const services = await makeAppServices({ core, github })
    expect(services.capabilities.github).toBe(true)
    const status = await services.github!.status()
    expect(status).toEqual({ source: 'pat', tokenDisplay: 'Token(ghp_...TAIL)' })
    expect(await services.github!.verify()).toEqual({ login: 'octocat' })
    await services.github!.clearPat()
    expect((await services.github!.status()).tokenDisplay).toBeNull()
  })
})
