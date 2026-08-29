// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const css = (name: string) => readFileSync(new URL(`../src/theme/${name}`, import.meta.url), 'utf8')
const tokens = css('tokens.css')

/** Verbatim palette pairs from morphir-scala Tokens.scala: [name, light, dark]. */
const PALETTE: ReadonlyArray<readonly [string, string, string]> = [
  ['bg', '#f6f4fa', '#0f0d14'],
  ['surface', '#ffffff', '#16131d'],
  ['panel', '#ffffff', '#1a1622'],
  ['panel-edge', '#e4dff0', '#2a2438'],
  ['rail', '#f0edf7', '#121017'],
  ['edge', '#e0daee', '#241f30'],
  ['row-edge', '#ebe6f4', '#221d2e'],
  ['head-edge', '#e4dff0', '#1d1828'],
  ['hover', '#eae5f5', '#1f1a29'],
  ['hover-soft', '#f0ecf8', '#1a1622'],
  ['code-bg', '#f4f1fa', '#131019'],
  ['text', '#1c1726', '#e8e4f1'],
  ['text-strong', '#0f0d14', '#ffffff'],
  ['muted', '#6c6484', '#8d849e'],
  ['muted2', '#847c9c', '#6f6785'],
  ['nav', '#4a4360', '#a89fbe'],
  ['dot', '#c9c1de', '#3d3550'],
  ['accent', '#c02e8c', '#d6409f'],
  ['accent2', '#7c4ddb', '#8b5cf6'],
  ['accent-text', '#9c2f77', '#f2b7dd'],
]

describe('theme stylesheets', () => {
  test('every palette token is defined exactly once as light-dark(light, dark)', () => {
    for (const [name, light, dark] of PALETTE) {
      const definitions = tokens.match(new RegExp(`--${name}:`, 'g')) ?? []
      expect(definitions, `--${name} defined once`).toHaveLength(1)
      expect(tokens).toContain(`--${name}: light-dark(${light}, ${dark});`)
    }
  })

  test('scheme classes only flip color-scheme', () => {
    expect(tokens).toMatch(/\.theme-dark\s*{\s*color-scheme:\s*dark;\s*}/)
    expect(tokens).toMatch(/\.theme-light\s*{\s*color-scheme:\s*light;\s*}/)
    expect(tokens).toMatch(/\.theme-system\s*{\s*color-scheme:\s*light dark;\s*}/)
    expect(tokens).toMatch(/:root\s*\{\s*color-scheme:\s*dark/)
  })

  test('non-color constants match morphir-scala', () => {
    expect(tokens).toContain('--knob: #ffffff;')
    expect(tokens).toContain("--mono: ui-monospace, 'SF Mono', Menlo, monospace;")
    expect(tokens).toContain('--slide-ms: 320ms;')
    expect(tokens).toContain('--traffic-light-inset: 78px;')
  })

  test('global css holds only true globals', () => {
    const global = css('global.css')
    expect(global).toContain('.no-motion *')
    expect(global).toContain('body.resizing-col')
    expect(global).toContain('body.resizing-row')
    expect(global).not.toContain('app-region')
    expect(global).not.toContain('.titlebar')
  })

  test('base css carries the reset and body typography', () => {
    const base = css('base.css')
    expect(base).toContain('box-sizing: border-box')
    expect(base).toContain('font-family: var(--sans)')
    expect(base).toContain('::selection')
  })

  test('the application root completes the viewport height chain', () => {
    const base = css('base.css')
    expect(base).toMatch(/html,\s*body,\s*#app\s*{\s*height:\s*100%;\s*}/)
  })

  test('index.css aggregates the three sheets', () => {
    const index = css('index.css')
    for (const name of ['tokens.css', 'base.css', 'global.css']) expect(index).toContain(name)
  })
})
