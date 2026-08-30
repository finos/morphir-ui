import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { makeAppServices } from '@morphir/ui'
import { makeWorkspaceDiscoveryEngine } from '@morphir/workspace-engine'
import corpusJson from '@morphir/workspace-engine/corpus'
import {
  projectKey,
  type DiscoveryRequest,
  type DiscoveryResponse,
  type FileTree,
  type WorkspaceDiagnostic,
  type WorkspaceSnapshot,
} from '@morphir/workspace'
import { browserCoreWith } from '../src/layers/browser-layers.ts'
import type {
  DirectoryEntryHandle,
  DirectoryPermissionHandle,
} from '../src/workspace/browser-directory.ts'

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

const portableDiagnostic = (
  diagnostic: WorkspaceDiagnostic,
  projectPaths: ReadonlyMap<string, string>,
) => ({
  severity: diagnostic.severity,
  code: diagnostic.code ?? '',
  message: diagnostic.message,
  path: diagnostic.path,
  projectPath:
    diagnostic.projectId === null ? null : (projectPaths.get(diagnostic.projectId) ?? null),
})

const portableSnapshot = (snapshot: WorkspaceSnapshot) => {
  const projectPaths = new Map(
    snapshot.projects.map((project) => [project.id, project.relativePath] as const),
  )
  return {
    protocolVersion: 1 as const,
    configAnchor: snapshot.configAnchor,
    name: snapshot.name,
    state: snapshot.state,
    projects: snapshot.projects.map((project) => ({
      name: project.name,
      version: project.version,
      relativePath: project.relativePath,
      configAnchor: project.configAnchor,
      sourceDirectory: project.sourceDirectory,
      state: project.state,
      diagnostics: project.diagnostics.map((diagnostic) =>
        portableDiagnostic(diagnostic, projectPaths),
      ),
    })),
    diagnostics: snapshot.diagnostics.map((diagnostic) =>
      portableDiagnostic(diagnostic, projectPaths),
    ),
  }
}

const wasmBytes = readFile(
  resolve(
    process.cwd(),
    '../../packages/morphir-workspace-engine/generated/morphir_workspace_wasm_bg.wasm',
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
        expected.error.code,
      )
      return
    }

    const loaded = await services.loadDevelopmentWorkbench(descriptor)
    expect(loaded.snapshot.id).toBe(JSON.stringify(['browser-local', source!.locator]))
    expect(loaded.snapshot.projects.map((project) => project.id)).toEqual(
      expected.snapshot.projects.map((project) => projectKey(source!, project.relativePath)),
    )
    expect(portableSnapshot(loaded.snapshot)).toEqual({
      ...expected.snapshot,
      name: expected.snapshot.name ?? source!.displayName,
    })
  })
})
