import { Effect, Option, Stream } from 'effect'
import {
  WorkbenchError,
  makeWorkbenchProviderLayers,
  unsupportedProviderError,
  type DevelopmentWorkbenchDescriptor,
  type ModelWorkbenchData,
  type ModelWorkbenchDescriptor,
  type WorkbenchDescriptor,
  type WorkbenchProviderAdapter,
} from '@morphir/ui'
import type { WorkspaceDiscoveryEngine } from '@morphir/workspace-engine'
import { decodeMorphirIr, toWorkspaceIr } from '@morphir/ir'
import {
  projectKey,
  sourceKey,
  type PortableProjectSnapshot,
  type PortableWorkspaceDiagnostic,
  type PortableWorkspaceSnapshot,
  type ProjectSnapshot,
  type WorkbenchSourceRef,
  type WorkspaceDiagnostic,
  type WorkspaceSnapshot,
} from '@morphir/workspace'
import {
  BrowserDirectoryError,
  fileTreeFromDirectoryHandle,
  fileTreeFromDirectoryUpload,
  type DirectoryEntryHandle,
  type DirectoryPermissionHandle,
  type UploadedDirectoryFile,
} from './browser-directory.ts'
import type { BrowserMorphirHome } from './browser-home.ts'
import type { DirectoryHandleStore } from './handle-store.ts'

const PROVIDER_ID = 'browser-local'
const DIRECTORY_LOCATOR_ATTEMPTS = 32

export type PickedBrowserDirectory =
  | {
      readonly kind: 'handle'
      readonly handle: DirectoryPermissionHandle
    }
  | {
      readonly kind: 'upload'
      readonly name: string
      readonly files: ReadonlyArray<UploadedDirectoryFile>
    }

export interface BrowserWorkspaceDependencies {
  readonly engine: WorkspaceDiscoveryEngine
  readonly handles: DirectoryHandleStore
  readonly home: BrowserMorphirHome
  readonly pickDirectory: () => Promise<PickedBrowserDirectory | null>
}

export interface BrowserModelSourceProvider {
  readonly inspect: (
    source: WorkbenchSourceRef,
  ) => Effect.Effect<WorkbenchDescriptor, WorkbenchError>
  readonly pick: () => Effect.Effect<Option.Option<WorkbenchSourceRef>, WorkbenchError>
  readonly load: (
    descriptor: ModelWorkbenchDescriptor,
  ) => Effect.Effect<ModelWorkbenchData, WorkbenchError>
  readonly release: (source: WorkbenchSourceRef) => Effect.Effect<void>
}

interface UploadedTree {
  readonly name: string
  readonly tree: Awaited<ReturnType<typeof fileTreeFromDirectoryUpload>>
  readonly files: ReadonlyMap<string, UploadedDirectoryFile>
}

const sessionUploads = new Map<string, UploadedTree>()
const MAX_PROJECT_MODEL_BYTES = 64 * 1024 * 1024
let allocationTail: Promise<void> = Promise.resolve()

