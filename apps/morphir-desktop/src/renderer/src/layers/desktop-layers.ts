import { Effect, Layer, Option } from 'effect'
import {
  AppInfoService,
  ConfigService,
  WorkspaceService,
  defaultUiConfig,
  type CoreServices,
  type UiConfig,
} from '@morphir/ui'
import type { RpcClient } from './rpc-client.ts'

export const desktopCore = (rpc: RpcClient): Layer.Layer<CoreServices> =>
  Layer.mergeAll(
    Layer.succeed(AppInfoService, {
      version: rpc.effect<{ version: string }>('morphir/shell/appVersion').pipe(
        Effect.map((r) => r.version),
        Effect.orDie,
      ),
    }),
    // INTERIM in-memory config — replaced by MORPHIR_HOME TOML over RPC in Task 11.
    Layer.sync(ConfigService, () => {
      let config: UiConfig = defaultUiConfig
      return {
        load: Effect.sync(() => config),
        save: (c: UiConfig) => Effect.sync(() => void (config = c)),
      }
    }),
    // INTERIM no-op workspace — replaced by native dialogs over RPC in Task 12.
    Layer.succeed(WorkspaceService, {
      pickAndRead: Effect.succeed(Option.none()),
      read: Option.none(),
    }),
  )
