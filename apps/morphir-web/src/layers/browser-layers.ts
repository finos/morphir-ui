import { Effect, Layer, Option, Stream } from 'effect'
import {
  AppInfoService,
  ConfigService,
  DevelopmentWorkbenchService,
  ModelWorkbenchService,
  WorkbenchError,
  WorkbenchProviderService,
  WorkbenchSourceService,
  unsupportedProviderError,
  WorkspaceError,
  WorkspaceService,
  decodeUiConfig,
  defaultUiConfig,
  type CoreServices,
  type PickedWorkspace,
} from '@morphir/ui'
import { decodeMorphirIr, toWorkspaceIr } from '@morphir/ir'
import { sourceKey, type WorkbenchSourceRef } from '@morphir/workspace'

const CONFIG_KEY = 'morphir-ui.config'

export const browserCore = (version: string): Layer.Layer<CoreServices> => {
  const selectedModels = new Map<string, { name: string; content: string }>()
  const selectedModelNameCounts = new Map<string, number>()
  let nextSelectedModelId = 0
  const providerError = (source: WorkbenchSourceRef): WorkbenchError =>
    unsupportedProviderError('browser-local', source)

  return Layer.mergeAll(
    Layer.succeed(ConfigService, {
      load: Effect.sync(() => {
        try {
          return decodeUiConfig(JSON.parse(localStorage.getItem(CONFIG_KEY) ?? '{}'), {
            legacyProviderId: 'browser-local',
          })
        } catch {
          return defaultUiConfig
        }
      }),
      save: (config) => Effect.sync(() => localStorage.setItem(CONFIG_KEY, JSON.stringify(config))),
    }),
    Layer.succeed(WorkspaceService, {
      pickAndRead: Effect.async<Option.Option<PickedWorkspace>, WorkspaceError>((resume) => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = 'application/json,.json'
        input.onchange = () => {
          const file = input.files?.[0]
          if (!file) return resume(Effect.succeed(Option.none()))
          file.text().then(
            (content) => resume(Effect.succeed(Option.some({ ref: { path: file.name }, content }))),
            (e) => resume(Effect.fail(new WorkspaceError({ message: String(e) }))),
          )
        }
        input.oncancel = () => resume(Effect.succeed(Option.none()))
        input.click()
        return Effect.sync(() => {
          input.onchange = null
          input.oncancel = null
        })
      }),
      read: Option.none(),
    }),
    Layer.succeed(WorkbenchSourceService, {
      inspect: (source) => {
        if (source.providerId !== 'browser-local') {
          return Effect.fail(providerError(source))
        }
        const selectedModel = selectedModels.get(sourceKey(source))
        if (!selectedModel) {
          return Effect.fail(
            new WorkbenchError({
              code: 'not-found',
              source,
              message: `Workbench source not found in this browser session: ${source.locator}`,
            }),
          )
        }
        const timestamp = new Date().toISOString()
        const sourceRef = {
          providerId: 'browser-local',
          locator: source.locator,
          displayName: selectedModel.name,
        }
        return Effect.succeed({
          id: sourceKey(sourceRef),
          source: sourceRef,
          name: selectedModel.name,
          kind: 'model' as const,
          distribution: 'single-file' as const,
          route: 'overview' as const,
          openedAt: timestamp,
          lastUsedAt: timestamp,
        })
      },
      pick: (kind) => {
        if (kind === 'folder') {
          return Effect.fail(
            new WorkbenchError({
              code: 'unsupported-capability',
              source: '<browser-folder>',
              message: 'Folder Workbenches are not available in the browser',
            }),
          )
        }
        return Effect.async<Option.Option<WorkbenchSourceRef>, WorkbenchError>((resume) => {
          const input = document.createElement('input')
          input.type = 'file'
          input.accept = 'application/json,.json'
          input.onchange = () => {
            const file = input.files?.[0]
            if (!file) return resume(Effect.succeed(Option.none()))
            file.text().then(
              (content) => {
                const source = `browser-model:${++nextSelectedModelId}:${file.name}`
                const nameCount = (selectedModelNameCounts.get(file.name) ?? 0) + 1
                selectedModelNameCounts.set(file.name, nameCount)
                const name = nameCount === 1 ? file.name : `${file.name} (${nameCount})`
                const sourceRef = {
                  providerId: 'browser-local',
                  locator: source,
                  displayName: name,
                }
                selectedModels.set(sourceKey(sourceRef), { name, content })
                resume(Effect.succeed(Option.some(sourceRef)))
              },
              (error) =>
                resume(
                  Effect.fail(
                    new WorkbenchError({
                      code: 'read-failed',
                      source: file.name,
                      message: String(error),
                    }),
                  ),
                ),
            )
          }
          input.oncancel = () => resume(Effect.succeed(Option.none()))
          input.click()
          return Effect.sync(() => {
            input.onchange = null
            input.oncancel = null
          })
        })
      },
      reveal: (source) =>
        Effect.fail(
          new WorkbenchError({
            code: 'unsupported-capability',
            source,
            message:
              source.providerId === 'browser-local'
                ? 'Reveal in file manager is not available in the browser'
                : `Workbench source belongs to provider ${source.providerId}`,
          }),
        ),
    }),
    Layer.succeed(WorkbenchProviderService, {
      list: Effect.succeed([
        {
          id: 'browser-local',
          name: 'This browser',
          kind: 'local' as const,
          status: 'available' as const,
          capabilities: [{ name: 'morphir/model/open', version: '1' }],
        },
      ]),
    }),
    Layer.succeed(ModelWorkbenchService, {
      load: (descriptor) => {
        if (descriptor.source.providerId !== 'browser-local') {
          return Effect.fail(providerError(descriptor.source))
        }
        const selectedModel = selectedModels.get(sourceKey(descriptor.source))
        if (!selectedModel) {
          return Effect.fail(
            new WorkbenchError({
              code: 'not-found',
              source: descriptor.source,
              message: `Workbench source not found in this browser session: ${descriptor.source.locator}`,
            }),
          )
        }
        return decodeMorphirIr(selectedModel.content).pipe(
          Effect.map((library) => ({
            kind: 'model' as const,
            descriptor,
            library,
            ir: toWorkspaceIr(library),
            manifest: null,
          })),
          Effect.mapError(
            (error) =>
              new WorkbenchError({
                code: 'invalid-distribution',
                source: descriptor.source,
                message: error.message,
              }),
          ),
        )
      },
    }),
    Layer.succeed(DevelopmentWorkbenchService, {
      load: (descriptor) =>
        Effect.fail(
          descriptor.source.providerId === 'browser-local'
            ? new WorkbenchError({
                code: 'unsupported-capability',
                source: descriptor.source,
                message: 'Development Workbenches are not available in the browser',
              })
            : providerError(descriptor.source),
        ),
      loadProjectModel: (descriptor) =>
        Effect.fail(
          descriptor.source.providerId === 'browser-local'
            ? new WorkbenchError({
                code: 'unsupported-capability',
                source: descriptor.source,
                message: 'Project model loading is not available in the browser',
              })
            : providerError(descriptor.source),
        ),
      events: (descriptor) =>
        descriptor.source.providerId === 'browser-local'
          ? Stream.fail(
              new WorkbenchError({
                code: 'unsupported-capability',
                source: descriptor.source,
                message: 'Workspace events are not available in the browser',
              }),
            )
          : Stream.fail(providerError(descriptor.source)),
    }),
    Layer.succeed(AppInfoService, { version: Effect.succeed(version) }),
  )
}