const serializeAllocation = <Value>(operation: () => Promise<Value>): Promise<Value> => {
  const result = allocationTail.then(operation, operation)
  allocationTail = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

const providerError = (source: WorkbenchSourceRef): WorkbenchError =>
  unsupportedProviderError(PROVIDER_ID, source)

const workbenchError = (
  source: WorkbenchSourceRef | string,
  cause: unknown,
  fallbackMessage: string,
): WorkbenchError => {
  if (cause instanceof WorkbenchError) return cause
  if (cause instanceof BrowserDirectoryError) {
    return new WorkbenchError({
      code: cause.code === 'permission-denied' ? 'permission-denied' : 'read-failed',
      source,
      message: cause.message,
    })
  }
  return new WorkbenchError({ code: 'read-failed', source, message: fallbackMessage })
}

const opaqueDirectoryLocator = (): string => {
  const values = new Uint32Array(4)
  globalThis.crypto.getRandomValues(values)
  return `directory:${[...values].map((value) => value.toString(16).padStart(8, '0')).join('')}`
}

const normalizedUploadFiles = (
  files: ReadonlyArray<UploadedDirectoryFile>,
): ReadonlyMap<string, UploadedDirectoryFile> => {
  const paths = files.map((file) => file.relativePath)
  const first = paths[0]?.split('/')[0]
  const root =
    first && paths.every((path) => path.includes('/') && path.startsWith(`${first}/`))
      ? first
      : null
  return new Map(
    files.map((file) => [
      root === null ? file.relativePath : file.relativePath.slice(root.length + 1),
      file,
    ]),
  )
}

const readHandleFile = async (
  root: DirectoryPermissionHandle,
  relativePath: string,
): Promise<string> => {
  const segments = relativePath.split('/')
  let directory = root
  for (const [index, segment] of segments.entries()) {
    if (!segment || segment === '.' || segment === '..') {
      throw new BrowserDirectoryError('invalid-path', `Invalid project model path ${relativePath}`)
    }
    let selected: DirectoryEntryHandle | undefined
    for await (const [name, entry] of directory.entries()) {
      if (name === segment) {
        selected = entry
        break
      }
    }
    if (!selected) {
      throw new WorkbenchError({
        code: 'not-found',
        source: relativePath,
        message: `Project model not found: ${relativePath}`,
      })
    }
    if (index < segments.length - 1) {
      if (selected.kind !== 'directory') {
        throw new WorkbenchError({
          code: 'not-found',
          source: relativePath,
          message: `Project model not found: ${relativePath}`,
        })
      }
      directory = selected as DirectoryPermissionHandle
      continue
    }
    if (selected.kind !== 'file') {
      throw new WorkbenchError({
        code: 'not-found',
        source: relativePath,
        message: `Project model not found: ${relativePath}`,
      })
    }
    const file = await selected.getFile()
    if (file.size > MAX_PROJECT_MODEL_BYTES) {
      throw new WorkbenchError({
        code: 'read-failed',
        source: relativePath,
        message: `Project model exceeds ${MAX_PROJECT_MODEL_BYTES} bytes: ${relativePath}`,
      })
    }
    const text = await file.text()
    if (new TextEncoder().encode(text).byteLength > MAX_PROJECT_MODEL_BYTES) {
      throw new WorkbenchError({
        code: 'read-failed',
        source: relativePath,
        message: `Project model exceeds ${MAX_PROJECT_MODEL_BYTES} bytes: ${relativePath}`,
      })
    }
    return text
  }
  throw new WorkbenchError({
    code: 'not-found',
    source: relativePath,
    message: `Project model not found: ${relativePath}`,
  })
}

const directoryUpload = (): Promise<PickedBrowserDirectory | null> =>
  new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.setAttribute('webkitdirectory', '')
    input.onchange = () => {
      const selected = [...(input.files ?? [])]
      if (selected.length === 0) return resolve(null)
      const firstPath = selected[0]?.webkitRelativePath || selected[0]?.name || ''
      const name = firstPath.split('/')[0] || 'Uploaded workspace'
      resolve({
        kind: 'upload',
        name,
        files: selected.map((file) => ({
          relativePath: file.webkitRelativePath || file.name,
          size: file.size,
          text: () => file.text(),
        })),
      })
    }
    input.oncancel = () => resolve(null)
    try {
      input.click()
    } catch (cause) {
      reject(cause)
    }
  })

export const pickBrowserDirectory = async (): Promise<PickedBrowserDirectory | null> => {
  const picker = Reflect.get(globalThis, 'showDirectoryPicker')
  if (typeof picker === 'function') {
    try {
      const handle = (await Reflect.apply(picker, globalThis, [
        { mode: 'read' },
      ])) as DirectoryPermissionHandle
      return { kind: 'handle', handle }
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return null
      throw cause
    }
  }
  return directoryUpload()
}

const qualifyDiagnostic = (
  root: WorkbenchSourceRef,
  diagnostic: PortableWorkspaceDiagnostic,
): WorkspaceDiagnostic => ({
  severity: diagnostic.severity,
  code: diagnostic.code,
  message: diagnostic.message,
  path: diagnostic.path,
  projectId: diagnostic.projectPath === null ? null : projectKey(root, diagnostic.projectPath),
})

const qualifyProject = (
  root: WorkbenchSourceRef,
  project: PortableProjectSnapshot,
): ProjectSnapshot => ({
  id: projectKey(root, project.relativePath),
  name: project.name,
  version: project.version,
  relativePath: project.relativePath,
  configAnchor: project.configAnchor,
  sourceDirectory: project.sourceDirectory,
  state: project.state,
  modelSources: [],
  knowledgeBaseSources: [],
  diagnostics: project.diagnostics.map((diagnostic) => qualifyDiagnostic(root, diagnostic)),
})

