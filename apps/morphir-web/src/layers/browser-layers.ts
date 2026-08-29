import { Effect, Layer, Option } from 'effect'
import {
  AppInfoService,
  ConfigService,
  DevelopmentWorkbenchService,
  ModelWorkbenchService,
  WorkbenchError,
  WorkbenchSourceService,
  WorkspaceError,
  WorkspaceService,
  decodeUiConfig,
  defaultUiConfig,
  type CoreServices,
  type PickedWorkspace,
} from '@morphir/ui'
import { decodeMorphirIr, toWorkspaceIr } from '@morphir/ir'

const CONFIG_KEY = 'morphir-ui.config'

export const browserCore = (version: string): Layer.Layer<CoreServices> => {
  const selectedModels = new Map<string, string>()

  return Layer.mergeAll(
    Layer.succeed(ConfigService, {
      load: Effect.sync(() => {
        try {
          return decodeUiConfig(JSON.parse(localStorage.getItem(CONFIG_KEY) ?? '{}'))
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
        if (!selectedModels.has(source)) {
          return Effect.fail(
            new WorkbenchError({
              code: 'not-found',
              source,
              message: `Workbench source not found in this browser session: ${source}`,
            }),
          )
        }
        const timestamp = new Date().toISOString()
        return Effect.succeed({
          id: source,
          source,
          name: source,
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
              code: 'unsupported-file',
              source: '<browser-folder>',
              message: 'Folder Workbenches are not available in the browser',
            }),
          )
        }
        return Effect.async<Option.Option<string>, WorkbenchError>((resume) => {
          const input = document.createElement('input')
          input.type = 'file'
          input.accept = 'application/json,.json'
          input.onchange = () => {
            const file = input.files?.[0]
            if (!file) return resume(Effect.succeed(Option.none()))
            file.text().then(
              (content) => {
                selectedModels.set(file.name, content)
                resume(Effect.succeed(Option.some(file.name)))
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
            code: 'unsupported-file',
            source,
            message: 'Reveal in file manager is not available in the browser',
          }),
        ),
    }),
    Layer.succeed(ModelWorkbenchService, {
      load: (descriptor) => {
        const content = selectedModels.get(descriptor.source)
        if (!content) {
          return Effect.fail(
            new WorkbenchError({
              code: 'not-found',
              source: descriptor.source,
              message: `Workbench source not found in this browser session: ${descriptor.source}`,
            }),
          )
        }
        return decodeMorphirIr(content).pipe(
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
          new WorkbenchError({
            code: 'unsupported-file',
            source: descriptor.source,
            message: 'Development Workbenches are not available in the browser',
          }),
        ),
    }),
    Layer.succeed(AppInfoService, { version: Effect.succeed(version) }),
  )
}
