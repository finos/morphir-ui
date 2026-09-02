import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import config from '../electron.vite.config.ts'

test('bundles source-only workspace dependencies for the packaged main process', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { dependencies: Record<string, string> }
  const workspaceDependencies = Object.entries(manifest.dependencies)
    .filter(([, version]) => version.startsWith('workspace:'))
    .map(([name]) => name)
  expect(workspaceDependencies.length).toBeGreaterThan(0)
  const externalizeDeps = config.main?.build?.externalizeDeps
  expect(typeof externalizeDeps).toBe('object')
  if (typeof externalizeDeps !== 'object') throw new Error('Missing dependency bundling policy')
  for (const dependency of workspaceDependencies) {
    expect(externalizeDeps.exclude).toContain(dependency)
  }
})
