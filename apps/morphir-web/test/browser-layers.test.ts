import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { defaultUiConfig, makeAppServices } from '@morphir/ui'
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
    const services = await makeAppServices({ core: browserCore('1.0.0') })
    expect(services.capabilities).toEqual({ github: false, reopenWorkspaces: false })
    expect(services.github).toBeNull()
    expect(services.readWorkspace).toBeNull()
    await expect(services.pickWorkbenchSource('folder')).rejects.toThrow(
      'Folder Workbenches are not available in the browser',
    )
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
      id: sourceKey({ providerId: 'browser-local', locator: first!, displayName: 'model.json' }),
      source: { providerId: 'browser-local', locator: first!, displayName: 'model.json' },
      name: 'model.json',
    })
    expect(secondDescriptor).toMatchObject({
      id: sourceKey({ providerId: 'browser-local', locator: second!, displayName: 'model.json (2)' }),
      source: { providerId: 'browser-local', locator: second!, displayName: 'model.json (2)' },
      name: 'model.json (2)',
    })
    expect(secondDescriptor.source.displayName).not.toContain('browser-model:')
  })
})
