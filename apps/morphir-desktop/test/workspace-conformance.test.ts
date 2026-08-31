import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import type { DevelopmentWorkbenchDescriptor } from '@morphir/ui/workbench'
import corpusJson from '@morphir/workspace-engine/corpus'
import {
  projectKey,
  sourceKey,
  type DiscoveryRequest,
  type DiscoveryResponse,
  type FileTree,
  type WorkspaceSnapshot,
} from '@morphir/workspace'
import {
  expectedCorpusSnapshot,
  normalizeWorkspaceSnapshot,
} from '../../../packages/morphir-workspace/test/support/workspace-conformance.ts'
import { inspectDevelopment } from '../src/main/workbench-source.ts'
import {
  buildNodeWorkspaceDiscoveryRequest,
  discoverNodeWorkspace,
  nodeGlobalConfigCandidates,
} from '../src/main/workspace/discovery.ts'
import { fileTreeFromNodeRoot } from '../src/main/workspace/node-file-tree.ts'
import { getWorkspaceDiscoveryEngine } from '../src/main/workspace/wasm-engine.ts'

interface CorpusCase {
  readonly name: string
  readonly request: DiscoveryRequest
  readonly expected: DiscoveryResponse
}

const corpus = [...(corpusJson as unknown as ReadonlyArray<CorpusCase>)]
const temporaryDirectories: Array<string> = []
const timestamp = '2026-08-30T12:00:00.000Z'
const vendoredWasm = new URL(
  '../../../packages/morphir-workspace-engine/generated/morphir_workspace_wasm_bg.wasm',
  import.meta.url,
)

const temporaryDirectory = async (name: string): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), `morphir-conformance-${name}-`))
  temporaryDirectories.push(directory)
  return directory
}

const materializeTree = async (root: string, tree: FileTree): Promise<void> => {
  const entries = Object.entries(tree.entries).sort(([left], [right]) => left.localeCompare(right))
  for (const [path, entry] of entries) {
    if (path === '.') continue
    const absolute = join(root, ...path.split('/'))
    if (entry.kind === 'directory') {
      await mkdir(absolute, { recursive: true })
    } else if (entry.kind === 'file') {
      await mkdir(dirname(absolute), { recursive: true })
      await writeFile(absolute, entry.text, 'utf8')
    } else {
      await mkdir(dirname(absolute), { recursive: true })
      await symlink(join(root, ...entry.target.split('/')), absolute)
    }
  }
}

const materializeMorphirHome = async (root: string, tree: FileTree | null | undefined) => {
  const files = Object.entries(tree?.entries ?? {}).filter(
    (entry): entry is [string, { readonly kind: 'file'; readonly text: string }] =>
      entry[1].kind === 'file',
  )
  if (files.length > 1) throw new Error('Corpus Morphir Home has more than one selected config')
  const [portablePath, entry] = files[0] ?? []
  if (portablePath === undefined || entry === undefined) return
  const name = portablePath.endsWith('.yaml') ? 'morphir.yaml' : 'morphir.toml'
  await writeFile(join(root, name), entry.text, 'utf8')
}

const descriptorFor = async (
  root: string,
  displayName: string,
): Promise<DevelopmentWorkbenchDescriptor> => {
  const canonical = await realpath(root)
  const source = { providerId: 'desktop-local', locator: canonical, displayName }
  return {
    id: sourceKey(source),
    source,
    name: displayName,
    kind: 'development',
    route: 'overview',
    openedAt: timestamp,
    lastUsedAt: timestamp,
  }
}

