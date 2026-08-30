import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { parse, stringify } from 'smol-toml'
import { decodeUiConfig, defaultUiConfig, type UiConfig } from '@morphir/ui/config'

export const morphirHome = (env: Record<string, string | undefined> = process.env): string =>
  env['MORPHIR_HOME'] && env['MORPHIR_HOME'].length > 0
    ? env['MORPHIR_HOME']
    : join(homedir(), '.morphir')

export const uiConfigPath = (env?: Record<string, string | undefined>): string =>
  join(morphirHome(env), 'ui', 'config.toml')

export async function loadConfigFile(path: string = uiConfigPath()): Promise<UiConfig> {
  try {
    return decodeUiConfig(parse(await readFile(path, 'utf8')), { legacyProviderId: 'desktop-local' })
  } catch {
    return defaultUiConfig
  }
}

export async function saveConfigFile(
  config: UiConfig,
  path: string = uiConfigPath(),
): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  await writeFile(tmp, stringify(config), 'utf8')
  await rename(tmp, path)
}
