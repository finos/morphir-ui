import { describe, expect, test } from 'vitest'
import { sourceKey } from '@morphir/workspace'
import { decodeUiConfig, defaultUiConfig } from '../src/index.ts'

describe('Workbench config', () => {
  test('defaults to no open or recent Workbenches', () => {
    expect(defaultUiConfig.workbenches).toEqual({
      open: [],
      recent: [],
      activeId: null,
      reopenOnLaunch: true,
    })
  })

  test('preserves a partial Workbench config setting while defaulting its missing fields', () => {
    const config = decodeUiConfig({ workbenches: { reopenOnLaunch: false } })

    expect(config.workbenches).toEqual({
      open: [],
      recent: [],
      activeId: null,
      reopenOnLaunch: false,
    })
  })

  test('salvages valid descriptors and unrelated settings from a mixed persisted config', () => {
    const source = {
      providerId: 'browser-local',
      locator: 'session:model-a',
      displayName: 'model-a.json',
    }
    const config = decodeUiConfig({
      workbenches: {
        open: [
          {
            id: sourceKey(source),
            source,
            name: 'model-a.json',
            kind: 'model',
            distribution: 'single-file',
            route: 'overview',
            openedAt: '2026-08-29T12:00:00.000Z',
            lastUsedAt: '2026-08-29T12:00:00.000Z',
          },
          { source: false },
        ],
      },
      appearance: { colorScheme: 'dark', animations: false },
      shell: {
        leftWidth: 300,
        rightWidth: 400,
        bottomHeight: 200,
        leftVisible: false,
        rightVisible: true,
        bottomVisible: false,
      },
      github: { source: 'gh-cli' },
    })

    expect(config.workbenches.open).toHaveLength(1)
    expect(config.workbenches.open[0]?.source).toEqual(source)
    expect(config.appearance).toEqual({ colorScheme: 'dark', animations: false })
    expect(config.shell.leftWidth).toBe(300)
    expect(config.github.source).toBe('gh-cli')
  })

  test('repairs descriptor IDs and gives open Workbenches precedence over Recent', () => {
    const source = {
      providerId: 'desktop-local',
      locator: '/models/a.json',
      displayName: 'a.json',
    }
    const otherSource = {
      providerId: 'desktop-local',
      locator: '/models/b.json',
      displayName: 'b.json',
    }
    const model = (id: string, modelSource: typeof source, name: string) => ({
      id,
      source: modelSource,
      name,
      kind: 'model' as const,
      distribution: 'single-file' as const,
      route: 'overview' as const,
      openedAt: '2026-08-29T12:00:00.000Z',
      lastUsedAt: '2026-08-29T12:00:00.000Z',
    })
    const config = decodeUiConfig({
      workbenches: {
        open: [model('open-old-id', source, 'a.json'), model('open-duplicate-id', source, 'A')],
        recent: [
          model('recent-old-id', source, 'a.json'),
          model('recent-b-old-id', otherSource, 'b.json'),
          model('recent-b-duplicate-id', otherSource, 'B'),
        ],
        activeId: 'recent-old-id',
      },
    })

    expect(config.workbenches.open.map((descriptor) => descriptor.id)).toEqual([sourceKey(source)])
    expect(config.workbenches.recent.map((descriptor) => descriptor.id)).toEqual([
      sourceKey(otherSource),
    ])
    expect(config.workbenches.activeId).toBe(sourceKey(source))
  })

  test('keeps a canonical active ID when an earlier stale ID collides with it', () => {
    const sourceA = {
      providerId: 'desktop-local',
      locator: '/models/a.json',
      displayName: 'a.json',
    }
    const sourceB = {
      providerId: 'desktop-local',
      locator: '/models/b.json',
      displayName: 'b.json',
    }
    const model = (id: string, source: typeof sourceA, name: string) => ({
      id,
      source,
      name,
      kind: 'model' as const,
      distribution: 'single-file' as const,
      route: 'overview' as const,
      openedAt: '2026-08-29T12:00:00.000Z',
      lastUsedAt: '2026-08-29T12:00:00.000Z',
    })
    const config = decodeUiConfig({
      workbenches: {
        open: [
          model(sourceKey(sourceB), sourceA, 'a.json'),
          model(sourceKey(sourceB), sourceB, 'b.json'),
        ],
        activeId: sourceKey(sourceB),
      },
    })

    expect(config.workbenches.open.map((descriptor) => descriptor.id)).toEqual([
      sourceKey(sourceA),
      sourceKey(sourceB),
    ])
    expect(config.workbenches.activeId).toBe(sourceKey(sourceB))
  })

  test('clears an active alias that resolves only to a Recent Workbench', () => {
    const source = {
      providerId: 'desktop-local',
      locator: '/models/recent.json',
      displayName: 'recent.json',
    }
    const config = decodeUiConfig({
      workbenches: {
        open: [],
        recent: [
          {
            id: 'recent-old-id',
            source,
            name: 'recent.json',
            kind: 'model',
            distribution: 'single-file',
            route: 'overview',
            openedAt: '2026-08-29T12:00:00.000Z',
            lastUsedAt: '2026-08-29T12:00:00.000Z',
          },
        ],
        activeId: 'recent-old-id',
      },
    })

    expect(config.workbenches.activeId).toBeNull()
  })

  test('migrates the singular active model and excludes it from Recent', () => {
    const config = decodeUiConfig({
      workspace: {
        active: '/models/a/morphir-ir.json',
        recent: ['/models/a/morphir-ir.json', '/models/b/morphir-ir.json'],
        reopenOnLaunch: false,
      },
    })

    expect(config.workbenches.activeId).toBe(JSON.stringify(['legacy-local', '/models/a/morphir-ir.json']))
    expect(config.workbenches.open).toMatchObject([
      {
        id: JSON.stringify(['legacy-local', '/models/a/morphir-ir.json']),
        source: {
          providerId: 'legacy-local',
          locator: '/models/a/morphir-ir.json',
          displayName: 'morphir-ir.json',
        },
        name: 'morphir-ir.json',
        kind: 'model',
        distribution: 'single-file',
      },
    ])
    expect(config.workbenches.recent.map((item) => item.source.locator)).toEqual([
      '/models/b/morphir-ir.json',
    ])
    expect(config.workbenches.reopenOnLaunch).toBe(false)
  })

  test('migrates PR15 string-backed descriptors with the requested legacy provider', () => {
    const config = decodeUiConfig(
      {
        workbenches: {
          open: [
            {
              id: 'development:current',
              source: '/dev/morphir',
              name: 'Morphir development',
              kind: 'development',
              route: 'overview',
              openedAt: '2026-08-29T12:01:00.000Z',
              lastUsedAt: '2026-08-29T12:01:00.000Z',
            },
          ],
          recent: [],
          activeId: 'development:current',
          reopenOnLaunch: true,
        },
      },
      { legacyProviderId: 'desktop-local' },
    )

    expect(config.workbenches.open[0]).toMatchObject({
      id: JSON.stringify(['desktop-local', '/dev/morphir']),
      source: {
        providerId: 'desktop-local',
        locator: '/dev/morphir',
        displayName: 'Morphir development',
      },
    })
    expect(config.workbenches.activeId).toBe(JSON.stringify(['desktop-local', '/dev/morphir']))
  })

  test('round-trips already-qualified model and development descriptors', () => {
    const modelSource = {
      providerId: 'browser-local',
      locator: '/models/a.json',
      displayName: 'A',
    }
    const developmentSource = {
      providerId: 'cli:one',
      locator: '/dev/morphir',
      displayName: 'morphir',
    }
    const config = decodeUiConfig({
      workbenches: {
        open: [
          {
            id: sourceKey(modelSource),
            source: modelSource,
            name: 'A',
            kind: 'model',
            distribution: 'single-file',
            route: 'explorer',
            openedAt: '2026-08-29T12:00:00.000Z',
            lastUsedAt: '2026-08-29T12:00:00.000Z',
          },
          {
            id: sourceKey(developmentSource),
            source: developmentSource,
            name: 'morphir',
            kind: 'development',
            route: 'overview',
            openedAt: '2026-08-29T12:01:00.000Z',
            lastUsedAt: '2026-08-29T12:01:00.000Z',
          },
        ],
        recent: [],
        activeId: sourceKey(developmentSource),
        reopenOnLaunch: true,
      },
    })

    expect(config.workbenches.open).toHaveLength(2)
    expect(config.workbenches.open.map((descriptor) => descriptor.source)).toEqual([
      modelSource,
      developmentSource,
    ])
    expect(config.workbenches.activeId).toBe(sourceKey(developmentSource))
  })
})
