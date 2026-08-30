import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultUiConfig } from '@morphir/ui/config'
import { loadConfigFile, morphirHome, saveConfigFile, uiConfigPath } from '../src/main/config.ts'

let dirs: string[] = []
const tempHome = () => {
  const dir = mkdtempSync(join(tmpdir(), 'morphir-ui-test-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  dirs.forEach((d) => rmSync(d, { recursive: true, force: true }))
  dirs = []
})

describe('morphirHome', () => {
  test('respects MORPHIR_HOME and falls back to ~/.morphir', () => {
    expect(morphirHome({ MORPHIR_HOME: '/custom/home' })).toBe('/custom/home')
    expect(morphirHome({})).toContain('.morphir')
    expect(uiConfigPath({ MORPHIR_HOME: '/custom/home' })).toBe(
      join('/custom/home', 'ui', 'config.toml'),
    )
  })
})

describe('config file round-trip', () => {
  test('missing file yields defaults', async () => {
    expect(await loadConfigFile(join(tempHome(), 'ui', 'config.toml'))).toEqual(defaultUiConfig)
  })

  test('save then load round-trips', async () => {
    const path = join(tempHome(), 'ui', 'config.toml')
    const config = {
      ...defaultUiConfig,
      appearance: { colorScheme: 'light' as const, animations: false },
      workbenches: {
        open: [],
        recent: [],
        activeId: null,
        reopenOnLaunch: false,
      },
    }
    await saveConfigFile(config, path)
    expect(await loadConfigFile(path)).toEqual(config)
  })

  test('corrupt TOML yields defaults, not a crash', async () => {
    const home = tempHome()
    mkdirSync(join(home, 'ui'), { recursive: true })
    writeFileSync(join(home, 'ui', 'config.toml'), '= not toml =')
    expect(await loadConfigFile(join(home, 'ui', 'config.toml'))).toEqual(defaultUiConfig)
  })
})
