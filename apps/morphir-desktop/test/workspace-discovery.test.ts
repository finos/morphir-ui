import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WorkspaceDiscoveryEngine } from '@morphir/workspace-engine'
import {
  buildNodeWorkspaceDiscoveryRequest,
  discoverNodeWorkspace,
  nodeGlobalConfigCandidates,
  nodeSystemConfigCandidates,
} from '../src/main/workspace/discovery.ts'
import {
  getWorkspaceDiscoveryEngine,
  makeCachedWorkspaceDiscoveryEngine,
} from '../src/main/workspace/wasm-engine.ts'

const temporaryDirectories: Array<string> = []

const temporaryDirectory = async (name: string): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), `morphir-${name}-`))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
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

  test('retries the cached main-process engine after asset loading fails', async () => {
    const source = new URL(
      '../../../packages/morphir-workspace-engine/generated/morphir_workspace_wasm_bg.wasm',
      import.meta.url,
    )
    const cached = makeCachedWorkspaceDiscoveryEngine()

    await expect(cached(new URL('./missing-workspace.wasm', import.meta.url))).rejects.toThrow()
    expect(await cached(source)).toBeDefined()
  })

  test('mounts only one selected global config and rejects ambiguous candidates', async () => {
    const root = await temporaryDirectory('candidate-workspace')
    const home = await temporaryDirectory('candidate-home')
    await writeFile(join(root, 'morphir.toml'), '[project]\nname = "workspace"\n')
    await writeFile(join(home, 'morphir.toml'), '[project]\nversion = "1"\n')
    await writeFile(join(home, 'cache.bin'), 'must-not-be-mounted')

    const selected = await buildNodeWorkspaceDiscoveryRequest(
      root,
      { MORPHIR_HOME: home },
      { systemConfigRoot: null },
    )
    expect(selected.morphirHome).toEqual({
      entries: {
        '.': { kind: 'directory' },
        'morphir.toml': { kind: 'file', text: '[project]\nversion = "1"\n' },
      },
    })

    await writeFile(join(home, 'morphir.yaml'), 'project:\n  version: 2\n')
    await expect(
      buildNodeWorkspaceDiscoveryRequest(root, { MORPHIR_HOME: home }, { systemConfigRoot: null }),
    ).rejects.toMatchObject({ code: 'workspace.config.ambiguous' })
  })

  test('matches platform, relocated-home, and system candidate principles', () => {
    expect(
      nodeGlobalConfigCandidates(
        { XDG_CONFIG_HOME: '/srv/config', MORPHIR_HOME: '/srv/morphir-home' },
        'linux',
        '/home/alice',
      ),
    ).toEqual(['/srv/morphir-home/morphir.toml', '/srv/morphir-home/morphir.yaml'])
    expect(
      nodeGlobalConfigCandidates(
        { XDG_CONFIG_HOME: '/srv/config', MORPHIR_HOME: '' },
        'linux',
        '/home/alice',
      ),
    ).toEqual([
      '/srv/config/morphir/morphir.toml',
      '/srv/config/morphir/morphir.yaml',
      '/home/alice/.morphir/morphir.toml',
      '/home/alice/.morphir/morphir.yaml',
    ])
    expect(nodeGlobalConfigCandidates({}, 'darwin', '/Users/Alice')[0]).toBe(
      '/Users/Alice/Library/Application Support/morphir/morphir.toml',
    )
    expect(
      nodeGlobalConfigCandidates(
        { APPDATA: String.raw`D:\Profiles\Alice\Roaming` },
        'win32',
        String.raw`D:\Profiles\Alice`,
      )[0],
    ).toBe(String.raw`D:\Profiles\Alice\Roaming\morphir\morphir.toml`)
    expect(nodeSystemConfigCandidates({}, 'linux')).toEqual([
      '/etc/morphir/morphir.toml',
      '/etc/morphir/morphir.yaml',
    ])
    expect(
      nodeSystemConfigCandidates({ PROGRAMDATA: String.raw`D:\ProgramData` }, 'win32')[1],
    ).toBe(String.raw`D:\ProgramData\morphir\morphir.yaml`)
  })

  test('rejects unreadable selected config and follows candidate symlinks', async () => {
    const root = await temporaryDirectory('candidate-errors-root')
    const home = await temporaryDirectory('candidate-errors-home')
    const outside = await temporaryDirectory('candidate-errors-outside')
    await writeFile(join(root, 'morphir.toml'), '[project]\nname = "workspace"\n')
    await writeFile(join(home, 'morphir.toml'), new Uint8Array([0xff]))

    await expect(
      buildNodeWorkspaceDiscoveryRequest(
        root,
        {},
        {
          globalConfigCandidates: [join(home, 'morphir.toml')],
          systemConfigRoot: null,
        },
      ),
    ).rejects.toMatchObject({ code: 'workspace.traversal.unreadable' })

    if (process.platform !== 'win32') {
      await writeFile(join(outside, 'morphir.toml'), 'outside')
      await rm(join(home, 'morphir.toml'))
      await symlink(join(outside, 'morphir.toml'), join(home, 'morphir.toml'))
      const request = await buildNodeWorkspaceDiscoveryRequest(
        root,
        {},
        {
          globalConfigCandidates: [join(home, 'morphir.toml')],
          systemConfigRoot: null,
        },
      )
      expect(request.morphirHome?.entries['morphir.toml']).toEqual({
        kind: 'file',
        text: 'outside',
      })
      await symlink(join(outside, 'morphir.toml'), join(home, 'morphir.yaml'))
      await expect(
        buildNodeWorkspaceDiscoveryRequest(
          root,
          {},
          {
            globalConfigCandidates: [join(home, 'morphir.toml'), join(home, 'morphir.yaml')],
            systemConfigRoot: null,
          },
        ),
      ).rejects.toMatchObject({ code: 'workspace.config.ambiguous' })
    }
  })

  test('shares one payload budget across development, global, and system mounts', async () => {
    const root = await temporaryDirectory('combined-budget-root')
    const home = await temporaryDirectory('combined-budget-home')
    const system = await temporaryDirectory('combined-budget-system')
    await writeFile(join(root, 'morphir.toml'), 'abc')
    await writeFile(join(home, 'morphir.toml'), 'def')
    await writeFile(join(system, 'morphir.toml'), 'ghi')

    await expect(
      buildNodeWorkspaceDiscoveryRequest(
        root,
        { MORPHIR_HOME: home },
        {
          systemConfigRoot: system,
          configBytes: 8,
        },
      ),
    ).rejects.toMatchObject({ code: 'workspace.traversal.resource-limit' })
    expect(
      await buildNodeWorkspaceDiscoveryRequest(
        root,
        { MORPHIR_HOME: home },
        {
          systemConfigRoot: system,
          configBytes: 9,
        },
      ),
    ).toBeDefined()
  })
})
