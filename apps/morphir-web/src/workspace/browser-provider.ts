import { Effect, Layer, Option, Stream } from 'effect'
import {
  DevelopmentWorkbenchService,
  WorkbenchError,
  WorkbenchProviderService,
  WorkbenchSourceService,
  unsupportedProviderError,
  type DevelopmentWorkbenchDescriptor,
  type WorkbenchDescriptor,
} from '@morphir/ui'
import type { WorkspaceDiscoveryEngine } from '@morphir/workspace-engine'
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
  readonly release: (source: WorkbenchSourceRef) => Effect.Effect<void>
}

interface UploadedTree {
  readonly name: string
  readonly tree: Awaited<ReturnType<typeof fileTreeFromDirectoryUpload>>
}

const sessionUploads = new Map<string, UploadedTree>()
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

export const makeBrowserWorkbenchLayers = (
  dependencies: BrowserWorkspaceDependencies,
  models: BrowserModelSourceProvider,
): Layer.Layer<WorkbenchSourceService | WorkbenchProviderService | DevelopmentWorkbenchService> => {
  const findDirectory = async (source: WorkbenchSourceRef): Promise<UploadedTree['tree']> => {
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
    return fileTreeFromDirectoryHandle(handle as unknown as DirectoryPermissionHandle)
  }

  const inspectDirectory = (source: WorkbenchSourceRef) =>
    Effect.tryPromise({
      try: async () => {
        const uploaded = sessionUploads.get(source.locator)
        if (!uploaded && (await dependencies.handles.get(source.locator)) === null) {
          throw new WorkbenchError({
            code: 'not-found',
            source,
            message: `Workbench source not found in this browser: ${source.locator}`,
          })
        }
        const timestamp = new Date().toISOString()
        return {
          id: sourceKey(source),
          source,
          name: uploaded?.name ?? source.displayName,
          kind: 'development' as const,
          route: 'overview' as const,
          openedAt: timestamp,
          lastUsedAt: timestamp,
        }
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

  return Layer.mergeAll(
    Layer.succeed(WorkbenchSourceService, {
      inspect: (source) => {
        if (source.providerId !== PROVIDER_ID) return Effect.fail(providerError(source))
        return source.locator.startsWith('directory:')
          ? inspectDirectory(source)
          : models.inspect(source)
      },
      pick: (kind) => (kind === 'folder' ? pickDirectory() : models.pick()),
      release: (source) =>
        source.providerId !== PROVIDER_ID || source.persistence !== 'session'
          ? Effect.void
          : source.locator.startsWith('directory:')
            ? Effect.sync(() => void sessionUploads.delete(source.locator))
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
    }),
    Layer.succeed(WorkbenchProviderService, {
      list: Effect.succeed([
        {
          id: PROVIDER_ID,
          name: 'This browser',
          kind: 'local' as const,
          status: 'available' as const,
          capabilities: [
            { name: 'morphir/model/open', version: '1' },
            { name: 'morphir/development/inspect', version: '1' },
            { name: 'morphir/workspace/open', version: '1' },
          ],
        },
      ]),
    }),
    Layer.succeed(DevelopmentWorkbenchService, {
      load: (descriptor: DevelopmentWorkbenchDescriptor) => {
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
      loadProjectModel: (descriptor) =>
        Effect.fail(
          descriptor.source.providerId === PROVIDER_ID
            ? new WorkbenchError({
                code: 'unsupported-capability',
                source: descriptor.source,
                message: 'Project model loading is not available in the browser',
              })
            : providerError(descriptor.source),
        ),
      events: (descriptor) =>
        descriptor.source.providerId === PROVIDER_ID
          ? Stream.empty
          : Stream.fail(providerError(descriptor.source)),
    }),
  )
}