const discoverCorpusCase = async ({ name, request }: CorpusCase): Promise<WorkspaceSnapshot> => {
  const root = await temporaryDirectory(name)
  const morphirHome = await temporaryDirectory(`${name}-home`)
  await materializeTree(root, request.developmentRoot)
  await materializeMorphirHome(morphirHome, request.morphirHome)
  const descriptor = await descriptorFor(root, name)
  const engine = await getWorkspaceDiscoveryEngine(vendoredWasm)
  return inspectDevelopment(descriptor, async (developmentRoot) => {
    const nodeRequest = await buildNodeWorkspaceDiscoveryRequest(
      developmentRoot,
      { MORPHIR_HOME: morphirHome, ...request.environment },
      {
        globalConfigCandidates: [
          join(morphirHome, 'morphir.toml'),
          join(morphirHome, 'morphir.yaml'),
        ],
        systemConfigCandidates: [],
      },
    )
    return engine.discover({
      ...nodeRequest,
      systemConfig: request.systemConfig,
      environment: request.environment,
      cliOverlay: request.cliOverlay,
    })
  })
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('Electron workspace discovery conformance', () => {
  test.each(corpus)('$name', async (corpusCase) => {
    const { expected } = corpusCase
    if (expected.status === 'failure') {
      await expect(discoverCorpusCase(corpusCase)).rejects.toThrow(
        `${expected.error.code}: ${expected.error.message}`,
      )
      return
    }

    const snapshot = await discoverCorpusCase(corpusCase)
    expect(snapshot.projects.map((project) => project.id)).toEqual(
      expected.snapshot.projects.map((project) => projectKey(snapshot.root, project.relativePath)),
    )
    expect(normalizeWorkspaceSnapshot(snapshot)).toEqual(
      expectedCorpusSnapshot(expected.snapshot, corpusCase.name),
    )
  })

  test('relocated MORPHIR_HOME changes the effective Electron configuration', async () => {
    const root = await temporaryDirectory('relocated-root')
    const defaultHome = await temporaryDirectory('default-home')
    const relocatedHome = await temporaryDirectory('relocated-home')
    await writeFile(
      join(root, 'morphir.toml'),
      '[project]\nname = "home/root"\nversion = "1.0.0"\n',
    )
    await writeFile(join(relocatedHome, 'morphir.toml'), '[ir\nmode = "from-home"\n')
    const descriptor = await descriptorFor(root, 'relocated-root')
    const withoutHome = await inspectDevelopment(descriptor, (developmentRoot) =>
      discoverNodeWorkspace(
        developmentRoot,
        {},
        {
          engine: getWorkspaceDiscoveryEngine(vendoredWasm),
          globalConfigCandidates: [],
          systemConfigCandidates: [],
        },
      ),
    )
    const environment = { MORPHIR_HOME: relocatedHome }
    const candidates = nodeGlobalConfigCandidates(environment, process.platform, defaultHome)
    expect(candidates).toContain(join(relocatedHome, 'morphir.toml'))
    expect(withoutHome.projects[0]?.version).toBe('1.0.0')
    await expect(
      inspectDevelopment(descriptor, (developmentRoot) =>
        discoverNodeWorkspace(developmentRoot, environment, {
          engine: getWorkspaceDiscoveryEngine(vendoredWasm),
          globalConfigCandidates: candidates,
          systemConfigCandidates: [],
        }),
      ),
    ).rejects.toThrow('workspace.config.invalid')
  })

  test('excluded members stay out of the Electron snapshot', async () => {
    const root = await temporaryDirectory('excluded-members')
    await materializeTree(root, {
      entries: {
        '.': { kind: 'directory' },
        'morphir.toml': {
          kind: 'file',
          text: '[workspace]\nmembers = ["packages/*"]\nexclude = ["packages/private"]\n',
        },
        packages: { kind: 'directory' },
        'packages/public': { kind: 'directory' },
        'packages/public/morphir.toml': {
          kind: 'file',
          text: '[project]\nname = "visible/public"\n',
        },
        'packages/private': { kind: 'directory' },
        'packages/private/morphir.toml': {
          kind: 'file',
          text: '[project]\nname = "hidden/private"\n',
        },
      },
    })
    const descriptor = await descriptorFor(root, basename(root))
    const snapshot = await inspectDevelopment(descriptor, (developmentRoot) =>
      discoverNodeWorkspace(
        developmentRoot,
        {},
        {
          engine: getWorkspaceDiscoveryEngine(vendoredWasm),
          globalConfigCandidates: [],
          systemConfigCandidates: [],
        },
      ),
    )

    expect(snapshot.projects.map((project) => project.relativePath)).toEqual(['packages/public'])
  })

  test.skipIf(process.platform === 'win32')(
    'rejects a native symlink escape before invoking WASM discovery',
    async () => {
      const root = await temporaryDirectory('symlink-root')
      const outside = await temporaryDirectory('symlink-outside')
      await writeFile(join(root, 'morphir.toml'), '[workspace]\nmembers = ["escape"]\n')
      await writeFile(join(outside, 'morphir.toml'), '[project]\nname = "outside/secret"\n')
      await symlink(outside, join(root, 'escape'))
      let discoveries = 0

      await expect(
        discoverNodeWorkspace(
          root,
          {},
          {
            engine: Promise.resolve({
              discover: async (): Promise<DiscoveryResponse> => {
                discoveries += 1
                throw new Error('WASM must not receive an escaped tree')
              },
            }),
            globalConfigCandidates: [],
            systemConfigCandidates: [],
          },
        ),
      ).rejects.toMatchObject({ code: 'workspace.path.not-confined' })
      expect(discoveries).toBe(0)
      await expect(fileTreeFromNodeRoot(root)).rejects.toMatchObject({
        code: 'workspace.path.not-confined',
      })
    },
  )
})
