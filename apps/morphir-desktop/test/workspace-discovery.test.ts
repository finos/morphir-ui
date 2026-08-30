import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WorkspaceDiscoveryEngine } from '@morphir/workspace-engine'
import {
  buildNodeWorkspaceDiscoveryRequest,
  discoverNodeWorkspace,
} from '../src/main/workspace/discovery.ts'
import { getWorkspaceDiscoveryEngine } from '../src/main/workspace/wasm-engine.ts'

const temporaryDirectories: Array<string> = []

const temporaryDirectory = async (name: string): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), `morphir-${name}-`))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  )
})

describe('Electron workspace discovery host', () => {
  test('builds confined development, Morphir Home, system, and environment mounts', async () => {
    const root = await temporaryDirectory('workspace')
    const home = await temporaryDirectory('home')
    const system = await temporaryDirectory('system')
    await writeFile(join(root, 'morphir.toml'), '[project]\nname = "workspace"\n')
    await writeFile(join(home, 'morphir.yaml'), 'project:\n  version: 2.0.0\n')
    await writeFile(join(system, 'morphir.toml'), '[project]\nversion = "3.0.0"\n')

    const request = await buildNodeWorkspaceDiscoveryRequest(
      root,
      {
        MORPHIR_HOME: home,
        MORPHIR_PROJECT__VERSION: '4.0.0',
        PATH: '/must/not/pass',
      },
      { systemConfigRoot: system },
    )

    expect(request.developmentRoot.entries['morphir.toml']).toEqual({
      kind: 'file',
      text: '[project]\nname = "workspace"\n',
    })
    expect(request.morphirHome?.entries['morphir.yaml']).toEqual({
      kind: 'file',
      text: 'project:\n  version: 2.0.0\n',
    })
    expect(request.systemConfig?.entries['morphir.toml']).toEqual({
      kind: 'file',
      text: '[project]\nversion = "3.0.0"\n',
    })
    expect(request.environment).toEqual({
      MORPHIR_HOME: home,
      MORPHIR_PROJECT__VERSION: '4.0.0',
    })
    expect(request.cliOverlay).toEqual({})
  })

  test('uses the main-process engine and returns its validated portable response', async () => {
    const root = await temporaryDirectory('discover')
    await writeFile(join(root, 'morphir.toml'), '[project]\nname = "workspace"\n')
    const response = {
      status: 'failure' as const,
      error: { code: 'workspace.config.invalid', message: 'expected response', path: null },
    }
    const requests: Array<unknown> = []
    const engine: WorkspaceDiscoveryEngine = {
      discover: async (request) => {
        requests.push(request)
        return response
      },
    }

    expect(
      await discoverNodeWorkspace(
        root,
        {},
        {
          engine: Promise.resolve(engine),
          systemConfigRoot: null,
        },
      ),
    ).toEqual(response)
    expect(requests).toHaveLength(1)
  })

  test('instantiates and caches the actual WASM engine in the main-process host', async () => {
    const root = await temporaryDirectory('actual-wasm')
    await writeFile(join(root, 'morphir.toml'), '[project]\nname = "workspace"\n')
    const source = new URL(
      '../../../packages/morphir-workspace-engine/generated/morphir_workspace_wasm_bg.wasm',
      import.meta.url,
    )
    const first = getWorkspaceDiscoveryEngine(source)
    const second = getWorkspaceDiscoveryEngine(source)

    expect(second).toBe(first)
    expect(
      await discoverNodeWorkspace(
        root,
        {},
        {
          engine: first,
          systemConfigRoot: null,
        },
      ),
    ).toMatchObject({
      status: 'success',
      snapshot: {
        projects: [{ name: 'workspace', relativePath: '.' }],
      },
    })
  })

  test('treats missing optional configuration mounts as absent', async () => {
    const root = await temporaryDirectory('no-mounts')
    const missingHome = join(root, 'missing-home')
    await writeFile(join(root, 'morphir.toml'), '[project]\nname = "workspace"\n')

    const request = await buildNodeWorkspaceDiscoveryRequest(
      root,
      { MORPHIR_HOME: missingHome },
      { systemConfigRoot: null },
    )

    expect(request.morphirHome).toBeNull()
    expect(request.systemConfig).toBeNull()
  })
})
