import { describe, expect, test } from 'vitest'
import { WorkspaceState } from '../src/index.ts'
import { makeAppServices } from '../src/index.ts'
import { makeFakeCore } from './support/fake-services.ts'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// `readFileSync(new URL(rel, import.meta.url))` is the idiom used elsewhere in this repo
// (see theme.test.ts), but here the test runs under vitest's happy-dom environment (needed
// by ir-explorer.test.ts and morphir-app.test.ts, which render Svelte components in this
// same suite). Vite's import-analysis plugin statically rewrites that literal `new URL(...,
// import.meta.url)` pattern into a browser dev-server asset URL (`http://localhost:.../@fs/...`)
// under a browser-like environment, which readFileSync then rejects as "not scheme file".
// Resolving the path manually via fileURLToPath avoids that rewrite.
const irFixture = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../morphir-ir/test/fixtures/simpleTypeTree-ir.json'),
  'utf8',
)

describe('WorkspaceState', () => {
  test('openPicked decodes IR, sets current, records recents and persists config', async () => {
    const { core, store } = makeFakeCore({ workspaceContent: irFixture })
    const ws = new WorkspaceState(await makeAppServices({ core }))
    await ws.openPicked()
    expect(ws.error).toBeNull()
    expect(ws.current!.ir.package.name).toBe('Morphir.Example.App')
    expect(ws.recents).toEqual(['/fake/morphir-ir.json'])
    expect(store.config.workspace.active).toBe('/fake/morphir-ir.json')
    expect(store.config.workspace.recent).toEqual(['/fake/morphir-ir.json'])
  })

  test('malformed IR yields a friendly error, not a crash', async () => {
    const { core } = makeFakeCore({ workspaceContent: '{"formatVersion":2,"distribution":[]}' })
    const ws = new WorkspaceState(await makeAppServices({ core }))
    await ws.openPicked()
    expect(ws.current).toBeNull()
    expect(ws.error).toContain('format version 2')
  })

  test('reopen is a no-op without the capability', async () => {
    const { core } = makeFakeCore({ workspaceContent: irFixture, reopen: false })
    const ws = new WorkspaceState(await makeAppServices({ core }))
    await ws.reopen('/anything')
    expect(ws.current).toBeNull()
  })
})
