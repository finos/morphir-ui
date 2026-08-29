import { describe, expect, test } from 'vitest'
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

  test('migrates the singular active model and excludes it from Recent', () => {
    const config = decodeUiConfig({
      workspace: {
        active: '/models/a/morphir-ir.json',
        recent: ['/models/a/morphir-ir.json', '/models/b/morphir-ir.json'],
        reopenOnLaunch: false,
      },
    })

    expect(config.workbenches.activeId).toBe('/models/a/morphir-ir.json')
    expect(config.workbenches.open).toMatchObject([
      {
        id: '/models/a/morphir-ir.json',
        source: '/models/a/morphir-ir.json',
        name: 'morphir-ir.json',
        kind: 'model',
        distribution: 'single-file',
      },
    ])
    expect(config.workbenches.recent.map((item) => item.source)).toEqual([
      '/models/b/morphir-ir.json',
    ])
    expect(config.workbenches.reopenOnLaunch).toBe(false)
  })

  test('round-trips typed model and development descriptors', () => {
    const config = decodeUiConfig({
      workbenches: {
        open: [
          {
            id: '/models/a.json',
            source: '/models/a.json',
            name: 'A',
            kind: 'model',
            distribution: 'single-file',
            route: 'explorer',
            openedAt: '2026-08-29T12:00:00.000Z',
            lastUsedAt: '2026-08-29T12:00:00.000Z',
          },
          {
            id: '/dev/morphir',
            source: '/dev/morphir',
            name: 'morphir',
            kind: 'development',
            route: 'overview',
            openedAt: '2026-08-29T12:01:00.000Z',
            lastUsedAt: '2026-08-29T12:01:00.000Z',
          },
        ],
        recent: [],
        activeId: '/dev/morphir',
        reopenOnLaunch: true,
      },
    })

    expect(config.workbenches.open).toHaveLength(2)
    expect(config.workbenches.activeId).toBe('/dev/morphir')
  })
})