export const qualifyWorkspace = (
  root: WorkbenchSourceRef,
  snapshot: PortableWorkspaceSnapshot,
): WorkspaceSnapshot => ({
  id: sourceKey(root),
  root,
  name: snapshot.name ?? root.displayName,
  configAnchor: snapshot.configAnchor,
  state: snapshot.state,
  projects: snapshot.projects.map((project) => qualifyProject(root, project)),
  modelSources: [],
  knowledgeBaseSources: [],
  diagnostics: snapshot.diagnostics.map((diagnostic) => qualifyDiagnostic(root, diagnostic)),
})

export const makeBrowserWorkbenchAdapter = (
  dependencies: BrowserWorkspaceDependencies,
  models: BrowserModelSourceProvider,
): WorkbenchProviderAdapter => {
  const findDirectory = async (
    source: WorkbenchSourceRef,
    ensurePermission = true,
  ): Promise<UploadedTree['tree']> => {
    const uploaded = sessionUploads.get(source.locator)
    if (uploaded) return uploaded.tree
    const handle = await dependencies.handles.get(source.locator)
    if (handle === null) {
      throw new WorkbenchError({
        code: 'not-found',
        source,
        message: `Workbench source not found in this browser: ${source.locator}`,
      })
    }
    return fileTreeFromDirectoryHandle(handle as unknown as DirectoryPermissionHandle, {
      ensurePermission,
    })
  }

  const inspectDirectory = (source: WorkbenchSourceRef) =>
    Effect.tryPromise({
      try: async () => {
        const tree = await findDirectory(source, false)
        const uploaded = sessionUploads.get(source.locator)
        const timestamp = new Date().toISOString()
        const base = {
          id: sourceKey(source),
          source,
          name: uploaded?.name ?? source.displayName,
          openedAt: timestamp,
          lastUsedAt: timestamp,
        }
        const hasPrimaryConfiguration = [
          'morphir.toml',
          'morphir.yaml',
          'morphir.json',
          '.morphir/morphir.toml',
          '.morphir/morphir.yaml',
          '.config/morphir/config.toml',
          '.config/morphir/config.yaml',
        ].some((path) => tree.entries[path]?.kind === 'file')
        const manifestPath =
          source.displayName === '.morphir-dist' && tree.entries['manifest.json']?.kind === 'file'
            ? 'manifest.json'
            : tree.entries['.morphir-dist/manifest.json']?.kind === 'file'
              ? '.morphir-dist/manifest.json'
              : null
        return !hasPrimaryConfiguration && manifestPath !== null
          ? {
              ...base,
              kind: 'model' as const,
              distribution: 'document-tree' as const,
              route: 'overview' as const,
            }
          : { ...base, kind: 'development' as const, route: 'overview' as const }
      },
      catch: (cause) =>
        workbenchError(source, cause, `Unable to inspect browser directory ${source.displayName}`),
    })

  const pickDirectory = () =>
    Effect.tryPromise({
      try: async () => {
        const picked = await dependencies.pickDirectory()
        if (picked === null) return Option.none<WorkbenchSourceRef>()
        const uploadedTree =
          picked.kind === 'upload' ? await fileTreeFromDirectoryUpload(picked.files) : null
        const locator = await serializeAllocation(async () => {
          let allocated: string | null = null
          for (let attempt = 0; attempt < DIRECTORY_LOCATOR_ATTEMPTS; attempt += 1) {
            const candidate = opaqueDirectoryLocator()
            if (sessionUploads.has(candidate)) continue
            if (await dependencies.handles.has(candidate)) continue
            allocated = candidate
            break
          }
          if (allocated === null) {
            throw new WorkbenchError({
              code: 'read-failed',
              source: '<browser-folder>',
              message: `Unable to allocate a unique browser directory source after ${DIRECTORY_LOCATOR_ATTEMPTS} attempts`,
            })
          }
          if (picked.kind === 'handle') {
            await dependencies.handles.put(
              allocated,
              picked.handle as unknown as FileSystemDirectoryHandle,
            )
          } else {
            sessionUploads.set(allocated, {
              name: picked.name,
              tree: uploadedTree!,
              files: normalizedUploadFiles(picked.files),
            })
          }
          return allocated
        })
        return Option.some({
          providerId: PROVIDER_ID,
          locator,
          displayName: picked.kind === 'handle' ? picked.handle.name : picked.name,
          ...(picked.kind === 'upload' ? { persistence: 'session' as const } : {}),
        })
      },
      catch: (cause) =>
        workbenchError('<browser-folder>', cause, 'Unable to select a browser directory'),
    })

  return {
    provider: {
      id: PROVIDER_ID,
      name: 'This browser',
      kind: 'local',
      status: 'available',
      capabilities: [
        { name: 'morphir/model/open', version: '1' },
        { name: 'morphir/development/inspect', version: '1' },
        { name: 'morphir/workspace/open', version: '1' },
        { name: 'morphir/project-model/open', version: '1' },
      ],
    },
    inspect: (source) => {
      if (source.providerId !== PROVIDER_ID) return Effect.fail(providerError(source))
      return source.locator.startsWith('directory:')
        ? inspectDirectory(source)
        : models.inspect(source)
    },
    pick: (kind) => (kind === 'folder' ? pickDirectory() : models.pick()),
    release: (source) =>
      source.providerId !== PROVIDER_ID
        ? Effect.void
        : source.locator.startsWith('directory:')
          ? source.persistence === 'session'
            ? Effect.sync(() => void sessionUploads.delete(source.locator))
            : Effect.tryPromise(() => dependencies.handles.delete(source.locator)).pipe(
                Effect.catchAll(() => Effect.void),
              )
          : models.release(source),
    reveal: (source) =>
      Effect.fail(
        new WorkbenchError({
          code: 'unsupported-capability',
          source,
          message:
            source.providerId === PROVIDER_ID
              ? 'Reveal in file manager is not available in the browser'
              : `Workbench source belongs to provider ${source.providerId}`,
        }),
      ),
    loadModel: (descriptor: ModelWorkbenchDescriptor) => {
      if (descriptor.source.providerId !== PROVIDER_ID) {
        return Effect.fail(providerError(descriptor.source))
      }
      if (!descriptor.source.locator.startsWith('directory:')) return models.load(descriptor)
      return Effect.tryPromise({
        try: async () => {
          const tree = await findDirectory(descriptor.source)
          const entry =
            descriptor.source.displayName === '.morphir-dist' &&
            tree.entries['manifest.json']?.kind === 'file'
              ? tree.entries['manifest.json']
              : tree.entries['.morphir-dist/manifest.json']
          if (entry?.kind !== 'file') {
            throw new WorkbenchError({
              code: 'not-found',
              source: descriptor.source,
              message: `Document Tree manifest not found: ${descriptor.source.displayName}`,
            })
          }
          let manifest: unknown
          try {
            manifest = JSON.parse(entry.text)
          } catch {
            throw new WorkbenchError({
              code: 'invalid-distribution',
              source: descriptor.source,
              message: `Invalid Document Tree manifest: ${descriptor.source.displayName}`,
            })
          }
          if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
            throw new WorkbenchError({
              code: 'invalid-distribution',
              source: descriptor.source,
              message: `Invalid Document Tree manifest: ${descriptor.source.displayName}`,
            })
          }
          return {
            kind: 'model' as const,
            descriptor,
            library: null,
            ir: null,
            manifest: manifest as Readonly<Record<string, unknown>>,
          }
        },
        catch: (cause) =>
          workbenchError(
            descriptor.source,
            cause,
            `Unable to load Document Tree Workbench ${descriptor.name}`,
          ),
      })
    },
    loadDevelopment: (descriptor: DevelopmentWorkbenchDescriptor) => {
      if (descriptor.source.providerId !== PROVIDER_ID) {
        return Effect.fail(providerError(descriptor.source))
      }
      return Effect.tryPromise({
        try: async () => {
          const [developmentRoot, morphirHome] = await Promise.all([
            findDirectory(descriptor.source),
            dependencies.home.read(),
          ])
          const response = await dependencies.engine.discover({
            protocolVersion: 1,
            developmentRoot,
            morphirHome,
            systemConfig: null,
            environment: {},
            cliOverlay: {},
          })
          if (response.status === 'failure') {
            throw new WorkbenchError({
              code: 'detection-failed',
              source: descriptor.source,
              message: `${response.error.code}: ${response.error.message}`,
            })
          }
          return {
            kind: 'development' as const,
            descriptor,
            snapshot: qualifyWorkspace(descriptor.source, response.snapshot),
          }
        },
        catch: (cause) =>
          workbenchError(
            descriptor.source,
            cause,
            `Unable to load Development Workbench ${descriptor.name}`,
          ),
      })
    },
    loadProjectModel: (descriptor, projectId) => {
      if (descriptor.source.providerId !== PROVIDER_ID) {
        return Effect.fail(providerError(descriptor.source))
      }
      return Effect.tryPromise({
        try: async () => {
          const [developmentRoot, morphirHome] = await Promise.all([
            findDirectory(descriptor.source),
            dependencies.home.read(),
          ])
          const response = await dependencies.engine.discover({
            protocolVersion: 1,
            developmentRoot,
            morphirHome,
            systemConfig: null,
            environment: {},
            cliOverlay: {},
          })
          if (response.status === 'failure') {
            throw new WorkbenchError({
              code: 'detection-failed',
              source: descriptor.source,
              message: `${response.error.code}: ${response.error.message}`,
            })
          }
          const snapshot = qualifyWorkspace(descriptor.source, response.snapshot)
          const project = snapshot.projects.find((candidate) => candidate.id === projectId)
          if (!project) {
            throw new WorkbenchError({
              code: 'not-found',
              source: descriptor.source,
              message: `Project is not present in ${descriptor.name}: ${projectId}`,
            })
          }
          const modelPath =
            project.relativePath === '.'
              ? 'morphir-ir.json'
              : `${project.relativePath}/morphir-ir.json`
          const uploaded = sessionUploads.get(descriptor.source.locator)
          let content: string
          if (uploaded) {
            const file = uploaded.files.get(modelPath)
            if (!file) {
              throw new WorkbenchError({
                code: 'not-found',
                source: descriptor.source,
                message: `Project model not found: ${modelPath}`,
              })
            }
            if (file.size > MAX_PROJECT_MODEL_BYTES) {
              throw new WorkbenchError({
                code: 'read-failed',
                source: descriptor.source,
                message: `Project model exceeds ${MAX_PROJECT_MODEL_BYTES} bytes: ${modelPath}`,
              })
            }
            content = await file.text()
          } else {
            const handle = await dependencies.handles.get(descriptor.source.locator)
            if (!handle) {
              throw new WorkbenchError({
                code: 'not-found',
                source: descriptor.source,
                message: `Workbench source not found in this browser: ${descriptor.source.locator}`,
              })
            }
            content = await readHandleFile(
              handle as unknown as DirectoryPermissionHandle,
              modelPath,
            )
          }
          const modelSource = {
            providerId: PROVIDER_ID,
            locator: `${descriptor.source.locator}#project-model:${project.id}`,
            displayName: `${project.name} / morphir-ir.json`,
            ...(descriptor.source.persistence ? { persistence: descriptor.source.persistence } : {}),
          } satisfies WorkbenchSourceRef
          const modelDescriptor: ModelWorkbenchDescriptor = {
            id: sourceKey(modelSource),
            source: modelSource,
            name: project.name,
            kind: 'model',
            distribution: 'single-file',
            route: 'explorer',
            openedAt: descriptor.openedAt,
            lastUsedAt: new Date().toISOString(),
          }
          return { content, modelDescriptor }
        },
        catch: (cause) =>
          workbenchError(
            descriptor.source,
            cause,
            `Unable to load project model from ${descriptor.name}`,
          ),
      }).pipe(
        Effect.flatMap(({ content, modelDescriptor }) =>
          decodeMorphirIr(content).pipe(
            Effect.map((library) => ({
              kind: 'model' as const,
              descriptor: modelDescriptor,
              library,
              ir: toWorkspaceIr(library),
              manifest: null,
            })),
            Effect.mapError(
              (error) =>
                new WorkbenchError({
                  code: 'invalid-distribution',
                  source: modelDescriptor.source,
                  message: error.message,
                }),
            ),
          ),
        ),
      )
    },
    events: (descriptor) =>
      descriptor.source.providerId === PROVIDER_ID
        ? Stream.empty
        : Stream.fail(providerError(descriptor.source)),
  }
}

export const makeBrowserWorkbenchLayers = (
  dependencies: BrowserWorkspaceDependencies,
  models: BrowserModelSourceProvider,
) => makeWorkbenchProviderLayers([makeBrowserWorkbenchAdapter(dependencies, models)], PROVIDER_ID)
