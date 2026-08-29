import { cleanup, render, screen } from '@testing-library/svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { userEvent } from '@testing-library/user-event'
import AppShell from '../src/shell/AppShell.svelte'
import ResizeHandle from '../src/shell/ResizeHandle.svelte'
import {
  PANEL_BOUNDS,
  ShellState,
  WorkbenchStore,
  defaultUiConfig,
  makeAppServices,
} from '../src/index.ts'
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

    for (const [name, bounds, now] of [
      ['Resize Workbench rail', PANEL_BOUNDS.left, 320],
      ['Resize Inspector', PANEL_BOUNDS.right, 300],
      ['Resize Log', PANEL_BOUNDS.bottom, 180],
    ] as const) {
      const separator = screen.getByRole('separator', { name })
      expect(separator.getAttribute('aria-valuemin')).toBe(String(bounds.min))
      expect(separator.getAttribute('aria-valuemax')).toBe(String(bounds.max))
      expect(separator.getAttribute('aria-valuenow')).toBe(String(now))
    }
  })

  test('gives a standalone resize separator a default accessible name', () => {
    render(ResizeHandle, {
      props: { edge: 'left', currentSize: 280, min: 220, max: 420, onResize: () => {} },
    })

    expect(screen.getByRole('separator', { name: 'Resize panel' })).toBeTruthy()
  })

  test('exposes a focusable bounded value and resizes from handled keyboard keys', () => {
    const onResize = vi.fn()
    render(ResizeHandle, {
      props: { edge: 'left', currentSize: 418, min: 220, max: 420, onResize },
    })
    const separator = screen.getByRole('separator', { name: 'Resize panel' })

    expect(separator.getAttribute('tabindex')).toBe('0')
    expect(separator.getAttribute('aria-valuemin')).toBe('220')
    expect(separator.getAttribute('aria-valuemax')).toBe('420')
    expect(separator.getAttribute('aria-valuenow')).toBe('418')
    separator.focus()
    expect(document.activeElement).toBe(separator)

    const handledKeys = ['ArrowLeft', 'ArrowRight', 'Home', 'End']
    const events = handledKeys.map((key) => {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
      separator.dispatchEvent(event)
      return event
    })

    expect(events.every((event) => event.defaultPrevented)).toBe(true)
    expect(onResize.mock.calls.map(([size]) => size)).toEqual([408, 420, 220, 420])

    for (const key of ['ArrowUp', 'ArrowDown', 'PageDown']) {
      const unhandled = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
      separator.dispatchEvent(unhandled)
      expect(unhandled.defaultPrevented).toBe(false)
    }
    expect(onResize).toHaveBeenCalledTimes(4)
  })

  test('moves a right-edge separator physically and ignores vertical arrows', () => {
    const onResize = vi.fn()
    render(ResizeHandle, {
      props: { edge: 'right', currentSize: 300, min: 220, max: 560, onResize },
    })
    const separator = screen.getByRole('separator', { name: 'Resize panel' })

    const left = new KeyboardEvent('keydown', {
      key: 'ArrowLeft',
      bubbles: true,
      cancelable: true,
    })
    const right = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
      cancelable: true,
    })
    separator.dispatchEvent(left)
    separator.dispatchEvent(right)

    expect(left.defaultPrevented).toBe(true)
    expect(right.defaultPrevented).toBe(true)
    expect(onResize.mock.calls.map(([size]) => size)).toEqual([310, 290])

    for (const key of ['ArrowUp', 'ArrowDown']) {
      const orthogonal = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
      separator.dispatchEvent(orthogonal)
      expect(orthogonal.defaultPrevented).toBe(false)
    }
    expect(onResize).toHaveBeenCalledTimes(2)
  })

  test('moves a bottom-edge separator physically and ignores horizontal arrows', () => {
    const onResize = vi.fn()
    render(ResizeHandle, {
      props: { edge: 'bottom', currentSize: 180, min: 120, max: 460, onResize },
    })
    const separator = screen.getByRole('separator', { name: 'Resize panel' })

    const up = new KeyboardEvent('keydown', {
      key: 'ArrowUp',
      bubbles: true,
      cancelable: true,
    })
    const down = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true,
    })
    separator.dispatchEvent(up)
    separator.dispatchEvent(down)

    expect(up.defaultPrevented).toBe(true)
    expect(down.defaultPrevented).toBe(true)
    expect(onResize.mock.calls.map(([size]) => size)).toEqual([190, 170])

    for (const key of ['ArrowLeft', 'ArrowRight']) {
      const orthogonal = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
      separator.dispatchEvent(orthogonal)
      expect(orthogonal.defaultPrevented).toBe(false)
    }
    expect(onResize).toHaveBeenCalledTimes(2)
  })

  test('cleans the body resize class on pointerup and pointercancel', () => {
    render(ResizeHandle, {
      props: { edge: 'left', currentSize: 280, min: 220, max: 420, onResize: () => {} },
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
      props: { edge: 'left', currentSize: 280, min: 220, max: 420, onResize: () => {} },
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
      props: { edge: 'left', currentSize: 280, min: 220, max: 420, onResize: () => {} },
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
