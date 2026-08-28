import { cleanup, render, screen } from '@testing-library/svelte'
import { afterEach, describe, expect, test } from 'vitest'
import MorphirApp from '../src/shell/MorphirApp.svelte'
import { defaultUiConfig, makeAppServices } from '../src/index.ts'
import { makeFakeCore } from './support/fake-services.ts'

// See ir-explorer.test.ts: this project has no vitest globals, so auto-cleanup from
// @testing-library/svelte never registers itself. Without this, DOM from each render()
// bleeds into the next test in this file.
afterEach(() => cleanup())

describe('MorphirApp', () => {
  test('hydrates the shell from initial config', async () => {
    const { core } = makeFakeCore()
    const services = await makeAppServices({ core })
    const config = {
      ...defaultUiConfig,
      appearance: { colorScheme: 'light' as const, animations: false },
    }
    const { container } = render(MorphirApp, {
      props: { services, badge: 'WEB', version: '0.0.1', initialConfig: config },
    })
    const root = container.querySelector('.shell')!
    expect(root.classList.contains('theme-light')).toBe(true)
    expect(root.classList.contains('no-motion')).toBe(true)
    expect(screen.getByText('WEB')).toBeTruthy()
  })

  test('persists shell snapshot changes to config (debounced)', async () => {
    const { core, store } = makeFakeCore()
    const services = await makeAppServices({ core })
    render(MorphirApp, {
      props: { services, badge: 'WEB', version: '0.0.1', initialConfig: defaultUiConfig },
    })
    document
      .getElementById('right-toggle')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 350))
    expect(store.config.shell.rightVisible).toBe(false)
  })
})
