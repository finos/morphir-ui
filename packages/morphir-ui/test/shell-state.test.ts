import { describe, expect, test } from 'vitest'
import { PANEL_BOUNDS, SHELL_DEFAULTS, ShellState } from '../src/index.ts'

describe('ShellState', () => {
  test('defaults match morphir-scala ShellDefaults', () => {
    const s = new ShellState()
    expect([s.leftWidth, s.rightWidth, s.bottomHeight]).toEqual([224, 300, 180])
    expect(s.colorScheme).toBe('dark')
    expect(s.animations).toBe(true)
    expect(s.route).toEqual({ kind: 'workspace' })
    expect(s.schemeClass).toBe('theme-dark')
  })

  test('collapsed regions report zero extent and toggle back', () => {
    const s = new ShellState()
    s.toggleLeft()
    expect(s.leftExtent).toBe(0)
    s.toggleLeft()
    expect(s.leftExtent).toBe(224)
  })

  test('resize clamps to PanelBounds', () => {
    const s = new ShellState()
    s.resizeLeft(10)
    expect(s.leftWidth).toBe(PANEL_BOUNDS.left.min)
    s.resizeLeft(9999)
    expect(s.leftWidth).toBe(PANEL_BOUNDS.left.max)
    s.resizeBottom(300)
    expect(s.bottomHeight).toBe(300)
  })

  test('settings routing', () => {
    const s = new ShellState()
    s.openSettings()
    expect(s.route).toEqual({ kind: 'settings', section: 'general' })
    s.selectSettingsSection('github')
    expect(s.route).toEqual({ kind: 'settings', section: 'github' })
    s.closeSettings()
    expect(s.isSettings).toBe(false)
  })

  test('restoreDefaults resets layout, motion and scheme but not route', () => {
    const s = new ShellState()
    s.toggleRight()
    s.resizeLeft(400)
    s.selectColorScheme('light')
    s.toggleAnimations()
    s.openSettings('appearance')
    s.restoreDefaults()
    expect(s.rightVisible).toBe(true)
    expect(s.leftWidth).toBe(SHELL_DEFAULTS.leftWidth)
    expect(s.colorScheme).toBe(SHELL_DEFAULTS.colorScheme)
    expect(s.animations).toBe(true)
    expect(s.isSettings).toBe(true)
  })

  test('snapshot/hydrate round-trips and clamps', () => {
    const s = new ShellState()
    s.resizeRight(400)
    s.selectColorScheme('system')
    s.toggleBottom()
    const snap = s.snapshot()
    const t = new ShellState()
    t.hydrate(snap)
    expect(t.rightWidth).toBe(400)
    expect(t.colorScheme).toBe('system')
    expect(t.bottomVisible).toBe(false)
    t.hydrate({ ...snap, shell: { ...snap.shell, leftWidth: 5 } })
    expect(t.leftWidth).toBe(PANEL_BOUNDS.left.min)
  })
})
