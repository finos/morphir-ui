import { cleanup, render, screen } from '@testing-library/svelte'
import { afterEach, describe, expect, test } from 'vitest'
import { userEvent } from '@testing-library/user-event'
import AppShell from '../src/shell/AppShell.svelte'
import { ShellState } from '../src/index.ts'

// `@testing-library/svelte`'s auto-cleanup only self-registers when
// `beforeEach`/`afterEach` are *global* functions (i.e. Vitest `test.globals: true`).
// This project imports test primitives explicitly instead of using globals, so without
// this the DOM from every `renderShell()` call accumulates across tests in the same
// file — later `getByText`/`getElementById` lookups then see stale nodes from earlier
// tests (duplicate ids, duplicate text matches) rather than only the current render.
afterEach(() => cleanup())

const renderShell = (shell = new ShellState()) =>
  render(AppShell, {
    props: {
      shell,
      badge: 'DESKTOP',
      version: '1.2.3',
      crumbTitle: 'Overview',
      navItems: [
        { id: 'overview', label: 'Overview' },
        { id: 'explorer', label: 'IR Explorer' },
      ],
      activeNav: 'overview',
      onNavSelect: () => {},
      onOpenSettings: () => {},
    },
  })

describe('AppShell chrome', () => {
  test('renders brand, badge and version chip', () => {
    renderShell()
    expect(screen.getByText('morphir')).toBeTruthy()
    expect(screen.getByText('DESKTOP')).toBeTruthy()
    expect(document.getElementById('app-version')!.textContent).toBe('v1.2.3')
  })

  test('renders nav items with active state and dots', () => {
    renderShell()
    // Both the titlebar crumb ("morphir / Overview") and the active nav item render an
    // "Overview" text node as their own direct child, so a plain getByText('Overview') is
    // ambiguous — scope the query to the nav item explicitly.
    const active = screen.getByText('Overview', { selector: '.nav-item' }).closest('.nav-item')!
    expect(active.classList.contains('active')).toBe(true)
    expect(active.querySelector('.nav-dot')).toBeTruthy()
    expect(screen.getByText('Workspace')).toBeTruthy()
  })

  test('root carries the scheme class and no-motion toggles', async () => {
    const shell = new ShellState()
    const { container } = renderShell(shell)
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
    const { container } = renderShell(shell)
    await userEvent.click(document.getElementById('sidebar-toggle')!)
    expect(shell.leftVisible).toBe(false)
    const left = container.querySelector('[data-region="left"]') as HTMLElement
    expect(left.getAttribute('style')).not.toMatch(/width\s*:/) // no inline rules — custom property only
    expect(left.style.getPropertyValue('--region-extent')).toBe('0px')
  })

  test('settings route swaps panel toggles for Restore defaults and Settings crumb', async () => {
    const shell = new ShellState()
    shell.openSettings()
    renderShell(shell)
    expect(document.getElementById('restore-defaults')).toBeTruthy()
    expect(screen.getByText('Restore defaults')).toBeTruthy()
    expect(screen.getByText(/^Settings \//)).toBeTruthy()
    expect(document.getElementById('right-toggle')).toBeNull()
  })
})
