import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { Effect, Stream } from 'effect'
import {
  WorkbenchSourceService,
  DevelopmentWorkbenchService,
  defaultUiConfig,
  makeAppServices,
  type DevelopmentWorkbenchDescriptor,
} from '@morphir/ui'
import { sourceKey } from '@morphir/workspace'
import { browserCore } from '../src/layers/browser-layers.ts'

describe('browserCore', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  test('config defaults when localStorage is empty', async () => {
    const services = await makeAppServices({ core: browserCore('1.0.0') })
    expect(await services.loadConfig()).toEqual(defaultUiConfig)
    expect(await services.version()).toBe('1.0.0')
  })

  test('config round-trips through localStorage', async () => {
    const services = await makeAppServices({ core: browserCore('1.0.0') })
    const cfg = { ...defaultUiConfig, github: { source: 'gh-cli' as const } }
    await services.saveConfig(cfg)
    expect(JSON.parse(localStorage.getItem('morphir-ui.config')!)).toEqual(cfg)
    expect(await services.loadConfig()).toEqual(cfg)
  })

  test('corrupt localStorage falls back to defaults', async () => {
    localStorage.setItem('morphir-ui.config', '{not json')
    const services = await makeAppServices({ core: browserCore('1.0.0') })
    expect(await services.loadConfig()).toEqual(defaultUiConfig)
  })

  test('web capabilities: no github, no reopen', async () => {
    const core = browserCore('1.0.0')
    const services = await makeAppServices({ core })
    expect(services.capabilities).toEqual({ github: false, reopenWorkspaces: false })
    expect(services.github).toBeNull()
    expect(services.readWorkspace).toBeNull()
    expect(await services.listWorkbenchProviders()).toEqual([
      expect.objectContaining({ id: 'browser-local', name: 'This browser' }),
    ])
    await expect(services.pickWorkbenchSource('folder')).rejects.toThrow(
      'Folder Workbenches are not available in the browser',
    )
    const folderError = await Effect.runPromise(
      Effect.flip(
        Effect.flatMap(WorkbenchSourceService, (service) => service.pick('folder')).pipe(
          Effect.provide(core),
        ),
      ),
    )
    expect(folderError.code).toBe('unsupported-capability')
  })

  test('keeps separate browser selections that share a file name', async () => {
    const selectedFiles = [
      new File(
        ['{"formatVersion":3,"distribution":["Library",[],[],{"modules":[]}]}'],
        'model.json',
      ),
      new File(
        ['{"formatVersion":3,"distribution":["Library",[],[],{"modules":[]}]}'],
        'model.json',
      ),
    ]
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (
      this: HTMLInputElement,
    ) {
      Object.defineProperty(this, 'files', {
        configurable: true,
        value: [selectedFiles.shift()],
      })
      this.onchange?.(new Event('change'))
    })
    const services = await makeAppServices({ core: browserCore('1.0.0') })

    const first = await services.pickWorkbenchSource('model-file')
    const second = await services.pickWorkbenchSource('model-file')

    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    expect(first).not.toBe(second)
    const firstDescriptor = await services.inspectWorkbench(first!)
    const secondDescriptor = await services.inspectWorkbench(second!)
    expect(firstDescriptor).toMatchObject({
      id: sourceKey(first!),
      source: first,
      name: 'model.json',
    })
    expect(secondDescriptor).toMatchObject({
      id: sourceKey(second!),
      source: second,
      name: 'model.json (2)',
    })
    expect(secondDescriptor.source.displayName).not.toContain('browser-model:')
  })

  test('does not reinterpret a source owned by another provider', async () => {
    const services = await makeAppServices({ core: browserCore('1.0.0') })

    await expect(
      services.inspectWorkbench({
        providerId: 'cli:session-1',
        locator: 'browser-model:1:model.json',
        displayName: 'model.json',
      }),
    ).rejects.toThrow('Workbench source belongs to provider cli:session-1')
  })

  test('rejects restored model and development descriptors owned by another provider', async () => {
    const selectedFile = new File(
      ['{"formatVersion":3,"distribution":["Library",[],[],{"modules":[]}]}'],
      'model.json',
    )
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (
      this: HTMLInputElement,
    ) {
      Object.defineProperty(this, 'files', { configurable: true, value: [selectedFile] })
      this.onchange?.(new Event('change'))
    })
    const services = await makeAppServices({ core: browserCore('1.0.0') })
    const browserSource = (await services.pickWorkbenchSource('model-file'))!
    const browserDescriptor = await services.inspectWorkbench(browserSource)
    if (browserDescriptor.kind !== 'model') throw new Error('Expected model descriptor')
    const foreignSource = { ...browserSource, providerId: 'cli:session-1' }
    const foreignModel = {
      ...browserDescriptor,
      id: sourceKey(foreignSource),
      source: foreignSource,
    }

    await expect(services.loadModelWorkbench(foreignModel)).rejects.toThrow(
      'Workbench source belongs to provider cli:session-1',
    )

    const foreignDevelopment: DevelopmentWorkbenchDescriptor = {
      id: sourceKey(foreignSource),
      source: foreignSource,
      name: 'workspace',
      kind: 'development',
      route: 'overview',
      openedAt: '2026-08-29T12:00:00.000Z',
      lastUsedAt: '2026-08-29T12:00:00.000Z',
    }
    await expect(services.loadDevelopmentWorkbench(foreignDevelopment)).rejects.toThrow(
      'Workbench source belongs to provider cli:session-1',
    )
    await expect(
      services.loadDevelopmentProjectModel(foreignDevelopment, 'orders'),
    ).rejects.toThrow('Workbench source belongs to provider cli:session-1')
    await expect(
      Effect.runPromise(Stream.runCollect(services.workspaceEvents(foreignDevelopment))),
    ).rejects.toThrow('Workbench source belongs to provider cli:session-1')
  })

  test('reports unsupported events for its model-only development capability', async () => {
    const source = {
      providerId: 'browser-local',
      locator: 'directory:workspace',
      displayName: 'workspace',
    }
    const descriptor: DevelopmentWorkbenchDescriptor = {
      id: sourceKey(source),
      source,
      name: 'workspace',
      kind: 'development',
      route: 'overview',
      openedAt: '2026-08-29T12:00:00.000Z',
      lastUsedAt: '2026-08-29T12:00:00.000Z',
    }
    const error = await Effect.runPromise(
      Effect.flip(
        Effect.flatMap(DevelopmentWorkbenchService, (service) =>
          Stream.runCollect(service.events(descriptor)),
        ).pipe(Effect.provide(browserCore('1.0.0'))),
      ),
    )

    expect(error.code).toBe('unsupported-capability')
  })
})
