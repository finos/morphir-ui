import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test, vi } from 'vitest'
import { Effect } from 'effect'
import { DevelopmentWorkbenchService, makeAppServices } from '@morphir/ui'
import { makeWorkspaceDiscoveryEngine } from '@morphir/workspace-engine'
import corpusJson from '@morphir/workspace-engine/corpus'
import {
  projectKey,
  type DiscoveryRequest,
  type DiscoveryResponse,
  type FileTree,
} from '@morphir/workspace'
import {
  expectedCorpusSnapshot,
  normalizeWorkspaceSnapshot,
} from '../../../packages/morphir-workspace/test/support/workspace-conformance.ts'
import { browserCoreWith } from '../src/layers/browser-layers.ts'
import type {
  DirectoryEntryHandle,
  DirectoryPermissionHandle,
} from '../src/workspace/browser-directory.ts'
import { fileTreeFromDirectoryUpload } from '../src/workspace/browser-directory.ts'

interface CorpusCase {
  readonly name: string
  readonly request: DiscoveryRequest
  readonly expected: DiscoveryResponse
}

interface TreeDirectory {
  readonly directories: Map<string, TreeDirectory>
  readonly files: Map<string, string>
}

const corpus = corpusJson as unknown as ReadonlyArray<CorpusCase>

const treeDirectory = (): TreeDirectory => ({ directories: new Map(), files: new Map() })

const childDirectory = (parent: TreeDirectory, name: string): TreeDirectory => {
  const existing = parent.directories.get(name)
  if (existing) return existing
  const child = treeDirectory()
  parent.directories.set(name, child)
  return child
}

const addDirectory = (root: TreeDirectory, components: ReadonlyArray<string>): TreeDirectory =>
  components.reduce(childDirectory, root)

const directoryHandle = (name: string, directory: TreeDirectory): DirectoryPermissionHandle => ({
  kind: 'directory',
  name,
  queryPermission: vi.fn(async (): Promise<PermissionState> => 'granted'),
  requestPermission: vi.fn(async (): Promise<PermissionState> => 'granted'),
  entries: () =>
    (async function* () {
      const entries: Array<readonly [string, DirectoryEntryHandle]> = [
        ...[...directory.directories].map(
          ([childName, child]) => [childName, directoryHandle(childName, child)] as const,
        ),
        ...[...directory.files].map(
          ([childName, text]) =>
            [
              childName,
              {
                kind: 'file' as const,
                name: childName,
                getFile: async () => ({ text: async () => text }) as File,
              },
            ] as const,
        ),
      ].sort(([left], [right]) => left.localeCompare(right))
      for (const entry of entries) yield entry
    })(),
})

const handleFromTree = (name: string, tree: FileTree): DirectoryPermissionHandle => {
  const root = treeDirectory()
  for (const [path, entry] of Object.entries(tree.entries)) {
    if (path === '.') continue
    const components = path.split('/')
    const leaf = components.at(-1)!
    const parent = addDirectory(root, components.slice(0, -1))
    if (entry.kind === 'directory') childDirectory(parent, leaf)
    if (entry.kind === 'file') parent.files.set(leaf, entry.text)
  }
  return directoryHandle(name, root)
}

const emptyTree = (): FileTree => ({ entries: { '.': { kind: 'directory' } } })

const wasmBytes = readFile(
  join(
    dirname(fileURLToPath(import.meta.url)),
    '../../../packages/morphir-workspace-engine/generated/morphir_workspace_wasm_bg.wasm',
  ),
)

