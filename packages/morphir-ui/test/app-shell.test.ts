import { cleanup, render, screen } from '@testing-library/svelte'
import { afterEach, describe, expect, test } from 'vitest'
import { userEvent } from '@testing-library/user-event'
import AppShell from '../src/shell/AppShell.svelte'
import ResizeHandle from '../src/shell/ResizeHandle.svelte'
import { ShellState, WorkbenchStore, defaultUiConfig, makeAppServices } from '../src/index.ts'
import { makeFakeCore } from './support/fake-services.ts'

// `@testing-library/svelte`'s auto-cleanup only self-registers when
// `beforeEach`/`afterEach` are *global* functions (i.e. Vitest `test.globals: true`).
// This project imports test primitives explicitly instead of using globals, so without
// this the DOM from every `renderShell()` call accumulates across tests in the same
// file — later `getByText`/`getElementById` lookups then see stale nodes from earlier
// tests (duplicate ids, duplicate text matches) rather than only the current render.
afterEach(() => {
  cleanup()
  document.body.classList.remove('resizing-col', 'resizing-row')
})

const preparePointerCapture = (separator: HTMLElement) => {
  let capturedPointer: number | null = null
  Object.defineProperties(separator, {
    setPointerCapture: {
      value: (pointerId: number) => (capturedPointer = pointerId),
    },
    hasPointerCapture: {
      value: (pointerId: number) => capturedPointer === pointerId,
    },
    releasePointerCapture: {
      value: () => (capturedPointer = null),
    },
  })
  const dispatch = (type: string): void => {
    separator.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: 100,
        pointerId: 7,
      }),
    )
  }
  return {
    dispatch,
    loseCapture: () => (capturedPointer = null),
  }
}

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

  test('names every panel resize separator', async () => {
    await renderShell()

    expect(screen.getByRole('separator', { name: 'Resize Workbench rail' })).toBeTruthy()
    expect(screen.getByRole('separator', { name: 'Resize Inspector' })).toBeTruthy()
    expect(screen.getByRole('separator', { name: 'Resize Log' })).toBeTruthy()
  })

  test('gives a standalone resize separator a default accessible name', () => {
    render(ResizeHandle, {
      props: { edge: 'left', currentSize: 280, onResize: () => {} },
    })

    expect(screen.getByRole('separator', { name: 'Resize panel' })).toBeTruthy()
  })

  test('cleans the body resize class on pointerup and pointercancel', () => {
    render(ResizeHandle, {
      props: { edge: 'left', currentSize: 280, onResize: () => {} },
    })
    const separator = screen.getByRole('separator', { name: 'Resize panel' })
    const pointer = preparePointerCapture(separator)

    pointer.dispatch('pointerdown')
    expect(document.body.classList.contains('resizing-col')).toBe(true)
    pointer.dispatch('pointerup')
    expect(document.body.classList.contains('resizing-col')).toBe(false)

    pointer.dispatch('pointerdown')
    pointer.dispatch('pointercancel')
    expect(document.body.classList.contains('resizing-col')).toBe(false)
  })

  test('cleans the body resize class when pointer capture is lost', () => {
    render(ResizeHandle, {
      props: { edge: 'left', currentSize: 280, onResize: () => {} },
    })
    const separator = screen.getByRole('separator', { name: 'Resize panel' })
    const pointer = preparePointerCapture(separator)

    pointer.dispatch('pointerdown')
    pointer.loseCapture()
    pointer.dispatch('lostpointercapture')

    expect(document.body.classList.contains('resizing-col')).toBe(false)
  })

  test('cleans the body resize class when unmounted during a drag', () => {
    const view = render(ResizeHandle, {
      props: { edge: 'left', currentSize: 280, onResize: () => {} },
    })
    const separator = screen.getByRole('separator', { name: 'Resize panel' })
    const pointer = preparePointerCapture(separator)
    pointer.dispatch('pointerdown')

    view.unmount()

    expect(document.body.classList.contains('resizing-col')).toBe(false)
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
