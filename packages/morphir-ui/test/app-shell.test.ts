import { cleanup, render, screen } from '@testing-library/svelte'
import { afterEach, describe, expect, test } from 'vitest'
import { userEvent } from '@testing-library/user-event'
import AppShell from '../src/shell/AppShell.svelte'
import { ShellState, WorkbenchStore, defaultUiConfig, makeAppServices } from '../src/index.ts'
import { makeFakeCore } from './support/fake-services.ts'

// `@testing-library/svelte`'s auto-cleanup only self-registers when
// `beforeEach`/`afterEach` are *global* functions (i.e. Vitest `test.globals: true`).
// This project imports test primitives explicitly instead of using globals, so without
// this the DOM from every `renderShell()` call accumulates across tests in the same
// file — later `getByText`/`getElementById` lookups then see stale nodes from earlier
// tests (duplicate ids, duplicate text matches) rather than only the current render.
afterEach(() => cleanup())

const renderShell = async (shell = new ShellState()) => {
  const { core } = makeFakeCore()
  const store = new WorkbenchStore(await makeAppServices({ core }), defaultUiConfig.workbenches)
  return render(AppShell, {
    props: {
      shell,
      badge: 'DESKTOP',
      version: '1.2.3',
      crumbTitle: 'Overview',
      store,
      onOpenSettings: () => {},
    },
  })
}

describe('AppShell chrome', () => {
  test('renders brand, badge and version chip', async () => {
    await renderShell()
    expect(screen.getByText('morphir')).toBeTruthy()
    expect(screen.getByText('DESKTOP')).toBeTruthy()
    expect(document.getElementById('app-version')!.textContent).toBe('v1.2.3')
  })

  test('renders the Workbench rail and opening controls', async () => {
    await renderShell()
    expect(screen.getByRole('navigation', { name: 'Workbenches' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open model file' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open folder' })).toBeTruthy()
  })

  test('root carries the scheme class and no-motion toggles', async () => {
    const shell = new ShellState()
    const { container } = await renderShell(shell)
    const root = container.querySelector('.shell')!
    expect(root.classList.contains('theme-dark')).toBe(true)
    shell.selectColorScheme('light')
    await Promise.resolve()
    expect(root.classList.contains('theme-light')).toBe(true)
    shell.toggleAnimations()
    await Promise.resolve()
    expect(root.classList.contains('no-motion')).toBe(true)
  })

  test('sidebar toggle collapses the left region to zero extent', async () => {
    const shell = new ShellState()
    const { container } = await renderShell(shell)
    await userEvent.click(document.getElementById('sidebar-toggle')!)
    expect(shell.leftVisible).toBe(false)
    const left = container.querySelector('[data-region="left"]') as HTMLElement
    expect(left.getAttribute('style')).not.toMatch(/width\s*:/) // no inline rules — custom property only
    expect(left.style.getPropertyValue('--region-extent')).toBe('0px')
  })

  test('settings route swaps panel toggles for Restore defaults and Settings crumb', async () => {
    const shell = new ShellState()
    shell.openSettings()
    await renderShell(shell)
    expect(document.getElementById('restore-defaults')).toBeTruthy()
    expect(screen.getByText('Restore defaults')).toBeTruthy()
    expect(screen.getByText(/^Settings \//)).toBeTruthy()
    expect(document.getElementById('right-toggle')).toBeNull()
  })
})