describe('browser workspace discovery conformance', () => {
  test.each(corpus)('$name', async ({ name, request, expected }) => {
    const handle = handleFromTree(name, request.developmentRoot)
    const handles = new Map<string, FileSystemDirectoryHandle>()
    const engine = await makeWorkspaceDiscoveryEngine(await wasmBytes)
    const services = await makeAppServices({
      core: browserCoreWith('1.0.0', {
        engine: {
          discover: (browserRequest) =>
            engine.discover({
              ...browserRequest,
              systemConfig: request.systemConfig,
              environment: request.environment,
              cliOverlay: request.cliOverlay,
            }),
        },
        handles: {
          has: async (key) => handles.has(key),
          put: async (key, selected) => {
            handles.set(key, selected)
          },
          get: async (key) => handles.get(key) ?? null,
          delete: async (key) => {
            handles.delete(key)
          },
        },
        home: {
          read: async () => request.morphirHome ?? emptyTree(),
          writeConfig: async () => undefined,
        },
        pickDirectory: async () => ({ kind: 'handle', handle }),
      }),
    })
    const source = await services.pickWorkbenchSource('folder')
    const descriptor = await services.inspectWorkbench(source!)
    if (descriptor.kind !== 'development') throw new Error('Expected Development Workbench')

    if (expected.status === 'failure') {
      await expect(services.loadDevelopmentWorkbench(descriptor)).rejects.toThrow(
        `${expected.error.code}: ${expected.error.message}`,
      )
      return
    }

    const loaded = await services.loadDevelopmentWorkbench(descriptor)
    expect(loaded.snapshot.id).toBe(JSON.stringify(['browser-local', source!.locator]))
    expect(loaded.snapshot.projects.map((project) => project.id)).toEqual(
      expected.snapshot.projects.map((project) => projectKey(source!, project.relativePath)),
    )
    expect(normalizeWorkspaceSnapshot(loaded.snapshot)).toEqual(
      expectedCorpusSnapshot(expected.snapshot, source!.displayName),
    )
  })

  test('Browser Morphir Home changes discovery for the same selected source', async () => {
    const handle = handleFromTree('home-workspace', {
      entries: {
        '.': { kind: 'directory' },
        'morphir.toml': {
          kind: 'file',
          text: '[project]\nname = "home/root"\nversion = "1.0.0"\n',
        },
      },
    })
    const handles = new Map<string, FileSystemDirectoryHandle>()
    let homeTree = emptyTree()
    const engine = await makeWorkspaceDiscoveryEngine(await wasmBytes)
    const core = browserCoreWith('1.0.0', {
      engine,
      handles: {
        has: async (key) => handles.has(key),
        put: async (key, selected) => {
          handles.set(key, selected)
        },
        get: async (key) => handles.get(key) ?? null,
        delete: async (key) => {
          handles.delete(key)
        },
      },
      home: {
        read: async () => homeTree,
        writeConfig: async () => undefined,
      },
      pickDirectory: async () => ({ kind: 'handle', handle }),
    })
    const services = await makeAppServices({ core })
    const source = await services.pickWorkbenchSource('folder')
    const descriptor = await services.inspectWorkbench(source!)
    if (descriptor.kind !== 'development') throw new Error('Expected Development Workbench')

    expect(
      (await services.loadDevelopmentWorkbench(descriptor)).snapshot.projects[0]?.version,
    ).toBe('1.0.0')
    homeTree = {
      entries: {
        '.': { kind: 'directory' },
        'morphir.toml': { kind: 'file', text: '[ir\nmode = "from-home"\n' },
      },
    }
    await expect(services.loadDevelopmentWorkbench(descriptor)).rejects.toThrow(
      'workspace.config.invalid',
    )
  })

  test('excluded browser members never enter the qualified snapshot', async () => {
    const handle = handleFromTree('excluded-members', {
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
    const handles = new Map<string, FileSystemDirectoryHandle>()
    const engine = await makeWorkspaceDiscoveryEngine(await wasmBytes)
    const services = await makeAppServices({
      core: browserCoreWith('1.0.0', {
        engine,
        handles: {
          has: async (key) => handles.has(key),
          put: async (key, selected) => {
            handles.set(key, selected)
          },
          get: async (key) => handles.get(key) ?? null,
          delete: async (key) => {
            handles.delete(key)
          },
        },
        home: { read: async () => emptyTree(), writeConfig: async () => undefined },
        pickDirectory: async () => ({ kind: 'handle', handle }),
      }),
    })
    const source = await services.pickWorkbenchSource('folder')
    const descriptor = await services.inspectWorkbench(source!)
    if (descriptor.kind !== 'development') throw new Error('Expected Development Workbench')

    expect(
      (await services.loadDevelopmentWorkbench(descriptor)).snapshot.projects.map(
        (project) => project.relativePath,
      ),
    ).toEqual(['packages/public'])
  })

  test('permission renewal retries the same browser source', async () => {
    let permission: PermissionState = 'denied'
    const handle: DirectoryPermissionHandle = {
      ...handleFromTree('renewable-workspace', {
        entries: {
          '.': { kind: 'directory' },
          'morphir.toml': { kind: 'file', text: '[project]\nname = "renewable/root"\n' },
        },
      }),
      queryPermission: vi.fn(async () => permission),
      requestPermission: vi.fn(async () => permission),
    }
    const handles = new Map<string, FileSystemDirectoryHandle>()
    const engine = await makeWorkspaceDiscoveryEngine(await wasmBytes)
    const pickDirectory = vi.fn(async () => ({ kind: 'handle' as const, handle }))
    const core = browserCoreWith('1.0.0', {
      engine,
      handles: {
        has: async (key) => handles.has(key),
        put: async (key, selected) => {
          handles.set(key, selected)
        },
        get: async (key) => handles.get(key) ?? null,
        delete: async (key) => {
          handles.delete(key)
        },
      },
      home: { read: async () => emptyTree(), writeConfig: async () => undefined },
      pickDirectory,
    })
    const services = await makeAppServices({ core })
    const source = await services.pickWorkbenchSource('folder')
    const descriptor = await services.inspectWorkbench(source!)
    if (descriptor.kind !== 'development') throw new Error('Expected Development Workbench')

    const failure = await Effect.runPromise(
      Effect.flip(
        Effect.flatMap(DevelopmentWorkbenchService, (service) => service.load(descriptor)).pipe(
          Effect.provide(core),
        ),
      ),
    )
    expect(failure).toMatchObject({
      code: 'permission-denied',
      source,
    })
    permission = 'granted'
    const retried = await services.loadDevelopmentWorkbench(descriptor)

    expect(retried.snapshot.id).toBe(JSON.stringify(['browser-local', source!.locator]))
    expect(retried.descriptor.source).toEqual(source)
    expect(pickDirectory).toHaveBeenCalledOnce()
    expect(handle.queryPermission).toHaveBeenCalledTimes(2)
  })

  test.each(['../outside/morphir.toml', String.raw`root\outside/morphir.toml`])(
    'rejects lexical traversal %s before WASM discovery',
    async (relativePath) => {
      const read = vi.fn(async () => '[project]\nname = "outside"')
      const engine = await makeWorkspaceDiscoveryEngine(await wasmBytes)
      const discover = vi.spyOn(engine, 'discover')

      await expect(
        fileTreeFromDirectoryUpload([{ relativePath, text: read }]).then((developmentRoot) =>
          engine.discover({
            protocolVersion: 1,
            developmentRoot,
            morphirHome: null,
            systemConfig: null,
            environment: {},
            cliOverlay: {},
          }),
        ),
      ).rejects.toMatchObject({ code: 'invalid-path' })
      expect(read).not.toHaveBeenCalled()
      expect(discover).not.toHaveBeenCalled()
    },
  )
})
