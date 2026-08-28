import { Effect, Layer, Option } from 'effect'
import {
  AppInfoService,
  ConfigService,
  WorkspaceError,
  WorkspaceService,
  decodeUiConfig,
  defaultUiConfig,
  type CoreServices,
  type PickedWorkspace,
} from '@morphir/ui'

const CONFIG_KEY = 'morphir-ui.config'

export const browserCore = (version: string): Layer.Layer<CoreServices> =>
  Layer.mergeAll(
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
    Layer.succeed(AppInfoService, { version: Effect.succeed(version) }),
  )
