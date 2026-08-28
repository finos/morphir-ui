import { cleanup, render, screen } from '@testing-library/svelte'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import MorphirApp from '../src/shell/MorphirApp.svelte'
import { defaultUiConfig, makeAppServices } from '../src/index.ts'
import { makeFakeCore } from './support/fake-services.ts'

// See ir-explorer.test.ts: readFileSync(new URL(rel, import.meta.url)) breaks under Vite's
// import-analysis in this happy-dom environment. Resolve manually instead.
const insightFixture = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../morphir-ir/test/fixtures/insight-ir.json'),
  'utf8',
)

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

  // Step 3b: node selection flows from InsightNode, through InsightView's onSelect and
  // IrExplorerView's onInspect, into MorphirApp's own `inspected` state, and out to the
  // AppShell inspector snippet.
  test('clicking a reference node in the Insight view populates the shell inspector', async () => {
    const { core } = makeFakeCore({ workspaceContent: insightFixture })
    const services = await makeAppServices({ core })
    render(MorphirApp, {
      props: { services, badge: 'WEB', version: '0.0.1', initialConfig: defaultUiConfig },
    })

    expect(screen.getByText('Select a node to inspect')).toBeTruthy()

    await userEvent.click(screen.getByText('Open workspace…'))
    await userEvent.click(screen.getByText('IR Explorer'))
    await userEvent.click(screen.getByText('usesHelper'))

    const button = await screen.findByRole('button', { name: /helperFn/ })
    await userEvent.click(button)

    expect(screen.getByText('Morphir.Ui.Fixtures.Insight.helperFn')).toBeTruthy()
  })
})
