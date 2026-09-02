import { describe, expect, test } from 'vitest'
import { ShellState } from '../src/state/shell-state.svelte.ts'

describe('shell routing', () => {
  test('the playground is a route beside settings', () => {
    const shell = new ShellState()

    shell.openPlayground()

    expect(shell.route.kind).toBe('playground')
    expect(shell.isPlayground).toBe(true)
    expect(shell.isSettings).toBe(false)
  })

  test('leaving the playground returns to the workspace', () => {
    const shell = new ShellState()
    shell.openPlayground()

    shell.closeOverlay()

    expect(shell.route.kind).toBe('workspace')
    expect(shell.isPlayground).toBe(false)
  })

  test('settings and the playground are mutually exclusive', () => {
    const shell = new ShellState()

    shell.openSettings('about')
    expect(shell.isPlayground).toBe(false)
    expect(shell.isSettings).toBe(true)

    shell.openPlayground()
    expect(shell.isSettings).toBe(false)
    expect(shell.isPlayground).toBe(true)
  })

  // The playground holds unsaved in-memory documents; restoring into it on launch
  // would show an empty editor where the user left a filled one. `snapshot()` feeds
  // config persistence, so it must not carry the route at all.
  test('the playground route is not part of the persisted snapshot', () => {
    const shell = new ShellState()
    shell.openPlayground()

    expect(shell.snapshot()).not.toHaveProperty('route')

    const restored = new ShellState()
    restored.hydrate(shell.snapshot())
    expect(restored.route).toEqual({ kind: 'workspace' })
  })
})
